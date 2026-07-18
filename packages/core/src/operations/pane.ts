/**
 * Pane manipulation combinators.
 *
 * These operate on `Pane` identity (not `PaneSnapshot`) — none of them
 * need the mutable state of the pane, only its stable id. Callers who
 * need current state read it via `focus.ts` combinators or `snapshotPane`
 * from `state.ts`.
 *
 * Dual-shaped combinators use Effect's `dual` (2-arity) for both
 * data-first and data-last styles:
 *
 *   yield* runInPane(pane, "npm test")
 *   pane.pipe(runInPane("npm test"))
 *
 * Single-argument combinators are plain functions — no `dual` because
 * there is nothing to curry against.
 */

import type { Duration, Effect, Stream } from "effect"
import type { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { Pane, PaneSnapshot, Workspace } from "../protocol/schemas.js"

// =============================================================================
// Splitting
// =============================================================================

export interface SplitOptions {
  readonly direction?: "right" | "down"
  readonly focus?: boolean
}

/**
 * Split a pane. Returns the new sibling pane (identity — the caller can
 * `snapshotPane` if they want its state).
 */
export declare const splitPane: {
  (pane: Pane, options?: SplitOptions): Effect.Effect<Pane, HerdrProtocolError, HerdrSession>
  (options?: SplitOptions): (pane: Pane) => Effect.Effect<Pane, HerdrProtocolError, HerdrSession>
}

// =============================================================================
// Input — string batch or streaming
// =============================================================================

/**
 * Sum type: either send a single string (batch, includes Enter) or a
 * Stream<string> of chunks (streaming, no implicit Enter per @237). The
 * implementation branches on `Stream.isStream` internally.
 */
export type PaneInput = string | Stream.Stream<string, unknown, unknown>

/**
 * Type input into a pane's live shell.
 *
 * - `string`: single-shot, sends text + Enter (matches `herdr pane run` semantics)
 * - `Stream<string, E, R>`: real-time chunk pipe, no Enter, backpressure via
 *                           Ack. The stream's E and R propagate into the
 *                           return type conservatively.
 */
export declare const runInPane: {
  (pane: Pane, input: PaneInput): Effect.Effect<
    void,
    HerdrProtocolError | (PaneInput extends Stream.Stream<any, infer E, any> ? E : never),
    HerdrSession | (PaneInput extends Stream.Stream<any, any, infer R> ? R : never)
  >
  (input: PaneInput): (
    pane: Pane,
  ) => Effect.Effect<
    void,
    HerdrProtocolError | (PaneInput extends Stream.Stream<any, infer E, any> ? E : never),
    HerdrSession | (PaneInput extends Stream.Stream<any, any, infer R> ? R : never)
  >
}

// =============================================================================
// Output — streaming
// =============================================================================

export interface WaitOptions {
  readonly regex?: boolean
  readonly timeout?: Duration.Input
}

export declare class WaitError /* extends Data.TaggedError("WaitError") */ {
  readonly _tag: "WaitError"
  readonly reason: "timeout" | "pane_closed"
}

/**
 * Stream matched output chunks from a pane. Real streaming RPC
 * (`pane.wait_for_output` / `RpcSchema.Stream`). Callers close the stream
 * via `Stream.take` / interruption / scope close.
 */
export declare const waitForOutput: {
  (pane: Pane, match: string, options?: WaitOptions): Stream.Stream<
    string,
    HerdrProtocolError | WaitError,
    HerdrSession
  >
  (match: string, options?: WaitOptions): (
    pane: Pane,
  ) => Stream.Stream<string, HerdrProtocolError | WaitError, HerdrSession>
}

// =============================================================================
// Listing / lookup
// =============================================================================

/**
 * List panes in a workspace. Returns snapshots (herdr's pane.list RPC
 * returns full records).
 */
export declare const listPanes: (
  workspace: Workspace,
) => Effect.Effect<ReadonlyArray<PaneSnapshot>, HerdrProtocolError, HerdrSession>

/**
 * Look up a pane's current state. Round-trips to herdr; the returned
 * `PaneSnapshot` is fresh.
 */
export declare const snapshotPane: (
  pane: Pane,
) => Effect.Effect<PaneSnapshot, HerdrProtocolError, HerdrSession>
