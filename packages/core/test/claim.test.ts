import { describe, expect, test } from "bun:test"
import { Effect, Exit, Fiber, Layer, PubSub, Ref, Stream } from "effect"
import { HerdrConnection } from "../src/HerdrConnection.js"
import type { HerdrEventPush } from "../src/HerdrEventsSocket.js"
import * as HerdrSession from "../src/HerdrSession.js"
import { claim, claimIn, withClaim } from "../src/operations/claim.js"
import { makePane, makeWorkspace } from "../src/protocol/schemas.js"
import type { PaneId, TabId, WorkspaceId } from "../src/protocol/schemas.js"

/**
 * Unit tests for `claim`/`claimIn`/`withClaim`: that a close event interrupts
 * the claiming fiber, that a non-matching event does not, and that
 * `disconnectPolicy` decides whether scope exit closes the resource.
 *
 * The seam is a fake `HerdrConnection` whose `subscribeEvents` is backed by a
 * `Queue` the test pushes onto, plus a `closes` ref recording which
 * `*.close` RPCs were issued — so cleanup is asserted on observed calls
 * rather than on a mock's internals.
 */

const workspace = makeWorkspace({ id: "w1" as WorkspaceId })
const pane = makePane({
  id: "w1:t1:p1" as PaneId,
  tabId: "w1:t1" as TabId,
  workspaceId: "w1" as WorkspaceId,
})

const closedPush = (event: string, data: Record<string, unknown>): HerdrEventPush =>
  ({ event, data } as unknown as HerdrEventPush)

/**
 * Fake connection: pushes delivered per-subscription + a record of close RPCs.
 *
 * Backed by a `PubSub`, not a `Queue`: herdr opens an INDEPENDENT subscription
 * per `subscribeEvents` call, so every watcher must see every event. A shared
 * `Queue` would make concurrent watchers competing consumers and one event
 * would reach only one of them — an artifact of the fake, not of herdr.
 */
const fakeConnection = Effect.gen(function*() {
  const events = yield* PubSub.unbounded<HerdrEventPush>()
  const closes = yield* Ref.make<ReadonlyArray<string>>([])
  const subscribed = yield* Ref.make<ReadonlyArray<string>>([])

  const rpc = {
    "workspace.close": (p: { readonly workspace_id: string }) =>
      Ref.update(closes, (prior) => [...prior, `workspace.close:${p.workspace_id}`]),
    "tab.close": (p: { readonly tab_id: string }) =>
      Ref.update(closes, (prior) => [...prior, `tab.close:${p.tab_id}`]),
    "pane.close": (p: { readonly pane_id: string }) =>
      Ref.update(closes, (prior) => [...prior, `pane.close:${p.pane_id}`]),
  }

  const layer = Layer.succeed(HerdrConnection, {
    rpc,
    subscribeEvents: (types: ReadonlyArray<string>) =>
      Effect.as(Ref.update(subscribed, (prior) => [...prior, ...types]), Stream.fromPubSub(events)),
  } as unknown as typeof HerdrConnection.Service)

  return { closes, events, layer, subscribed }
})

interface Fakes {
  readonly closes: Ref.Ref<ReadonlyArray<string>>
  readonly events: PubSub.PubSub<HerdrEventPush>
  readonly layer: Layer.Layer<HerdrConnection>
  readonly subscribed: Ref.Ref<ReadonlyArray<string>>
}

const withFakes = <A, E, R>(body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const fakes = yield* fakeConnection
    return yield* body(fakes).pipe(
      Effect.provide(HerdrSession.layer),
      Effect.provide(fakes.layer),
    ) as Effect.Effect<A, E, never>
  })

/**
 * Blocks until at least `count` subscriptions have been opened.
 *
 * `claim` forks its watcher, so the fork returns before `subscribeEvents` has
 * run. Publishing into a `PubSub` before then drops the event on the floor —
 * which would make a "does not interrupt" assertion pass for the wrong reason.
 */
