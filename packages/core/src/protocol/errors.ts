/**
 * Error types for the effect-herdr SDK.
 *
 * Three distinct tagged unions per @84 and @95:
 *   - HerdrConnectError  — Layer-build-time transport failures (cause preserved)
 *   - HerdrProtocolError — application-layer failures from a live RPC
 *   - Transport errors (SocketError etc.) — flow through the error channel
 *                                            from Effect's own modules, not
 *                                            wrapped by the SDK
 */


// =============================================================================
// Connection errors (@84) — three tagged variants, each preserving its cause
// =============================================================================

/**
 * Resolved socket path did not exist on disk. A caller should bring the
 * herdr server up (`herdr` / `herdr --session <name>`) and retry.
 */
export declare class SocketFileMissing /* extends Data.TaggedError("SocketFileMissing") */ {
  readonly _tag: "SocketFileMissing"
  readonly socketPath: string
}

/**
 * Socket file existed but the server refused the connection. Typically means
 * the server crashed and left its socket file behind, or is currently starting.
 */
export declare class ConnectionRefused /* extends Data.TaggedError("ConnectionRefused") */ {
  readonly _tag: "ConnectionRefused"
  readonly socketPath: string
  readonly cause: unknown /* Socket.SocketOpenError */
}

/**
 * Transport-level open failure — permission denied, path too long, EMFILE etc.
 * Rare, and remediation depends on inspecting `cause`.
 */
export declare class TransportOpenFailed /* extends Data.TaggedError("TransportOpenFailed") */ {
  readonly _tag: "TransportOpenFailed"
  readonly socketPath: string
  readonly cause: unknown /* Socket.SocketOpenError */
}

export type HerdrConnectError = SocketFileMissing | ConnectionRefused | TransportOpenFailed

// =============================================================================
// Protocol errors (@95) — open list of known codes with tail
// =============================================================================

/**
 * Known error codes herdr returns in its `ErrorBody.code` field. Open-tail
 * `string & {}` preserves autocomplete on known values while accepting
 * anything herdr adds later. Codegen from schema captures new codes at
 * `schema:refresh` time.
 */
export type KnownHerdrErrorCode =
  | "pane_not_found"
  | "workspace_not_found"
  | "tab_not_found"
  | "no_focused_pane"
  | "no_focused_tab"
  | "no_focused_workspace"
  | "invalid_argument"
  | "server_busy"
  | "internal_error"

export type HerdrErrorCode = KnownHerdrErrorCode | (string & {})

/**
 * Application-layer failure surfaced by herdr in response to a well-formed
 * RPC. Tagged by `code` (from herdr's `ErrorBody.code`) so callers can
 * discriminate with `Effect.catchIf`.
 */
export declare class HerdrProtocolError /* extends Data.TaggedError("HerdrProtocolError") */ {
  readonly _tag: "HerdrProtocolError"
  readonly code: HerdrErrorCode
  readonly message: string
}
