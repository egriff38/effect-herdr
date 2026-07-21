/**
 * Value objects for the herdr socket protocol.
 *
 * Split into IDENTITY types (`Pane`/`Tab`/`Workspace` — small, stable,
 * safe to hold onto long-term) and SNAPSHOT types (`PaneSnapshot`/
 * `TabSnapshot`/`WorkspaceSnapshot` — point-in-time captures of mutable
 * state such as `cwd`, `agent`, `agentStatus`, `focused`). Combinators in
 * `operations/` return identity after a mutation and snapshots after a
 * read — re-fetch a snapshot whenever you need fresh state.
 *
 * @since 0.1.0
 */
import type { DateTime } from "effect"

/**
 * Opaque branded id for a workspace. Safe to pass around; herdr never
 * reuses a closed workspace's id.
 *
 * @category models
 * @since 0.1.0
 */
export type WorkspaceId = string & { readonly _brand: "WorkspaceId" }

/**
 * Opaque branded id for a tab. Safe to pass around; herdr never reuses a
 * closed tab's id.
 *
 * @category models
 * @since 0.1.0
 */
export type TabId = string & { readonly _brand: "TabId" }

/**
 * Opaque branded id for a pane. Safe to pass around; herdr never reuses a
 * closed pane's id.
 *
 * @category models
 * @since 0.1.0
 */
export type PaneId = string & { readonly _brand: "PaneId" }

// =============================================================================
// Known-agent open list
// =============================================================================

/**
 * Agent names herdr recognizes out of the box.
 *
 * @category models
 * @since 0.1.0
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

/**
 * Any agent name herdr reports — {@link KnownAgent} plus an open tail for
 * agents not yet enumerated.
 *
 * @category models
 * @since 0.1.0
 */
export type Agent = KnownAgent | (string & {})

/**
 * The lifecycle state herdr tracks for a pane, tab, or workspace's agent.
 *
 * @category models
 * @since 0.1.0
 */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown"

// =============================================================================
// Identity types — stable references
// =============================================================================

/**
 * A pane's stable identity: its own id plus the tab/workspace containing
 * it. Combinators that mutate a pane (`splitPane`, `focusPane`) accept and
 * return this — call `snapshotPane` for current state.
 *
 * **Example** (building a `Pane` from known ids)
 *
 * ```ts
 * import type { Pane, PaneId, TabId, WorkspaceId } from "effect-herdr"
 *
 * const pane: Pane = {
 *   id: "w1:t1:p1" as PaneId,
 *   tabId: "w1:t1" as TabId,
 *   workspaceId: "w1" as WorkspaceId,
 * }
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface Pane {
  readonly id: PaneId
  readonly tabId: TabId
  readonly workspaceId: WorkspaceId
}

/**
 * A tab's stable identity: its own id plus the workspace containing it.
 *
 * @category models
 * @since 0.1.0
 */
export interface Tab {
  readonly id: TabId
  readonly workspaceId: WorkspaceId
}

/**
 * A workspace's stable identity.
 *
 * @category models
 * @since 0.1.0
 */
export interface Workspace {
  readonly id: WorkspaceId
}

// =============================================================================
// Snapshot types — point-in-time state captures
// =============================================================================

/**
 * The timestamp every snapshot type carries, stamped SDK-side (via
 * Effect's `Clock`) at decode time — diagnostic only, never a source of
 * ordering truth against herdr's own `revision` counters.
 *
 * @category models
 * @since 0.1.0
 */
export interface SnapshotCaptured {
  readonly capturedAt: DateTime.Utc
}

/**
 * A pane's state as of `capturedAt`. Returned by `snapshotPane`,
 * `listPanes`, and `currentPane`.
 *
 * **Example** (reading a pane's cwd)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, snapshotPane } from "effect-herdr"
 * import type { PaneId } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* snapshotPane({ id: "w1:t1:p1" as PaneId })
 *   return pane.cwd
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneSnapshot extends Pane, SnapshotCaptured {
  /** Herdr's own monotonic per-pane counter. Comparable across snapshots of the same pane. */
  readonly revision: number
  readonly cwd: string
  readonly agent: Agent | undefined
  readonly agentStatus: AgentStatus
  readonly focused: boolean
}

/**
 * A tab's state as of `capturedAt`. Returned by `currentTab` and the
 * `focus.ts` lookups. Has no `activePaneId` field — herdr's per-tab active
 * pane is only available via a `session.snapshot` layout entry, which
 * `activePane` reads under the hood.
 *
 * @category models
 * @since 0.1.0
 */
export interface TabSnapshot extends Tab, SnapshotCaptured {
  readonly label: string
  readonly focused: boolean
  readonly paneCount: number
  readonly agentStatus: AgentStatus
}

/**
 * A workspace's state as of `capturedAt`. Returned by `currentWorkspace`
 * and the `focus.ts` lookups.
 *
 * @category models
 * @since 0.1.0
 */
export interface WorkspaceSnapshot extends Workspace, SnapshotCaptured {
  readonly label: string
  readonly activeTabId: TabId
  readonly focused: boolean
  readonly tabCount: number
  readonly paneCount: number
  readonly agentStatus: AgentStatus
}
