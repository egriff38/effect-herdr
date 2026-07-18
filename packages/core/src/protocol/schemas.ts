/**
 * Value objects and schemas for the herdr socket protocol.
 *
 * Round-2 sketch — everything is `declare`-only. Real schemas are derived
 * from `scripts/herdr-schema.json` at codegen time (deferred grilling item).
 */


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
 *
 * Seed list drawn from herdr's own integration surface. `schema:refresh`
 * will refresh this list from `herdr integration status` in a later PR.
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

// =============================================================================
// Resolved value objects
// =============================================================================

export interface Pane {
  readonly id: PaneId
  readonly tabId: TabId
  readonly workspaceId: WorkspaceId
  readonly cwd: string
  readonly agent: Agent | undefined
  readonly agentStatus: "idle" | "working" | "blocked" | "done" | "unknown"
  readonly focused: boolean
}

export interface Tab {
  readonly id: TabId
  readonly workspaceId: WorkspaceId
  readonly label: string
  /** The pane this tab remembers as focused; per-container active-child. */
  readonly activePaneId: PaneId
  readonly focused: boolean
}

export interface Workspace {
  readonly id: WorkspaceId
  readonly label: string
  readonly cwd: string
  /** The tab this workspace remembers as active; per-container active-child. */
  readonly activeTabId: TabId
  readonly focused: boolean
}
