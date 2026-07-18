/**
 * Value objects for the herdr socket protocol.
 *
 * Split into IDENTITY types (small, stable, safe to pass around long-term)
 * and SNAPSHOT types (point-in-time captures of mutable state).
 *
 * The distinction matters because most fields herdr reports for a pane —
 * cwd, agent, agentStatus, focused — genuinely change during the pane's
 * lifetime. Presenting them as `readonly` fields on a single value object
 * would be a lie: the fields don't change on the value, but they *do*
 * change on the pane the value represents.
 *
 * Rules:
 *   - Combinators that operate on identity (focusPane, splitPane, runInPane,
 *     waitForOutput, etc.) accept the identity type. They don't need snapshot
 *     fields and shouldn't be sensitive to their staleness.
 *   - Combinators that read state (activePane, focusedPane, currentPane,
 *     listPanes, getPane) return the snapshot type. Herdr's RPC returns the
 *     full record anyway; giving back only identity would be lossy.
 *   - Snapshots carry both `revision` (herdr's own monotonic per-entity
 *     counter, useful for staleness comparison) and `capturedAt` (SDK-side
 *     DateTime.Utc from Effect's Clock, useful for diagnostics/logging).
 */

import type { DateTime } from "effect"

// =============================================================================
// Opaque, branded id types
// =============================================================================

export type WorkspaceId = string & { readonly _brand: "WorkspaceId" }
export type TabId = string & { readonly _brand: "TabId" }
export type PaneId = string & { readonly _brand: "PaneId" }

// =============================================================================
// Known-agent open list (@57)
// =============================================================================

/**
 * Known agents that herdr's integration detection can identify, plus an
 * open-tail `string & {}` for agents we don't have baked-in autocomplete for
 * (or for `undefined` when herdr reports no agent at all in the pane).
 */
export type KnownAgent =
  | "claude"
  | "codex"
  | "omp"
  | "pi"
  | "opencode"
  | "aider"
  | "amp"
  | "cursor-agent"
  | "copilot"
  | "devin"
  | "droid"
  | "kimi"
  | "qoder"
  | "kilo"
  | "hermes"
  | "mastracode"

export type Agent = KnownAgent | (string & {})

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown"

// =============================================================================
// Identity types — stable references
// =============================================================================

/**
 * A stable reference to a pane. Fields never change during the pane's
 * lifetime. Safe to hold across arbitrary intervals; only becomes invalid
 * when the pane is closed (at which point every use will fail with
 * `HerdrProtocolError` with code `pane_not_found`).
 */
export interface Pane {
  readonly id: PaneId
  readonly tabId: TabId
  readonly workspaceId: WorkspaceId
}

/** Stable reference to a tab. */
export interface Tab {
  readonly id: TabId
  readonly workspaceId: WorkspaceId
}

/** Stable reference to a workspace. */
export interface Workspace {
  readonly id: WorkspaceId
}

// =============================================================================
// Snapshot types — point-in-time state captures
// =============================================================================

/**
 * Fields shared by every snapshot type. Provenance for the snapshot itself,
 * separate from the entity the snapshot describes.
 */
export interface SnapshotProvenance {
  /**
   * Herdr's own monotonic counter for this entity's state. Increments
   * whenever the entity's mutable fields change. Comparable across
   * snapshots of the same entity: newer > older.
   */
  readonly revision: number

  /**
   * When the SDK captured this snapshot. Reads Effect's Clock service.
   * Useful for diagnostics and logging; NOT a source of truth for
   * ordering (use `revision` for that).
   */
  readonly capturedAt: DateTime.Utc
}

export interface PaneSnapshot extends Pane, SnapshotProvenance {
  readonly cwd: string
  readonly agent: Agent | undefined
  readonly agentStatus: AgentStatus
  readonly focused: boolean
}

export interface TabSnapshot extends Tab, SnapshotProvenance {
  readonly label: string
  /** The pane this tab remembers as focused; per-container active-child. */
  readonly activePaneId: PaneId
  readonly focused: boolean
  readonly paneCount: number
}

export interface WorkspaceSnapshot extends Workspace, SnapshotProvenance {
  readonly label: string
  readonly cwd: string
  /** The tab this workspace remembers as active; per-container active-child. */
  readonly activeTabId: TabId
  readonly focused: boolean
  readonly tabCount: number
  readonly paneCount: number
}
