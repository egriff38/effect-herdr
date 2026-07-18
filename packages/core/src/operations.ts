/**
 * Domain-shaped operations against `HerdrSession` (@211-a).
 *
 * Every combinator is top-level (not a method on the service) and uses
 * Effect's `dual` helper so it composes both data-first and data-last:
 *
 *   yield* runInPane(pane, "npm test")              // data-first
 *   pane.pipe(runInPane("npm test"))                // data-last
 *
 * Naming from cluster 3 (@211-b/c):
 *   - `active*(parent)` — the child a container remembers as focused;
 *                         always resolves (herdr guarantees ≥1 pane per tab).
 *   - `focused*`        — the *globally* focused thing right now; can be
 *                         `Option.none` (session with no focused pane during
 *                         a transient unfocus).
 *   - `current*`        — env-injected identity from `HERDR_PANE_ID` etc.;
 *                         `Option.none` iff not running inside a herdr pane.
 */

import type { Duration, Effect, Option, Stream } from "effect"
import type { HerdrSession } from "./HerdrSession.js"
import type { HerdrProtocolError } from "./protocol/errors.js"
import type { Pane, Tab, Workspace } from "./protocol/schemas.js"

// =============================================================================
// Pane manipulation
// =============================================================================

/**
 * Split a pane. Returns the new sibling pane.
 */
export declare const splitPane: {
  (pane: Pane, options?: SplitOptions): Effect.Effect<Pane, HerdrProtocolError, HerdrSession>
  (options?: SplitOptions): (pane: Pane) => Effect.Effect<Pane, HerdrProtocolError, HerdrSession>
}

export interface SplitOptions {
  readonly direction?: "right" | "down"
  readonly focus?: boolean
}

/**
 * Type text into a pane's live shell. Two modes:
 *   - batch string: sends text + Enter, one shot
 *   - Stream<string>: pipes chunks in real time, no implicit Enter (@237).
 *                     Backpressure via the connection's Ack semantics.
 */
export declare const runInPane: {
  // batch
  (pane: Pane, text: string): Effect.Effect<void, HerdrProtocolError, HerdrSession>
  (text: string): (pane: Pane) => Effect.Effect<void, HerdrProtocolError, HerdrSession>

  // streaming
  <E, R>(pane: Pane, chunks: Stream.Stream<string, E, R>): Effect.Effect<
    void,
    HerdrProtocolError | E,
    HerdrSession | R
  >
  <E, R>(chunks: Stream.Stream<string, E, R>): (
    pane: Pane,
  ) => Effect.Effect<void, HerdrProtocolError | E, HerdrSession | R>
}

/**
 * Stream matched output chunks from a pane. Real streaming RPC
 * (`pane.wait_for_output` / `RpcSchema.Stream`).
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

export interface WaitOptions {
  readonly regex?: boolean
  readonly timeout?: Duration.Input
}

export declare class WaitError /* extends Data.TaggedError("WaitError") */ {
  readonly _tag: "WaitError"
  readonly reason: "timeout" | "pane_closed"
}

/**
 * List panes in a workspace.
 */
export declare const listPanes: {
  (workspace: Workspace): Effect.Effect<ReadonlyArray<Pane>, HerdrProtocolError, HerdrSession>
  (): (workspace: Workspace) => Effect.Effect<ReadonlyArray<Pane>, HerdrProtocolError, HerdrSession>
}

// =============================================================================
// Active-child accessors (per-container, always resolve) — @211-b
// =============================================================================

/**
 * The pane that `parent` remembers as active. Herdr guarantees ≥1 pane
 * per tab per workspace, so this always resolves (or fails with
 * `HerdrProtocolError` on stale id).
 *
 * `activePane(tab)`       → drills tab.focused_pane_id
 * `activePane(workspace)` → drills workspace.active_tab_id → that tab's focused_pane_id
 */
export declare const activePane: {
  (parent: Tab): Effect.Effect<Pane, HerdrProtocolError, HerdrSession>
  (parent: Workspace): Effect.Effect<Pane, HerdrProtocolError, HerdrSession>
}

export declare const activeTab: (
  parent: Workspace,
) => Effect.Effect<Tab, HerdrProtocolError, HerdrSession>

// =============================================================================
// Global-focus accessors + live subscriptions — @211-c
// =============================================================================

/**
 * The pane herdr reports as globally focused right now. `Option.none` when
 * herdr has no focused pane (transient unfocus / headless server) — this is a
 * session-level nullable per herdr's schema, not the SDK inventing absence.
 */
export declare const focusedPane: Effect.Effect<Option.Option<Pane>, HerdrProtocolError, HerdrSession>
export declare const focusedTab: Effect.Effect<Option.Option<Tab>, HerdrProtocolError, HerdrSession>
export declare const focusedWorkspace: Effect.Effect<
  Option.Option<Workspace>,
  HerdrProtocolError,
  HerdrSession
>

/**
 * Live-updating view of the globally focused pane. Fed by
 * `events.subscribe`; scoped to the caller's Scope, torn down when the
 * scope closes.
 *
 * Read-only (`SubscriptionRef` gives `.get` and `.changes`, not `.set`) —
 * to change focus, call `focusPane(pane)` and the ref updates automatically
 * on herdr's next broadcast.
 */
export declare const focusedPaneRef: unknown /* Effect.Effect<
  SubscriptionRef.SubscriptionRef<Option.Option<Pane>>,
  HerdrProtocolError,
  HerdrSession | Scope.Scope
> */

/**
 * Focus a pane. Herdr broadcasts the change; `focusedPaneRef` observers
 * pick it up automatically.
 */
export declare const focusPane: {
  (pane: Pane): Effect.Effect<void, HerdrProtocolError, HerdrSession>
  (): (pane: Pane) => Effect.Effect<void, HerdrProtocolError, HerdrSession>
}

// =============================================================================
// Env-injected identity (D1) — unqualified, in a herdr pane or not
// =============================================================================

/**
 * The pane this Effect program was launched inside, per `HERDR_PANE_ID`.
 * `Option.none` iff not running inside herdr (`HERDR_ENV` unset). A
 * stale id (pane closed between launch and lookup) fails loud with
 * `HerdrProtocolError`, not `Option.none` — per D1.
 */
export declare const currentPane: Effect.Effect<
  Option.Option<Pane>,
  HerdrProtocolError,
  HerdrSession
>

export declare const currentTab: Effect.Effect<Option.Option<Tab>, HerdrProtocolError, HerdrSession>

export declare const currentWorkspace: Effect.Effect<
  Option.Option<Workspace>,
  HerdrProtocolError,
  HerdrSession
>
