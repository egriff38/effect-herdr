/**
 * Error types for the effect-herdr SDK.
 *
 * Three distinct tagged unions per @84 and @95:
 *   - HerdrConnectError  — Layer-build-time transport failures (cause preserved)
 *   - HerdrProtocolError — application-layer failures from a live RPC
 *   - Transport errors (SocketError etc.) — flow through the error channel
 *                                            from Effect's own modules, not
 *                                            wrapped by the SDK
 *
 * Errors used inside `Rpc.make(..., { error: ... })` MUST be schema-backed
 * (`Schema.ErrorClass`), not plain `Data.TaggedError`, because the RPC layer
 * encodes/decodes them across the wire. `HerdrProtocolError` follows the same
 * pattern effect-smol itself uses for `Socket.SocketReadError` etc.
 * `HerdrConnectError`'s three variants are Layer-build-time only — they never
 * cross the wire — so `Data.TaggedError` is correct for them.
 */

import { Data, Schema } from "effect"

// =============================================================================
// Connection errors (@84) — three tagged variants, each preserving its cause
// =============================================================================

/**
 * Resolved socket path did not exist on disk. A caller should bring the
 * herdr server up (`herdr` / `herdr --session <name>`) and retry.
 */
export class SocketFileMissing extends Data.TaggedError("SocketFileMissing")<{
  readonly socketPath: string
}> {
  override get message(): string {
    return `No herdr server socket found at ${this.socketPath}. Start a server with 'herdr' or 'herdr --session <name>'.`
  }
}

/**
 * Socket file existed but the server refused the connection. Typically means
 * the server crashed and left its socket file behind, or is currently starting.
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
 * Transport-level open failure — permission denied, path too long, EMFILE etc.
 * Rare, and remediation depends on inspecting `cause`.
 */
export class TransportOpenFailed extends Data.TaggedError("TransportOpenFailed")<{
  readonly socketPath: string
  readonly cause: unknown
}> {
  override get message(): string {
    return `Failed to open a transport to herdr socket at ${this.socketPath}.`
  }
}

export type HerdrConnectError = SocketFileMissing | ConnectionRefused | TransportOpenFailed

// =============================================================================
// Protocol errors (@95) — open list of known codes with tail
// =============================================================================

/**
 * Known error codes herdr returns in its `ErrorBody.code` field. Open-tail
 * `string & {}` preserves autocomplete on known values while accepting
 * anything herdr adds later. Seeded manually from herdr's socket-api docs
 * and schema examples; `bun run schema:refresh` does not (yet) regenerate
 * this list because herdr's schema does not enumerate codes exhaustively.
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

export type HerdrErrorCode = KnownHerdrErrorCode | (string & {})

/**
 * Application-layer failure surfaced by herdr in response to a well-formed
 * RPC. Tagged by `code` (from herdr's `ErrorBody.code`) so callers can
 * discriminate. Schema-backed because it crosses the wire as part of the
 * `Rpc.make(..., { error })` contract — the herdr wire adapter decodes
 * `{"error":{"code","message"}}` into this class.
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
 * `operations/pane.ts`'s `waitForOutput` (issue #7/slice 6) failure.
 * `Data.TaggedError`, not `Schema.ErrorClass` — unlike `HerdrProtocolError`
 * this never crosses the wire itself; it's the SDK's own interpretation of
 * two distinct failure modes: `"timeout"` (herdr's own `pane.wait_for_output`
 * timed out — mapped from a `HerdrProtocolError` whose `code === "timeout"`,
 * confirmed live during implementation) and `"pane_closed"` (reserved for a
 * future distinction if herdr ever surfaces "pane went away mid-wait" as a
 * separate code from plain `pane_not_found`; no live evidence of a distinct
 * code exists yet, so callers should not expect this reason today).
 */
export class WaitError extends Data.TaggedError("WaitError")<{
  readonly reason: "timeout" | "pane_closed"
}> {
  override get message(): string {
    return `waitForOutput failed: ${this.reason}`
  }
}
