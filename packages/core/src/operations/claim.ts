/**
 * Scope-bound liveness for herdr resources.
 *
 * A `Pane`/`Tab`/`Workspace` value is a *remote* reference — herdr owns the
 * resource's real lifetime, and a user can close it from the UI at any
 * moment. Without a claim, that staleness only surfaces on the next RPC, as
 * a `pane_not_found` protocol error at an arbitrary later point in a
 * multi-step session.
 *
 * `claim` closes that window: it forks a watcher into the ambient `Scope`
 * that subscribes to herdr's `*.closed` push stream and, when the matching
 * resource's close event arrives, interrupts the fiber that made the claim.
 * Long sequential work is preempted mid-step rather than running on against
 * a resource that no longer exists.
 *
 * Disappearance surfaces as **interruption**, not a typed failure — there is
 * no `Fiber` primitive to fail another fiber with a typed error, and a
 * vanished precondition is closer to `Ctrl+C` than to a recoverable domain
 * error. Callers who need to *handle* disappearance rather than stop on it
 * should subscribe to the close event themselves.
 *
 * ```
 *  claim ── forks watcher into Scope ──► subscribeEvents(["pane.closed"])
 *    │                                          │
 *    │  (claiming fiber continues)              │ herdr fires the event
 *    ▼                                          ▼
 *  step 1 ─► step 2 ─► step 3            Fiber.interrupt(claimant)
 *                          ╳ ◄───────────────────┘
 * ```
 *
 * @since 0.1.0
 */

import { Effect, Fiber, Function, Scope, Stream } from "effect"
import { HerdrConnection } from "../HerdrConnection.js"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { HerdrEventPush } from "../HerdrEventsSocket.js"
import type { Entity, Pane, Tab, Workspace } from "../protocol/schemas.js"
import { EntityTypeId, isEntity } from "../protocol/schemas.js"
import { closePane } from "./pane.js"
import { closeTab } from "./tab.js"
import { closeWorkspace } from "./workspace.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * What closing the scope does to the claimed resource.
 *
 * - `"retain"` (default) — the scope only *watches*. Closing it unsubscribes
 *   the watcher and leaves the resource running. Use when you did not create
 *   the resource and have no business destroying it.
 * - `"destroy"` — the scope also *owns*. Closing it closes the resource on
 *   herdr, making the claim a true `acquireRelease`. Use for resources your
 *   program created and should clean up after itself.
 *
 * @category models
 * @since 0.1.0
 */
export type DisconnectPolicy = "retain" | "destroy"

/**
 * Options accepted by {@link claim} and {@link withClaim}.
 *
 * @category models
 * @since 0.1.0
 */
export interface ClaimOptions {
  readonly disconnectPolicy?: DisconnectPolicy
}

/**
 * Options accepted by {@link claimIn}, which takes its `Scope` explicitly
 * rather than from the requirements channel.
 *
 * @category models
 * @since 0.1.0
 */
export interface ClaimInOptions extends ClaimOptions {
  readonly scope: Scope.Scope
}

/**
 * Per-kind wiring for the close watcher.
 *
 * Deliberately built on `HerdrConnection.subscribeEvents` (the push stream)
 * rather than `events.wait`: as of herdr protocol 17, `events.wait` supports
 * only pane agent-status matches and rejects every `*_closed` match with
 * `unsupported_event_wait_match`. The push stream does deliver them.
 *
 * `subscribeType` is the dotted server-side filter; `pushEvent` is the
 * snake_case name on the delivered envelope; `idField` is the payload field
 * holding the closed resource's id.
 */
const watchWiring = (entity: Entity): {
  readonly subscribeType: string
  readonly pushEvent: string
  readonly idField: string
} => {
  switch (entity[EntityTypeId]) {
    case "pane":
      return { subscribeType: "pane.closed", pushEvent: "pane_closed", idField: "pane_id" }
    case "tab":
      return { subscribeType: "tab.closed", pushEvent: "tab_closed", idField: "tab_id" }
    case "workspace":
      return { subscribeType: "workspace.closed", pushEvent: "workspace_closed", idField: "workspace_id" }
  }
}

