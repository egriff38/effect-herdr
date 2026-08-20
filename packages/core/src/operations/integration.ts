/**
 * Shell-integration install/uninstall combinators — bootstrap or remove
 * herdr's shell hooks for a given agent CLI.
 *
 * @since 0.1.0
 */

import { Effect } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * Agent CLI names herdr's shell integration can target.
 *
 * @category models
 * @since 0.1.0
 */
export type IntegrationTarget =
  | "pi"
  | "omp"
  | "claude"
  | "codex"
  | "copilot"
  | "devin"
  | "droid"
  | "kimi"
  | "opencode"
  | "kilo"
  | "hermes"
  | "qodercli"
  | "cursor"
  | "mastracode"

/**
 * The detail herdr returns from an install/uninstall — human-readable
 * messages describing what was written, skipped, or removed. Decoded
 * rather than discarded, unlike `OkResult`-returning mutations, since
 * these carry install-specific detail worth surfacing to the caller.
 *
 * @category models
 * @since 0.1.0
 */
export interface IntegrationResult {
  readonly target: IntegrationTarget
  readonly messages: ReadonlyArray<string>
}

/**
 * Installs herdr's shell integration for `target`. Not dual-shaped —
 * there's no receiver identity to relate this to, just a single global
 * action against the named agent CLI.
 *
 * **Example** (bootstrapping shell integration for Claude)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, installIntegration } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const result = yield* installIntegration("claude")
 *   yield* Effect.log(result.messages)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const installIntegration = (
  target: IntegrationTarget,
): Effect.Effect<IntegrationResult, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["integration.install"]({ target })
    return { target: result.target, messages: result.details.messages }
  })

/**
 * Uninstalls herdr's shell integration for `target`. Not dual-shaped, for
 * the same reason as `installIntegration`.
 *
 * **Example** (removing shell integration for Claude)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, uninstallIntegration } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const result = yield* uninstallIntegration("claude")
 *   yield* Effect.log(result.messages)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const uninstallIntegration = (
  target: IntegrationTarget,
): Effect.Effect<IntegrationResult, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["integration.uninstall"]({ target })
    return { target: result.target, messages: result.details.messages }
  })
