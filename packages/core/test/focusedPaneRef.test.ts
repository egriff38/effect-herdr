import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Scope, Stream } from "effect"
import { RpcTest } from "effect/unstable/rpc"
import { HerdrConnection } from "../src/HerdrConnection.js"
import type { HerdrEventPush } from "../src/HerdrEventsSocket.js"
import * as HerdrSession from "../src/HerdrSession.js"
import { focusedPaneRef } from "../src/operations/focus.js"
import {
  HerdrRpcs,
  PaneInfoResult,
  SessionSnapshotResult,
} from "../src/protocol/HerdrRpcs.js"
import type { PaneId } from "../src/protocol/schemas.js"

/**
 * Unit tests for slice 9 (issue #10): `focusedPaneRef`'s shape (get/changes,
 * never set) and its wiring against a fake `rpc` + fake `subscribeEvents`.
 *
 * The fake `subscribeEvents` is backed by a real `Queue.Queue<HerdrEventPush>`
 * the test controls directly — pushing events onto it and observing the
 * ref's `.changes` stream react, mirroring `HerdrSession.test.ts`/
 * `operations.test.ts`'s in-memory `RpcTest` seam for `rpc` itself.
 */

const fakePaneInfo = (paneId: string, tabId: string, workspaceId: string) =>
  new PaneInfoResult({
    type: "pane_info",
    pane: {
      pane_id: paneId,
      tab_id: tabId,
      workspace_id: workspaceId,
      terminal_id: `term-${paneId}`,
      focused: true,
      agent_status: "idle",
      revision: 1,
    },
  })

const fakeSnapshot = (focusedPaneId: string | null) =>
  new SessionSnapshotResult({
    type: "session_snapshot",
    snapshot: {
      focused_workspace_id: focusedPaneId === null ? null : "w1",
      focused_tab_id: focusedPaneId === null ? null : "w1:t1",
      focused_pane_id: focusedPaneId,
      workspaces: [],
      tabs: [],
      panes: [],
      layouts: [],
    },
  })

/**
 * Fake connection: real in-memory `RpcTest` client for `rpc` (same pattern
 * as `operations.test.ts`), plus a `subscribeEvents` backed by a
 * test-controlled `Queue`. Returns the queue alongside the layer so tests
 * can `Queue.offer` events into it after providing the layer.
 */
const fakeConnectionLayer = (initialFocusedPaneId: string | null) =>
  Effect.gen(function*() {
    const queue = yield* Queue.unbounded<HerdrEventPush>()

    const rpc = yield* RpcTest.makeClient(HerdrRpcs).pipe(
      Effect.provide(
        HerdrRpcs.toLayer({
          ping: () => Effect.die("ping not stubbed"),
          "workspace.list": () => Effect.die("workspace.list not stubbed"),
          "workspace.get": () => Effect.die("workspace.get not stubbed"),
          "tab.get": () => Effect.die("tab.get not stubbed"),
          "pane.list": () => Effect.die("pane.list not stubbed"),
          "pane.get": (p) => Effect.succeed(fakePaneInfo(p.pane_id, "w1:t1", "w1")),
          "pane.split": () => Effect.die("pane.split not stubbed"),
          "pane.focus": () => Effect.die("pane.focus not stubbed"),
          "session.snapshot": () => Effect.succeed(fakeSnapshot(initialFocusedPaneId)),
          "pane.send_text": () => Effect.die("pane.send_text not stubbed"),
          "pane.close": () => Effect.die("pane.close not stubbed"),
          "pane.read": () => Effect.die("pane.read not stubbed"),
          "pane.wait_for_output": () => Effect.die("pane.wait_for_output not stubbed"),
        }),
      ),
    )

    const layer = Layer.succeed(HerdrConnection, {
      rpc,
      subscribeEvents: (_types: ReadonlyArray<string>) => Effect.succeed(Stream.fromQueue(queue)),
    })

    return { layer, queue }
  })

