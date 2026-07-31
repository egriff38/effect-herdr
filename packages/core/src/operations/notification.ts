/**
 * Desktop notification combinator — lets an agent alert the human operator
 * without owning a pane/tab identity.
 *
 * @since 0.1.0
 */

import { Effect } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * The corner of the screen a notification toast appears in. Omitted means
 * herdr's own default placement.
 *
 * @category models
 * @since 0.1.0
 */
export type NotificationPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right"

/**
 * The sound herdr plays alongside the toast. `"none"` is explicit silence,
 * distinct from omitting `sound` (herdr's own default).
 *
 * @category models
 * @since 0.1.0
 */
export type NotificationSound = "none" | "done" | "request"

/**
 * Why `notification.show` did or didn't display the toast. `"shown"` is
 * the success case; the rest explain a suppression — disabled by the
 * user, rate-limited, no foreground client to show it in, or the desktop
 * notification system was busy.
 *
 * @category models
 * @since 0.1.0
 */
export type NotificationShowReason = "shown" | "disabled" | "rate_limited" | "no_foreground_client" | "busy"

/**
 * Options for `notifyUser`. Only `title` is required — `body`/`position`/
 * `sound` fall back to herdr's own defaults when omitted.
 *
 * @category models
 * @since 0.1.0
 */
export interface NotifyOptions {
  readonly title: string
  readonly body?: string
  readonly position?: NotificationPosition
  readonly sound?: NotificationSound
}

/**
 * The result of `notifyUser`. Decoded rather than discarded — `shown`
 * tells the caller whether the toast actually displayed, and `reason`
 * explains why not (or confirms it did).
 *
 * @category models
 * @since 0.1.0
 */
export interface NotifyResult {
  readonly shown: boolean
  readonly reason: NotificationShowReason
}

/**
 * Shows a desktop toast notification to the human operator. Not
 * dual-shaped — there is no receiver identity to relate this to, just a
 * single global action. Wraps `notification.show`, decoding its
 * `{shown, reason}` reply rather than discarding it, so a caller can tell
 * a suppressed/DND notification apart from a real send.
 *
 * **Example** (alerting on a blocked build)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, notifyUser } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const result = yield* notifyUser({ title: "Build failed", body: "see pane for details", sound: "request" })
 *   if (!result.shown) yield* Effect.log(`notification suppressed: ${result.reason}`)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const notifyUser = (
  options: NotifyOptions,
): Effect.Effect<NotifyResult, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["notification.show"]({
      title: options.title,
      body: options.body,
      position: options.position,
      sound: options.sound,
    })
    return { shown: result.shown, reason: result.reason }
  })
