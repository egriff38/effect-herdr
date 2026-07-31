/**
 * Combinator for blocking until a specific herdr lifecycle event fires.
 *
 * `waitForEvent` wraps `events.wait` directly — herdr itself holds the
 * connection open and does the matching server-side, replying exactly
 * once with a match or a timeout, the same architecture as
 * `waitForOutput`'s `pane.wait_for_output` in `pane.ts`. It is *not* built
 * by composing `HerdrConnection.subscribeEvents` + `Stream.filter` — that
 * pattern (`focusedPaneRef` in `focus.ts`) exists only for the
 * live-updating case, which `events.wait`'s one-shot semantics don't need.
 *
 * @since 0.1.0
 */

import { Duration, Effect, Stream } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import { HerdrProtocolError, WaitError } from "../protocol/errors.js"
import type { EventMatch, EventsWaitResult } from "../protocol/HerdrRpcs.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * One herdr lifecycle event, as decoded from `events.wait`'s
 * `wait_matched` reply — `event` names the kind, `data` carries its
 * kind-specific payload. Alias of `EventsWaitResult`'s own `event` field
 * rather than a duplicated shape.
 *
 * @category models
 * @since 0.1.0
 */
export type EventEnvelope = EventsWaitResult["event"]

/**
 * Options for `waitForEvent`. `events.wait` has no regex-style matcher
 * equivalent to `waitForOutput`'s — matching is entirely driven by
 * `match`'s discriminated `EventMatch` shape — so only `timeout` is
 * exposed here, deliberately not reusing `pane.ts`'s `WaitOptions`
 * verbatim.
 *
 * @category models
 * @since 0.1.0
 */
export interface EventWaitOptions {
  readonly timeout?: Duration.Input
}

/**
 * Blocks until an event matching `match` occurs, then emits that event as
 * a single chunk. Not dual-shaped — unlike `waitForOutput`, there's no
 * `Pane`/`Tab`/`Workspace` identity to pipe against; this is a bare call.
 *
 * Wraps `events.wait`, a blocking request/reply on herdr's wire — herdr
 * itself holds the connection open until match-or-timeout and replies
 * exactly once. The `Stream` return type is a service-layer ergonomic
 * (composes with `Stream.runHead`/`Stream.timeoutFail`), not a
 * wire-level stream. herdr's own `timeout_ms` is the sole timeout
 * mechanism; a timeout reply is mapped to `WaitError({ reason: "timeout" })`.
 *
 * **Example** (waiting for a workspace to close)
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { HerdrSession, waitForEvent } from "effect-herdr"
 * import type { WorkspaceId } from "effect-herdr"
 *
 * const program = (workspaceId: WorkspaceId) =>
 *   Effect.gen(function*() {
 *     const event = yield* waitForEvent(
 *       { event: "workspace_closed", workspace_id: workspaceId },
 *       { timeout: "30 seconds" },
 *     ).pipe(Stream.runHead)
 *     yield* Effect.log(event)
 *   })
 *
 * program("w1" as WorkspaceId).pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const waitForEvent = (
  match: EventMatch,
  options?: EventWaitOptions,
): Stream.Stream<EventEnvelope, HerdrProtocolError | WaitError | RpcClientError, HerdrSession> =>
  Stream.fromEffect(
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const result = yield* session.rpc["events.wait"]({
        match_event: match,
        timeout_ms: options?.timeout === undefined ? undefined : Duration.toMillis(options.timeout),
      }).pipe(
        Effect.catchTag("HerdrProtocolError", (error): Effect.Effect<never, HerdrProtocolError | WaitError> =>
          error.code === "timeout"
            ? Effect.fail(new WaitError({ reason: "timeout" }))
            : Effect.fail(error)),
      )
      return result.event
    }),
  )