describe("operations/focus — focusedPaneRef", () => {
  test("exposes only get/changes — SubscriptionRef.set is never called on the caller's behalf", async () => {
    // Compile-time shape check: `focusedPaneRef`'s resolved value has no
    // `.set` — attempting it is a type error, not a runtime guard.
    const assertShape = (ref: { readonly get: unknown; readonly changes: unknown }) => ref
    void assertShape

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const { layer } = yield* fakeConnectionLayer("w1:p1")
          const ref = yield* focusedPaneRef.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(layer),
          )
          // @ts-expect-error — read-only surface has no `.set`
          ref.set
          return ref
        }),
      ),
    )

    expect(typeof result.get).toBe("object")
    expect(Stream.isStream(result.changes)).toBe(true)
  })

  test("initial value reflects session.snapshot's focused_pane_id via focusedPane, not a placeholder", async () => {
    const value = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const { layer } = yield* fakeConnectionLayer("w1:p1")
          const ref = yield* focusedPaneRef.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(layer),
          )
          return yield* ref.get
        }),
      ),
    )

    expect(Option.isSome(value)).toBe(true)
    if (Option.isSome(value)) expect(value.value.id).toBe("w1:p1" as PaneId)
  })

  test("initial value is Option.none when session.snapshot's focused_pane_id is null", async () => {
    const value = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const { layer } = yield* fakeConnectionLayer(null)
          const ref = yield* focusedPaneRef.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(layer),
          )
          return yield* ref.get
        }),
      ),
    )

    expect(Option.isNone(value)).toBe(true)
  })

  test("changes emits a fresh snapshot when a pane_focused push arrives, ignoring non-matching pushes", async () => {
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const { layer, queue } = yield* fakeConnectionLayer("w1:p1")
          const ref = yield* focusedPaneRef.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(layer),
          )

          // `changes` replays the current value to a fresh subscriber
          // (SubscriptionRef's replay:1 pubsub) — waiting for that first
          // replayed emission before offering pushes guarantees the
          // consumer is actually subscribed, avoiding a fork-vs-offer race.
          const ready = yield* Deferred.make<void>()
          const collected = yield* ref.changes.pipe(
            Stream.tap(() => Deferred.succeed(ready, void 0)),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild,
          )
          yield* Deferred.await(ready)

          // A non-matching event (wrong `event` tag) must be ignored — only
          // the pane_focused push below should produce the third emission
          // (the first is the replayed initial value from `ready` above).
          yield* Queue.offer(queue, { event: "pane_output_changed", data: { pane_id: "w1:p1" } })
          yield* Queue.offer(queue, { event: "pane_focused", data: { pane_id: "w1:p2", workspace_id: "w1" } })

          return yield* Fiber.join(collected)
        }),
      ),
    )

    expect(values).toHaveLength(2)
    const [first, second] = values
    expect(first !== undefined && Option.isSome(first) && first.value.id).toBe("w1:p1" as PaneId)
    expect(second !== undefined && Option.isSome(second) && second.value.id).toBe("w1:p2" as PaneId)
  })

  test("scoped: closing the caller's scope stops the underlying subscription (no lingering set after close)", async () => {
    const finalValue = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const { layer, queue } = yield* fakeConnectionLayer("w1:p1")
          const scope = yield* Scope.make()

          const ref = yield* focusedPaneRef.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(layer),
            Scope.provide(scope),
          )

          yield* Queue.offer(queue, { event: "pane_focused", data: { pane_id: "w1:p2", workspace_id: "w1" } })
          // Let the forked consumer loop observe the push before closing.
          yield* Effect.sleep("10 millis")

          yield* Scope.close(scope, Exit.void)

          // Offered after the scope closed — must NOT reach the ref, since
          // the consuming fiber was interrupted along with the scope.
          yield* Queue.offer(queue, { event: "pane_focused", data: { pane_id: "w1:p3", workspace_id: "w1" } })
          yield* Effect.sleep("10 millis")

          return yield* ref.get
        }),
      ),
    )

    expect(Option.isSome(finalValue) && finalValue.value.id).toBe("w1:p2" as PaneId)
  })
})