const closeEntity = (
  entity: Pane | Tab | Workspace,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> => {
  switch (entity[EntityTypeId]) {
    case "pane":
      return closePane(entity)
    case "tab":
      return closeTab(entity)
    case "workspace":
      return closeWorkspace(entity)
  }
}

const claimInScope = (
  entity: Pane | Tab | Workspace,
  scope: Scope.Scope,
  policy: DisconnectPolicy,
): Effect.Effect<void, never, HerdrSession | HerdrConnection> =>
  Effect.gen(function*() {
    const claimant = yield* Effect.withFiber(Effect.succeed)
    const connection = yield* HerdrConnection
    const { idField, pushEvent, subscribeType } = watchWiring(entity)

    const watch = Effect.gen(function*() {
      const pushes = yield* connection.subscribeEvents([subscribeType])
      yield* Stream.runForEach(pushes, (push: HerdrEventPush) =>
        push.event === pushEvent && push.data[idField] === entity.id
          ? Fiber.interrupt(claimant)
          : Effect.void)
    })

    // The watcher is forked into the scope, and its subscription is bound to
    // that same scope — so closing the scope both interrupts the watcher and
    // drops the subscription. That is what makes "retain" a pure unwatch.
    yield* watch.pipe(
      Scope.provide(scope),
      // A watcher that dies cannot observe closure, and a dropped subscription
      // is not evidence the resource died — so it must not interrupt the
      // claimant. But it does silently downgrade the claim to unwatched, which
      // is a real loss of the guarantee the caller asked for: log at WARNING,
      // not debug. (A debug-level log here is exactly what hid herdr's
      // `unsupported_event_wait_match` rejection during development.)
      Effect.catchCause((cause) =>
        Effect.logWarning(`claim on ${entity.id} is no longer watched; liveness not enforced`, cause)
      ),
      Effect.forkIn(scope),
    )

    if (policy === "destroy") {
      // The finalizer outlives this effect's own context, so capture the
      // services now and hand them back when it runs.
      const services = yield* Effect.context<HerdrSession>()
      yield* Scope.addFinalizer(
        scope,
        // The resource may already be gone — that is the expected race when a
        // remote close is what ended the scope. Cleanup must not fail on it.
        closeEntity(entity).pipe(Effect.ignore, Effect.provide(services)),
      )
    }
  })

/**
 * Claims a resource for the ambient `Scope`: forks a watcher that interrupts
 * the calling fiber if herdr reports the resource closed.
 *
 * Several resources may be claimed under one scope — each adds its own
 * watcher, and any of them dying interrupts the shared claimant.
 *
 * **Example** (a session that stops the moment its pane is closed)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, claim, runInPane } from "effect-herdr"
 * import type { Pane } from "effect-herdr"
 *
 * const program = (pane: Pane) =>
 *   Effect.gen(function*() {
 *     yield* claim(pane)
 *     yield* runInPane(pane, "echo step one")
 *     yield* Effect.sleep("10 seconds")
 *     yield* runInPane(pane, "echo step two")
 *   }).pipe(Effect.scoped)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const claim: {
  (entity: Pane | Tab | Workspace, options?: ClaimOptions): Effect.Effect<
    void,
    never,
    HerdrSession | HerdrConnection | Scope.Scope
  >
  (
    options?: ClaimOptions,
  ): (
    entity: Pane | Tab | Workspace,
  ) => Effect.Effect<void, never, HerdrSession | HerdrConnection | Scope.Scope>
} = Function.dual(
  (args) => isEntity(args[0]),
  (entity: Pane | Tab | Workspace, options?: ClaimOptions) =>
    Effect.flatMap(
      Effect.scope,
      (scope) => claimInScope(entity, scope, options?.disconnectPolicy ?? "retain"),
    ),
)

/**
 * {@link claim} against an explicitly supplied `Scope`, for callers managing
 * scope lifetimes by hand rather than through `Effect.scoped`.
 *
 * @category combinators
 * @since 0.1.0
 */
export const claimIn: {
  (entity: Pane | Tab | Workspace, options: ClaimInOptions): Effect.Effect<
    void,
    never,
    HerdrSession | HerdrConnection
  >
  (
    options: ClaimInOptions,
  ): (entity: Pane | Tab | Workspace) => Effect.Effect<void, never, HerdrSession | HerdrConnection>
} = Function.dual(
  (args) => isEntity(args[0]),
  (entity: Pane | Tab | Workspace, options: ClaimInOptions) =>
    claimInScope(entity, options.scope, options.disconnectPolicy ?? "retain"),
)

/**
 * Runs an effect that produces a resource, then claims what it produced —
 * the acquire-and-watch pairing, without a separate `claim` line.
 *
 * With `disconnectPolicy: "destroy"` this is the full ownership combinator:
 * the resource is created, watched, and closed when the scope ends.
 *
 * **Example** (a workspace that cleans itself up)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, createWorkspace, withClaim } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* withClaim(
 *     createWorkspace({ label: "scratch" }),
 *     { disconnectPolicy: "destroy" },
 *   )
 *   yield* Effect.log(`working in ${workspace.id}`)
 * }).pipe(Effect.scoped)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const withClaim: {
  <A extends Pane | Tab | Workspace, E, R>(
    acquire: Effect.Effect<A, E, R>,
    options?: ClaimOptions,
  ): Effect.Effect<A, E, R | HerdrSession | HerdrConnection | Scope.Scope>
  (
    options?: ClaimOptions,
  ): <A extends Pane | Tab | Workspace, E, R>(
    acquire: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R | HerdrSession | HerdrConnection | Scope.Scope>
} = Function.dual(
  (args) => Effect.isEffect(args[0]),
  <A extends Pane | Tab | Workspace, E, R>(acquire: Effect.Effect<A, E, R>, options?: ClaimOptions) =>
    Effect.tap(acquire, (entity) => claim(entity, options)),
)