const awaitSubscribed = (
  subscribed: Ref.Ref<ReadonlyArray<string>>,
  count = 1,
): Effect.Effect<void> =>
  Effect.flatMap(Ref.get(subscribed), (types) =>
    types.length >= count
      ? Effect.void
      : Effect.andThen(Effect.sleep("1 milli"), awaitSubscribed(subscribed, count)))

describe("operations/claim — liveness", () => {
  test("a matching close event interrupts the claiming fiber mid-work", async () => {
    const exit = await Effect.runPromise(
      withFakes(({ events, subscribed }) =>
        Effect.gen(function*() {
          const claimed = Effect.gen(function*() {
            yield* claim(workspace)
            // Long enough that completing it would prove no interruption.
            yield* Effect.sleep("1 minute")
            return "ran to completion"
          }).pipe(Effect.scoped)

          const fiber = yield* Effect.forkChild(claimed)
          yield* awaitSubscribed(subscribed)
          yield* PubSub.publish(events, closedPush("workspace_closed", { workspace_id: "w1" }))

          return yield* Fiber.await(fiber)
        })
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("a close event for a different resource does not interrupt", async () => {
    const result = await Effect.runPromise(
      withFakes(({ events, subscribed }) =>
        Effect.gen(function*() {
          const claimed = Effect.gen(function*() {
            yield* claim(workspace)
            // Wait until the watcher is actually subscribed, else the publish
            // below would be missed and this test would pass vacuously.
            yield* awaitSubscribed(subscribed)
            // Another workspace closing must not disturb this claim.
            yield* PubSub.publish(events, closedPush("workspace_closed", { workspace_id: "w-other" }))
            yield* Effect.sleep("50 millis")
            return "survived"
          }).pipe(Effect.scoped)

          return yield* claimed
        })
      ),
    )

    expect(result).toBe("survived")
  })

  test("the wrong event kind for the same id does not interrupt", async () => {
    const result = await Effect.runPromise(
      withFakes(({ events, subscribed }) =>
        Effect.gen(function*() {
          const claimed = Effect.gen(function*() {
            yield* claim(pane)
            yield* awaitSubscribed(subscribed)
            // Same id string, but a tab_closed envelope — must not match a pane claim.
            yield* PubSub.publish(events, closedPush("tab_closed", { tab_id: "w1:t1:p1" }))
            yield* Effect.sleep("50 millis")
            return "survived"
          }).pipe(Effect.scoped)

          return yield* claimed
        })
      ),
    )

    expect(result).toBe("survived")
  })

  test("subscribes to the close type matching the claimed entity's kind", async () => {
    const [forPane, forWorkspace] = await Effect.runPromise(
      withFakes(({ subscribed }) =>
        Effect.gen(function*() {
          // Observed while the scope is still OPEN: the watcher is forked, so
          // closing the scope immediately would interrupt it before it ever
          // subscribed and both reads would be empty.
          const afterPane = yield* Effect.scoped(
            Effect.gen(function*() {
              yield* claim(pane)
              yield* awaitSubscribed(subscribed)
              return yield* Ref.get(subscribed)
            }),
          )
          const afterWorkspace = yield* Effect.scoped(
            Effect.gen(function*() {
              yield* claim(workspace)
              yield* awaitSubscribed(subscribed, 2)
              return yield* Ref.get(subscribed)
            }),
          )
          return [afterPane, afterWorkspace] as const
        })
      ),
    )

    expect(forPane).toEqual(["pane.closed"])
    expect(forWorkspace).toEqual(["pane.closed", "workspace.closed"])
  })
})

describe("operations/claim — disconnectPolicy", () => {
  test("retain (the default) leaves the resource alone when the scope closes", async () => {
    const closes = await Effect.runPromise(
      withFakes(({ closes }) =>
        Effect.gen(function*() {
          yield* Effect.scoped(claim(workspace))
          return yield* Ref.get(closes)
        })
      ),
    )

    expect(closes).toEqual([])
  })

  test("destroy closes the resource when the scope closes", async () => {
    const closes = await Effect.runPromise(
      withFakes(({ closes }) =>
        Effect.gen(function*() {
          yield* Effect.scoped(claim(workspace, { disconnectPolicy: "destroy" }))
          return yield* Ref.get(closes)
        })
      ),
    )

    expect(closes).toEqual(["workspace.close:w1"])
  })

  test("destroy dispatches the close RPC matching the entity's kind", async () => {
    const closes = await Effect.runPromise(
      withFakes(({ closes }) =>
        Effect.gen(function*() {
          yield* Effect.scoped(claim(pane, { disconnectPolicy: "destroy" }))
          return yield* Ref.get(closes)
        })
      ),
    )

    expect(closes).toEqual(["pane.close:w1:t1:p1"])
  })

  test("destroy still closes on the interrupt path, and does not fail cleanup", async () => {
    const closes = await Effect.runPromise(
      withFakes(({ closes, events, subscribed }) =>
        Effect.gen(function*() {
          const claimed = Effect.gen(function*() {
            yield* claim(workspace, { disconnectPolicy: "destroy" })
            yield* Effect.sleep("1 minute")
          }).pipe(Effect.scoped)

          const fiber = yield* Effect.forkChild(claimed)
          yield* awaitSubscribed(subscribed)
          yield* PubSub.publish(events, closedPush("workspace_closed", { workspace_id: "w1" }))
          yield* Fiber.await(fiber)

          return yield* Ref.get(closes)
        })
      ),
    )

    expect(closes).toEqual(["workspace.close:w1"])
  })
})

describe("operations/claim — withClaim and claimIn", () => {
  test("withClaim returns the acquired resource and claims it", async () => {
    const exit = await Effect.runPromise(
      withFakes(({ events, subscribed }) =>
        Effect.gen(function*() {
          const claimed = Effect.gen(function*() {
            const acquired = yield* withClaim(Effect.succeed(workspace))
            expect(acquired.id).toBe(workspace.id)
            yield* Effect.sleep("1 minute")
            return "ran to completion"
          }).pipe(Effect.scoped)

          const fiber = yield* Effect.forkChild(claimed)
          yield* awaitSubscribed(subscribed)
          yield* PubSub.publish(events, closedPush("workspace_closed", { workspace_id: "w1" }))
          return yield* Fiber.await(fiber)
        })
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("claimIn honours an explicitly supplied scope for destroy cleanup", async () => {
    const [duringScope, afterScope] = await Effect.runPromise(
      withFakes(({ closes }) =>
        Effect.gen(function*() {
          // The point of claimIn: the caller owns the Scope, rather than it
          // arriving through the requirements channel via Effect.scoped.
          const during = yield* Effect.scopedWith((scope) =>
            Effect.gen(function*() {
              yield* claimIn(workspace, { scope, disconnectPolicy: "destroy" })
              return yield* Ref.get(closes)
            })
          )
          const after = yield* Ref.get(closes)
          return [during, after] as const
        })
      ),
    )

    // Nothing closed while the scope was open; the close landed at scope exit.
    expect(duringScope).toEqual([])
    expect(afterScope).toEqual(["workspace.close:w1"])
  })

  test("several resources claimed under one scope all watch the same claimant", async () => {
    const exit = await Effect.runPromise(
      withFakes(({ events, subscribed }) =>
        Effect.gen(function*() {
          const claimed = Effect.gen(function*() {
            yield* claim(workspace)
            yield* claim(pane)
            yield* Effect.sleep("1 minute")
            return "ran to completion"
          }).pipe(Effect.scoped)

          const fiber = yield* Effect.forkChild(claimed)
          // Both watchers must be live before publishing.
          yield* awaitSubscribed(subscribed, 2)
          // Killing the SECOND claim must interrupt the shared claimant too.
          yield* PubSub.publish(events, closedPush("pane_closed", { pane_id: "w1:t1:p1" }))
          return yield* Fiber.await(fiber)
        })
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
