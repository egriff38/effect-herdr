/**
 * Error types for the effect-herdr SDK.
 *
 * Three distinct failure families: `HerdrConnectError` (Layer-build-time
 * transport failures, cause preserved), `HerdrProtocolError` (application-
 * layer failures from a live RPC), and Effect's own transport errors
 * (`Socket.SocketError` etc.), which flow through the error channel
 * unwrapped by the SDK. Errors used as an RPC's `error` schema are
 * `Schema.ErrorClass`-backed, since the RPC layer encodes/decodes them
 * across the wire; errors that never cross the wire are plain
 * `Data.TaggedError`.
 *
 * @since 0.1.0
 */

import { Data, Schema } from "effect"

// =============================================================================
// Connection errors — three tagged variants, each preserving its cause
// =============================================================================

/**
 * The resolved socket path has no server listening. Bring a herdr server up
 * (`herdr` / `herdr --session <name>`) and retry.
 *
 * **Example** (handling a missing socket)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrConnection } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const connection = yield* HerdrConnection
 *   yield* connection.rpc.ping()
 * }).pipe(
 *   Effect.catchTag("SocketFileMissing", (error) => Effect.log(error.message)),
 * )
 * ```
 *
 * @category errors
 * @since 0.1.0
 */
export class SocketFileMissing extends Data.TaggedError("SocketFileMissing")<{
  readonly socketPath: string
}> {
  override get message(): string {
    return `No herdr server socket found at ${this.socketPath}. Start a server with 'herdr' or 'herdr --session <name>'.`
  }
}

/**
 * The socket file exists but the server refused the connection — typically
 * a crashed server that left its socket file behind, or one still starting.
 *
 * @category errors
 * @since 0.1.0
 */
export class ConnectionRefused extends Data.TaggedError("ConnectionRefused")<{
  readonly socketPath: string
  readonly cause: unknown
}> {
  override get message(): string {
    return `Connection to herdr socket at ${this.socketPath} was refused. The server may have crashed or is still starting.`
  }
}

/**
 * A transport-level failure while opening the socket — permission denied,
 * path too long, `EMFILE`, etc. Rare; inspect `cause` for remediation.
 *
 * @category errors
 * @since 0.1.0
 */
export class TransportOpenFailed extends Data.TaggedError("TransportOpenFailed")<{
  readonly socketPath: string
  readonly cause: unknown
}> {
  override get message(): string {
    return `Failed to open a transport to herdr socket at ${this.socketPath}.`
  }
}

/**
 * Every failure mode `HerdrConnection.make`/`layer`/`Live` can raise while
 * establishing a connection.
 *
 * @category errors
 * @since 0.1.0
 */
export type HerdrConnectError = SocketFileMissing | ConnectionRefused | TransportOpenFailed

// =============================================================================
// Protocol errors — open list of known codes with tail
// =============================================================================

/**
 * Error codes herdr is known to return in its `ErrorBody.code` field.
 * `HerdrErrorCode`'s open tail (`string & {}`) accepts any other code
 * herdr sends while still offering autocomplete on these.
 *
 * @category models
 * @since 0.1.0
 */
export type KnownHerdrErrorCode =
  | "not_found"
  | "pane_not_found"
  | "workspace_not_found"
  | "tab_not_found"
  | "no_focused_pane"
  | "no_focused_tab"
  | "no_focused_workspace"
  | "invalid_argument"
  | "invalid_params"
  | "server_busy"
  | "internal_error"
  | "feature_disabled"
  | "stream_conflict"
  | "timeout"

/**
 * Any error code herdr's `ErrorBody.code` can carry — {@link KnownHerdrErrorCode}
 * plus an open tail for codes not yet enumerated.
 *
 * @category models
 * @since 0.1.0
 */
export type HerdrErrorCode = KnownHerdrErrorCode | (string & {})

/**
 * An application-layer failure herdr returned for a well-formed RPC —
 * decoded from the wire's `{"error":{"code","message"}}` body. Tagged by
 * `code` so callers can discriminate on it.
 *
 * **Example** (discriminating on `code`)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, snapshotPane } from "effect-herdr"
 * import type { PaneId } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   return yield* snapshotPane({ id: "w1:t1:p1" as PaneId })
 * }).pipe(
 *   Effect.catchTag("HerdrProtocolError", (error) =>
 *     error.code === "pane_not_found"
 *       ? Effect.succeed(undefined)
 *       : Effect.fail(error)),
 * )
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category errors
 * @since 0.1.0
 */
export class HerdrProtocolError extends Schema.ErrorClass<HerdrProtocolError>("effect-herdr/HerdrProtocolError")({
  _tag: Schema.tag("HerdrProtocolError"),
  code: Schema.String,
  rawMessage: Schema.String,
}) {
  override get message(): string {
    return `herdr:${this.code}: ${this.rawMessage}`
  }
}

// =============================================================================
// Operation errors — SDK-side, never cross the wire
// =============================================================================

/**
 * `waitForOutput`'s failure. SDK-side only — never crosses the wire itself.
 * `"timeout"` means herdr's own `pane.wait_for_output` timed out before the
 * match appeared (mapped from a `HerdrProtocolError` whose `code` is
 * `"timeout"`); `"pane_closed"` is reserved for when herdr distinguishes
 * "pane went away mid-wait" from a plain `pane_not_found`.
 *
 * **Example** (catching a wait timeout)
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { HerdrSession, waitForOutput } from "effect-herdr"
 * import type { Pane } from "effect-herdr"
 *
 * const program = (pane: Pane) =>
 *   waitForOutput(pane, "ready").pipe(
 *     Stream.runHead,
 *     Effect.catchTag("WaitError", (error) => Effect.log(`gave up: ${error.reason}`)),
 *   )
 * ```
 *
 * @category errors
 * @since 0.1.0
 */
export class WaitError extends Data.TaggedError("WaitError")<{
  readonly reason: "timeout" | "pane_closed"
}> {
  override get message(): string {
    return `waitForOutput failed: ${this.reason}`
  }
}
