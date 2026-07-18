/**
 * Value objects for the herdr socket protocol.
 *
 * Split into IDENTITY types (small, stable, safe to pass around long-term)
 * and SNAPSHOT types (point-in-time captures of mutable state).
 *
 * See design docs (D1-D3) and hunk review round 3 (@#4) for the rationale:
 * most fields herdr reports for a pane — cwd, agent, agentStatus, focused —
 * genuinely change during the pane's lifetime. Presenting them as `readonly`
 * fields on a single value object would misrepresent staleness.
 */
import type { DateTime } from "effect"

/** Branded string id types — opaque, safe to pass around, herdr never reuses closed ids. */
export type WorkspaceId = string & { readonly _brand: "WorkspaceId" }
export type TabId = string & { readonly _brand: "TabId" }
export type PaneId = string & { readonly _brand: "PaneId" }

// =============================================================================
// Known-agent open list (@57)
// =============================================================================

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

export interface Pane {
  readonly id: PaneId
  readonly tabId: TabId
  readonly workspaceId: WorkspaceId
}

export interface Tab {
  readonly id: TabId
  readonly workspaceId: WorkspaceId
}

export interface Workspace {
  readonly id: WorkspaceId
}

// =============================================================================
// Snapshot types — point-in-time state captures
// =============================================================================

export interface SnapshotProvenance {
  /** Herdr's own monotonic per-entity counter. Comparable across snapshots of the same entity. */
  readonly revision: number
  /** SDK-side capture time, sourced from Effect's Clock via DateTime.now. Diagnostics only. */
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
  readonly activePaneId: PaneId
  readonly focused: boolean
  readonly paneCount: number
}

export interface WorkspaceSnapshot extends Workspace, SnapshotProvenance {
  readonly label: string
  readonly cwd: string
  readonly activeTabId: TabId
  readonly focused: boolean
  readonly tabCount: number
  readonly paneCount: number
}
