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
 *
 * CORRECTION vs. the original sketch, found by checking herdr's real schema
 * (scripts/herdr-schema.json) during implementation of issue #4: `revision`
 * (herdr's own monotonic per-entity counter) exists ONLY on `PaneInfo` (and
 * `AgentInfo`, unrelated to this SDK's v1 surface). `TabInfo` and
 * `WorkspaceInfo` have no `revision` field at all. `PaneSnapshot` keeps
 * `revision`; `TabSnapshot`/`WorkspaceSnapshot` do not claim a field herdr
 * never sends.
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

/**
 * `capturedAt` is common to every snapshot (SDK-side, from Effect's Clock —
 * diagnostics only, never a source of ordering truth). `revision` is NOT
 * common — only `PaneSnapshot` carries it, since only herdr's `PaneInfo`
 * wire shape has that field.
 */
export interface SnapshotCaptured {
  readonly capturedAt: DateTime.Utc
}

export interface PaneSnapshot extends Pane, SnapshotCaptured {
  /** Herdr's own monotonic per-pane counter. Comparable across snapshots of the same pane. */
  readonly revision: number
  readonly cwd: string
  readonly agent: Agent | undefined
  readonly agentStatus: AgentStatus
  readonly focused: boolean
}

/**
 * NOTE: no `activePaneId` field — herdr's `TabInfo` wire shape has no
 * `active_pane_id` (confirmed against a live `tab.get` during slice 3
 * implementation). The per-tab "active pane" concept only exists via
 * `PaneLayoutSnapshot.focused_pane_id` (a `session.snapshot` sub-object),
 * which is a distinct, richer type — not modeled in v1. `activePane`
 * (operations/focus.ts) will source it from there when slice 8 lands.
 */
export interface TabSnapshot extends Tab, SnapshotCaptured {
  readonly label: string
  readonly focused: boolean
  readonly paneCount: number
  readonly agentStatus: AgentStatus
}

export interface WorkspaceSnapshot extends Workspace, SnapshotCaptured {
  readonly label: string
  readonly activeTabId: TabId
  readonly focused: boolean
  readonly tabCount: number
  readonly paneCount: number
  readonly agentStatus: AgentStatus
}
