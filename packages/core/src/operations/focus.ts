/**
 * Focus combinators — three families with distinct semantics.
 *
 *   active*(parent)   — the child a container remembers as active. Herdr's
 *                       schema guarantees this exists (WorkspaceInfo.active_tab_id
 *                       and PaneLayoutSnapshot.focused_pane_id are non-null),
 *                       so the return type has no Option.
 *
 *   focused*          — the globally focused entity right now. SessionSnapshot's
 *                       focused_pane_id is nullable (transient unfocus, headless
 *                       server) — Option-wrapped.
 *
 *   focusedPaneRef    — live-updating SubscriptionRef fed by events.subscribe.
 *                       Read-only from the caller's POV; to change focus, call
 *                       `focusPane(pane)` and the ref updates on herdr's broadcast.
 */

import type { Effect, Option } from "effect"
import type { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type {
  Pane,
  PaneSnapshot,
  Tab,
  TabSnapshot,
  Workspace,
  WorkspaceSnapshot,
} from "../protocol/schemas.js"

// =============================================================================
// Per-container active-child (@211-b)
// =============================================================================

/**
 * The pane that `parent` remembers as active. Sum-typed argument (@#2):
 * one function, one signature, internal branching on Tab vs. Workspace.
 *
 * `activePane(tab)`       → drills tab.activePaneId
 * `activePane(workspace)` → drills workspace.activeTabId → that tab's activePaneId
 *
 * Always resolves (returns a snapshot, not an Option) — herdr guarantees
 * >=1 pane per tab per workspace within an active session. Stale ids fail
 * with HerdrProtocolError.
 */
export declare const activePane: (
  parent: Tab | Workspace,
) => Effect.Effect<PaneSnapshot, HerdrProtocolError, HerdrSession>

/**
 * The tab that `workspace` remembers as active.
 */
export declare const activeTab: (
  workspace: Workspace,
) => Effect.Effect<TabSnapshot, HerdrProtocolError, HerdrSession>

// =============================================================================
// Global focus (@211-c)
// =============================================================================

/**
 * The pane herdr reports as globally focused right now. `Option.none`
 * when nothing is focused (transient unfocus, headless server) — that's
 * a session-level nullable in herdr's own schema.
 */
export declare const focusedPane: Effect.Effect<
  Option.Option<PaneSnapshot>,
  HerdrProtocolError,
  HerdrSession
>

export declare const focusedTab: Effect.Effect<
  Option.Option<TabSnapshot>,
  HerdrProtocolError,
  HerdrSession
>

export declare const focusedWorkspace: Effect.Effect<
  Option.Option<WorkspaceSnapshot>,
  HerdrProtocolError,
  HerdrSession
>

/**
 * Live-updating view of the globally focused pane. Read-only from the
 * caller's POV — `SubscriptionRef` exposes `.get` and `.changes`, not
 * `.set`. To change focus, call `focusPane(pane)` and the ref updates on
 * herdr's next broadcast.
 *
 * Scoped: the underlying events.subscribe stream lives while the caller's
 * scope does.
 */
export declare const focusedPaneRef: unknown /* Effect.Effect<
  SubscriptionRef.SubscriptionRef<Option.Option<PaneSnapshot>>,
  HerdrProtocolError,
  HerdrSession | Scope.Scope
> */

/**
 * Focus a pane. Single-argument, so plain (no dual). Herdr broadcasts the
 * change; `focusedPaneRef` observers pick it up automatically.
 */
export declare const focusPane: (pane: Pane) => Effect.Effect<void, HerdrProtocolError, HerdrSession>
