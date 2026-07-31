/**
 * The typed RpcGroup for herdr's socket protocol.
 *
 * v1 ships `ping`, `workspace.list`, `workspace.get`, `pane.list`,
 * `pane.get`, `tab.get`, `pane.split`, `pane.focus`, `session.snapshot`,
 * `pane.send_text`, `pane.close`, `pane.read`, and `pane.wait_for_output`.
 * Every method here is a plain request/reply — `pane.wait_for_output`
 * and `events.wait` both block server-side until match-or-timeout and
 * reply exactly once, neither is `RpcSchema.Stream`. herdr's one true
 * server-push stream, `events.subscribe`, lives outside this `RpcGroup`
 * (see `HerdrConnection.subscribeEvents`) because its socket stays open
 * across multiple pushes, unlike every method modeled here. Most SDK
 * users never touch this module directly — reach for `HerdrSession`'s
 * `rpc` client or the `operations/` combinators built on top of it
 * instead.
 *
 * @since 0.1.0
 */

import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { HerdrProtocolError } from "./errors.js"

// =============================================================================
// Wire schemas — mirror herdr's ResponseResult variants and ErrorBody 1:1
// =============================================================================

/** Decodes `ping`'s reply, `{"type":"pong"}`. */
export class PongResult extends Schema.Class<PongResult>("PongResult")({
  type: Schema.Literal("pong"),
}) {}

/** One entry of herdr's `WorkspaceInfo`, from `workspace.list` / `workspace.get`. */
export class WorkspaceInfoWire extends Schema.Class<WorkspaceInfoWire>("WorkspaceInfoWire")({
  workspace_id: Schema.String,
  number: Schema.Number,
  label: Schema.String,
  focused: Schema.Boolean,
  active_tab_id: Schema.String,
  tab_count: Schema.Number,
  pane_count: Schema.Number,
  agent_status: Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
}) {}

/** Decodes `workspace.list`'s reply. */
export class WorkspaceListResult extends Schema.Class<WorkspaceListResult>("WorkspaceListResult")({
  type: Schema.Literal("workspace_list"),
  workspaces: Schema.Array(WorkspaceInfoWire),
}) {}

/** Decodes `workspace.get`'s reply. */
export class WorkspaceInfoResult extends Schema.Class<WorkspaceInfoResult>("WorkspaceInfoResult")({
  type: Schema.Literal("workspace_info"),
  workspace: WorkspaceInfoWire,
}) {}

/** One entry of herdr's `TabInfo`, from `tab.get`. */
export class TabInfoWire extends Schema.Class<TabInfoWire>("TabInfoWire")({
  tab_id: Schema.String,
  workspace_id: Schema.String,
  number: Schema.Number,
  label: Schema.String,
  focused: Schema.Boolean,
  pane_count: Schema.Number,
  agent_status: Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
}) {}

/** Decodes `tab.get`'s reply. */
export class TabInfoResult extends Schema.Class<TabInfoResult>("TabInfoResult")({
  type: Schema.Literal("tab_info"),
  tab: TabInfoWire,
}) {}

/**
 * One entry of herdr's `PaneInfo`, from `pane.list` / `pane.get`. Only the
 * subset of wire fields this SDK's value objects need is modeled — herdr
 * sends more (scroll, tokens, terminal_title, etc.), which the schema
 * decoder simply ignores.
 */
export class PaneInfoWire extends Schema.Class<PaneInfoWire>("PaneInfoWire")({
  pane_id: Schema.String,
  tab_id: Schema.String,
  workspace_id: Schema.String,
  terminal_id: Schema.String,
  focused: Schema.Boolean,
  agent_status: Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
  revision: Schema.Number,
  cwd: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

/** Decodes `pane.list`'s reply. */
export class PaneListResult extends Schema.Class<PaneListResult>("PaneListResult")({
  type: Schema.Literal("pane_list"),
  panes: Schema.Array(PaneInfoWire),
}) {}

/** Decodes `pane.get`'s reply — also reused by `pane.split` and `pane.focus`, which echo the same shape. */
export class PaneInfoResult extends Schema.Class<PaneInfoResult>("PaneInfoResult")({
  type: Schema.Literal("pane_info"),
  pane: PaneInfoWire,
}) {}

/**
 * One entry of `session.snapshot`'s `layouts` array — the per-tab pane
 * layout, keyed by `tab_id`. Only the fields needed to answer "which pane
 * is active within this tab" (`activePane`) are modeled; herdr's real
 * layout entry also carries `zoomed`/`area`/`panes`/`splits` geometry,
 * which is ignored.
 */
export class PaneLayoutSnapshotWire extends Schema.Class<PaneLayoutSnapshotWire>("PaneLayoutSnapshotWire")({
  workspace_id: Schema.String,
  tab_id: Schema.String,
  focused_pane_id: Schema.String,
}) {}

/**
 * Decodes `session.snapshot`'s reply. The per-tab active-pane source is
 * `snapshot.layouts[]` (keyed by `tab_id`), not a field on `TabInfo` —
 * `activePane(tab)` reads it from here. The three top-level
 * `focused_*_id` fields are nullable, which is the source of
 * `focusedPane`/`focusedTab`/`focusedWorkspace`'s `Option` wrapping. Only
 * the fields `operations/focus.ts` needs are modeled; herdr's real
 * `SessionSnapshot` also sends `agents`, which is ignored.
 */
export class SessionSnapshotResult extends Schema.Class<SessionSnapshotResult>("SessionSnapshotResult")({
  type: Schema.Literal("session_snapshot"),
  snapshot: Schema.Struct({
    focused_workspace_id: Schema.NullOr(Schema.String),
    focused_tab_id: Schema.NullOr(Schema.String),
    focused_pane_id: Schema.NullOr(Schema.String),
    workspaces: Schema.Array(WorkspaceInfoWire),
    tabs: Schema.Array(TabInfoWire),
    panes: Schema.Array(PaneInfoWire),
    layouts: Schema.Array(PaneLayoutSnapshotWire),
  }),
}) {}

/**
 * Decodes a bare success ack, `{"type":"ok"}` — `pane.send_text`'s and
 * `pane.close`'s reply. herdr's socket protocol has no separate "submit"
 * concept: for `pane.send_text`, the caller's `text` is typed verbatim
 * into the pane, and if it should also run, the caller must include a
 * trailing `\n` themselves.
 */
export class OkResult extends Schema.Class<OkResult>("OkResult")({
  type: Schema.Literal("ok"),
}) {}

/** One `pane.read` reply's `read` payload. */
export class PaneReadResult extends Schema.Class<PaneReadResult>("PaneReadResult")({
  type: Schema.Literal("pane_read"),
  read: Schema.Struct({
    pane_id: Schema.String,
    workspace_id: Schema.String,
    tab_id: Schema.String,
    source: Schema.Literals(["visible", "recent", "recent_unwrapped", "detection"]),
    format: Schema.Literals(["text", "ansi"]),
    text: Schema.String,
    revision: Schema.Number,
    truncated: Schema.Boolean,
  }),
}) {}

/**
 * `pane.wait_for_output`'s `match` payload — a discriminated union of
 * substring and regex matchers.
 *
 * @category models
 * @since 0.1.0
 */
export const OutputMatch = Schema.Union([
  Schema.Struct({ type: Schema.Literal("substring"), value: Schema.String }),
  Schema.Struct({ type: Schema.Literal("regex"), value: Schema.String }),
])

/**
 * The decoded type of {@link OutputMatch}.
 *
 * @category models
 * @since 0.1.0
 */
export type OutputMatch = typeof OutputMatch.Type

/**
 * Decodes `pane.wait_for_output`'s success reply on a match. Nests the
 * same `read` shape `PaneReadResult` models, duplicated inline as a bare
 * struct rather than referencing `PaneReadResult` itself, since here it's
 * a nested field rather than a top-level reply.
 */
export class PaneWaitForOutputResult
  extends Schema.Class<PaneWaitForOutputResult>("PaneWaitForOutputResult")({
    type: Schema.Literal("output_matched"),
    pane_id: Schema.String,
    revision: Schema.Number,
    matched_line: Schema.String,
    read: Schema.Struct({
      pane_id: Schema.String,
      workspace_id: Schema.String,
      tab_id: Schema.String,
      source: Schema.Literals(["visible", "recent", "recent_unwrapped", "detection"]),
      format: Schema.Literals(["text", "ansi"]),
      text: Schema.String,
      revision: Schema.Number,
      truncated: Schema.Boolean,
    }),
  })
{}

/** Decodes `pane.rename`'s reply — echoes the mutated pane's state, same shape as `pane.get`. */
export class PaneRenameResult extends Schema.Class<PaneRenameResult>("PaneRenameResult")({
  type: Schema.Literal("pane_info"),
  pane: PaneInfoWire,
}) {}

/**
 * One rectangle within a `PaneLayoutSnapshotFullWire` — shared by pane
 * rects and split-divider rects.
 */
export class PaneLayoutRectWire extends Schema.Class<PaneLayoutRectWire>("PaneLayoutRectWire")({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
}) {}

/** One pane's placement within `PaneLayoutSnapshotFullWire.panes`. */
export class PaneLayoutPaneWire extends Schema.Class<PaneLayoutPaneWire>("PaneLayoutPaneWire")({
  pane_id: Schema.String,
  focused: Schema.Boolean,
  rect: PaneLayoutRectWire,
}) {}

/** One split divider within `PaneLayoutSnapshotFullWire.splits`. */
export class PaneLayoutSplitWire extends Schema.Class<PaneLayoutSplitWire>("PaneLayoutSplitWire")({
  id: Schema.String,
  direction: Schema.Literals(["right", "down"]),
  ratio: Schema.Number,
  rect: PaneLayoutRectWire,
}) {}

/**
 * The full `PaneLayoutSnapshot` wire shape — `pane.layout`'s `layout`
 * payload, and the nested `layout` field every spatial pane mutation
 * (`pane.move`/`pane.swap`/`pane.resize`/`pane.zoom`/`pane.neighbor`/
 * `pane.edges`/`pane.focus_direction`) echoes back. Distinct from
 * `PaneLayoutSnapshotWire` above, which only models the three fields
 * `session.snapshot`'s `layouts[]`/`activePane` need (`workspace_id`/
 * `tab_id`/`focused_pane_id`) — this models every field, since
 * `paneLayout`'s result decodes the whole thing.
 */
export class PaneLayoutSnapshotFullWire extends Schema.Class<PaneLayoutSnapshotFullWire>("PaneLayoutSnapshotFullWire")({
  workspace_id: Schema.String,
  tab_id: Schema.String,
  zoomed: Schema.Boolean,
  area: PaneLayoutRectWire,
  focused_pane_id: Schema.String,
  panes: Schema.Array(PaneLayoutPaneWire),
  splits: Schema.Array(PaneLayoutSplitWire),
}) {}

/** Decodes `pane.layout`'s reply. */
export class PaneLayoutResult extends Schema.Class<PaneLayoutResult>("PaneLayoutResult")({
  type: Schema.Literal("pane_layout"),
  layout: PaneLayoutSnapshotFullWire,
}) {}

/** Decodes `pane.move`'s reply. Models every field the wire's `PaneMoveResult` carries — `changed`/`reason`/the moved pane's echoed state/the target tab's fresh layout — even though `movePane` only surfaces the new `Pane` identity, discarding the rest. */
export class PaneMoveWireResult extends Schema.Class<PaneMoveWireResult>("PaneMoveWireResult")({
  type: Schema.Literal("pane_move"),
  move_result: Schema.Struct({
    changed: Schema.Boolean,
    previous_pane_id: Schema.String,
    previous_workspace_id: Schema.String,
    previous_tab_id: Schema.String,
    pane: PaneInfoWire,
    closed_tab_id: Schema.optional(Schema.NullOr(Schema.String)),
    closed_workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
    created_tab: Schema.optional(Schema.NullOr(TabInfoWire)),
    created_workspace: Schema.optional(Schema.NullOr(WorkspaceInfoWire)),
    reason: Schema.optional(Schema.NullOr(Schema.Literals(["same_tab", "zoomed_tab"]))),
    source_layout: Schema.optional(Schema.NullOr(PaneLayoutSnapshotFullWire)),
    target_layout: PaneLayoutSnapshotFullWire,
    focused_pane_id: Schema.String,
  }),
}) {}

/** Decodes `pane.swap`'s reply. Models every field the wire's `PaneSwapResult` carries, even though `swapPane` discards the whole reply (no new identity is created). */
export class PaneSwapWireResult extends Schema.Class<PaneSwapWireResult>("PaneSwapWireResult")({
  type: Schema.Literal("pane_swap"),
  swap: Schema.Struct({
    changed: Schema.Boolean,
    source_pane_id: Schema.String,
    target_pane_id: Schema.optional(Schema.NullOr(Schema.String)),
    focused_pane_id: Schema.String,
    reason: Schema.optional(Schema.NullOr(Schema.Literals(["no_neighbor", "same_pane", "not_found", "cross_tab"]))),
    layout: PaneLayoutSnapshotFullWire,
  }),
}) {}

/** Decodes `pane.resize`'s reply. Models every field the wire's `PaneResizeResult` carries, even though `resizePane` discards the whole reply. */
export class PaneResizeWireResult extends Schema.Class<PaneResizeWireResult>("PaneResizeWireResult")({
  type: Schema.Literal("pane_resize"),
  resize: Schema.Struct({
    changed: Schema.Boolean,
    pane_id: Schema.String,
    focused_pane_id: Schema.String,
    reason: Schema.optional(Schema.NullOr(Schema.Literals(["unchanged"]))),
    layout: PaneLayoutSnapshotFullWire,
  }),
}) {}

/** Decodes `pane.zoom`'s reply. Models every field the wire's `PaneZoomResult` carries, even though `zoomPane` discards the whole reply. */
export class PaneZoomWireResult extends Schema.Class<PaneZoomWireResult>("PaneZoomWireResult")({
  type: Schema.Literal("pane_zoom"),
  zoom: Schema.Struct({
    changed: Schema.Boolean,
    zoom_changed: Schema.Boolean,
    focus_changed: Schema.Boolean,
    pane_id: Schema.String,
    focused_pane_id: Schema.String,
    zoomed: Schema.Boolean,
    reason: Schema.optional(Schema.NullOr(Schema.Literals(["single_pane", "already_zoomed", "already_unzoomed"]))),
    layout: PaneLayoutSnapshotFullWire,
  }),
}) {}

/** Decodes `pane.focus_direction`'s reply. Models every field the wire's `PaneFocusDirectionResult` carries, even though `focusPaneDirection` discards the whole reply. */
export class PaneFocusDirectionWireResult
  extends Schema.Class<PaneFocusDirectionWireResult>("PaneFocusDirectionWireResult")({
    type: Schema.Literal("pane_focus_direction"),
    focus: Schema.Struct({
      changed: Schema.Boolean,
      source_pane_id: Schema.String,
      focused_pane_id: Schema.optional(Schema.NullOr(Schema.String)),
      reason: Schema.optional(Schema.NullOr(Schema.Literals(["no_neighbor"]))),
      layout: PaneLayoutSnapshotFullWire,
    }),
  })
{}

/** Decodes `pane.neighbor`'s reply. `neighbor.neighbor_pane_id` is nullable — `paneNeighbor` maps it to `Option`. */
export class PaneNeighborResult extends Schema.Class<PaneNeighborResult>("PaneNeighborResult")({
  type: Schema.Literal("pane_neighbor"),
  neighbor: Schema.Struct({
    pane_id: Schema.String,
    direction: Schema.Literals(["left", "right", "up", "down"]),
    neighbor_pane_id: Schema.optional(Schema.NullOr(Schema.String)),
    layout: PaneLayoutSnapshotFullWire,
  }),
}) {}

/** Decodes `pane.edges`'s reply. */
export class PaneEdgesResult extends Schema.Class<PaneEdgesResult>("PaneEdgesResult")({
  type: Schema.Literal("pane_edges"),
  edges: Schema.Struct({
    pane_id: Schema.String,
    left: Schema.Boolean,
    right: Schema.Boolean,
    up: Schema.Boolean,
    down: Schema.Boolean,
    layout: PaneLayoutSnapshotFullWire,
  }),
}) {}

/** Decodes `pane.current`'s reply — echoes the resolved pane's full state, same shape as `pane.get`. */
export class PaneCurrentResult extends Schema.Class<PaneCurrentResult>("PaneCurrentResult")({
  type: Schema.Literal("pane_current"),
  pane: PaneInfoWire,
}) {}

/** One process herdr found in a pane's foreground process group, from `pane.process_info`. */
export class PaneProcessInfoProcessWire extends Schema.Class<PaneProcessInfoProcessWire>("PaneProcessInfoProcessWire")({
  pid: Schema.Number,
  name: Schema.String,
  argv: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  argv0: Schema.optional(Schema.NullOr(Schema.String)),
  cmdline: Schema.optional(Schema.NullOr(Schema.String)),
  cwd: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

/** Decodes `pane.process_info`'s reply. */
export class PaneProcessInfoResult extends Schema.Class<PaneProcessInfoResult>("PaneProcessInfoResult")({
  type: Schema.Literal("pane_process_info"),
  process_info: Schema.Struct({
    pane_id: Schema.String,
    shell_pid: Schema.optional(Schema.NullOr(Schema.Number)),
    tty: Schema.optional(Schema.NullOr(Schema.String)),
    foreground_process_group_id: Schema.optional(Schema.NullOr(Schema.Number)),
    foreground_processes: Schema.Array(PaneProcessInfoProcessWire),
  }),
}) {}

/** One entry of herdr's `WorktreeInfo`, from `worktree.list` / echoed by `worktree.create` / `worktree.open`. */
export class WorktreeInfoWire extends Schema.Class<WorktreeInfoWire>("WorktreeInfoWire")({
  path: Schema.String,
  label: Schema.String,
  branch: Schema.NullOr(Schema.String),
  is_bare: Schema.Boolean,
  is_detached: Schema.Boolean,
  is_linked_worktree: Schema.Boolean,
  is_prunable: Schema.Boolean,
  open_workspace_id: Schema.NullOr(Schema.String),
}) {}

/** herdr's `WorktreeSourceInfo` — the repo metadata scoping a `worktree.list` query. */
export class WorktreeSourceInfoWire extends Schema.Class<WorktreeSourceInfoWire>("WorktreeSourceInfoWire")({
  repo_key: Schema.String,
  repo_name: Schema.String,
  repo_root: Schema.String,
  source_checkout_path: Schema.String,
  source_workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

/** Decodes `worktree.list`'s reply. */
export class WorktreeListResult extends Schema.Class<WorktreeListResult>("WorktreeListResult")({
  type: Schema.Literal("worktree_list"),
  source: WorktreeSourceInfoWire,
  worktrees: Schema.Array(WorktreeInfoWire),
}) {}

/** Decodes `worktree.create`'s reply. */
export class WorktreeCreatedResult extends Schema.Class<WorktreeCreatedResult>("WorktreeCreatedResult")({
  type: Schema.Literal("worktree_created"),
  workspace: WorkspaceInfoWire,
  tab: TabInfoWire,
  root_pane: PaneInfoWire,
  worktree: WorktreeInfoWire,
}) {}

/** Decodes `worktree.open`'s reply. `already_open` is true iff the worktree already had a live workspace, which is returned as-is instead of creating a second one. */
export class WorktreeOpenedResult extends Schema.Class<WorktreeOpenedResult>("WorktreeOpenedResult")({
  type: Schema.Literal("worktree_opened"),
  workspace: WorkspaceInfoWire,
  tab: TabInfoWire,
  root_pane: PaneInfoWire,
  worktree: WorktreeInfoWire,
  already_open: Schema.Boolean,
}) {}

/** Decodes `worktree.remove`'s reply. Drops the echoed `workspace_id` in the SDK-level result — redundant with the caller's input. */
export class WorktreeRemovedResult extends Schema.Class<WorktreeRemovedResult>("WorktreeRemovedResult")({
  type: Schema.Literal("worktree_removed"),
  workspace_id: Schema.String,
  path: Schema.String,
  forced: Schema.Boolean,
}) {}

/** Decodes `notification.show`'s reply — `shown` tells callers whether the toast actually displayed; `reason` explains a suppression (disabled/rate-limited/no client/busy) as well as a successful `"shown"`. */
export class NotificationShowResult extends Schema.Class<NotificationShowResult>("NotificationShowResult")({
  type: Schema.Literal("notification_show"),
  shown: Schema.Boolean,
  reason: Schema.Literals(["shown", "disabled", "rate_limited", "no_foreground_client", "busy"]),
}) {}

/** herdr's `IntegrationTarget` — the agent CLI names herdr's shell integration can target. */
export const IntegrationTarget = Schema.Literals([
  "pi",
  "omp",
  "claude",
  "codex",
  "copilot",
  "devin",
  "droid",
  "kimi",
  "opencode",
  "kilo",
  "hermes",
  "qodercli",
  "cursor",
  "mastracode",
])

/** Decodes `integration.install`'s reply. `details.messages` carries install-specific human-readable detail (e.g. what was written/skipped) worth surfacing to the caller, not discarded like an `OkResult`. */
export class IntegrationInstallResult extends Schema.Class<IntegrationInstallResult>("IntegrationInstallResult")({
  type: Schema.Literal("integration_install"),
  target: IntegrationTarget,
  details: Schema.Struct({
    messages: Schema.Array(Schema.String),
  }),
}) {}

/** Decodes `integration.uninstall`'s reply. Same shape as {@link IntegrationInstallResult}, kept as a separate class since the two operations are semantically distinct replies on the wire. */
export class IntegrationUninstallResult extends Schema.Class<IntegrationUninstallResult>("IntegrationUninstallResult")({
  type: Schema.Literal("integration_uninstall"),
  target: IntegrationTarget,
  details: Schema.Struct({
    messages: Schema.Array(Schema.String),
  }),
}) {}

/**
 * `events.wait`'s `match_event` payload — a discriminated union of every
 * lifecycle event herdr can match on, one variant per `event` const,
 * mirroring `schemas.request.$defs.EventMatch` field-for-field (including
 * which filter fields are required vs. optional/nullable per kind).
 *
 * @category models
 * @since 0.1.0
 */
export const EventMatch = Schema.Union([
  Schema.Struct({
    event: Schema.Literal("workspace_created"),
    workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({ event: Schema.Literal("workspace_updated"), workspace_id: Schema.String }),
  Schema.Struct({ event: Schema.Literal("workspace_closed"), workspace_id: Schema.String }),
  Schema.Struct({
    event: Schema.Literal("workspace_renamed"),
    workspace_id: Schema.String,
    label: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({ event: Schema.Literal("workspace_moved"), workspace_id: Schema.String }),
  Schema.Struct({ event: Schema.Literal("workspace_focused"), workspace_id: Schema.String }),
  Schema.Struct({
    event: Schema.Literal("tab_created"),
    tab_id: Schema.optional(Schema.NullOr(Schema.String)),
    workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({ event: Schema.Literal("tab_closed"), tab_id: Schema.String }),
  Schema.Struct({
    event: Schema.Literal("tab_renamed"),
    tab_id: Schema.String,
    label: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({ event: Schema.Literal("tab_moved"), tab_id: Schema.String }),
  Schema.Struct({ event: Schema.Literal("tab_focused"), tab_id: Schema.String }),
  Schema.Struct({
    event: Schema.Literal("pane_created"),
    pane_id: Schema.optional(Schema.NullOr(Schema.String)),
    workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({ event: Schema.Literal("pane_closed"), pane_id: Schema.String }),
  Schema.Struct({ event: Schema.Literal("pane_focused"), pane_id: Schema.String }),
  Schema.Struct({ event: Schema.Literal("pane_moved"), pane_id: Schema.String }),
  Schema.Struct({
    event: Schema.Literal("pane_output_changed"),
    pane_id: Schema.String,
    min_revision: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
  Schema.Struct({ event: Schema.Literal("pane_exited"), pane_id: Schema.String }),
  Schema.Struct({
    event: Schema.Literal("pane_agent_detected"),
    pane_id: Schema.String,
    agent: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    event: Schema.Literal("pane_agent_status_changed"),
    pane_id: Schema.String,
    agent_status: Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
  }),
])

/**
 * The decoded type of {@link EventMatch}.
 *
 * @category models
 * @since 0.1.0
 */
export type EventMatch = typeof EventMatch.Type

/**
 * Every lifecycle event kind herdr can push, mirroring
 * `schemas.success_response.$defs.EventKind`'s full enum.
 *
 * @category models
 * @since 0.1.0
 */
export const EventKind = Schema.Literals([
  "workspace_created",
  "workspace_updated",
  "workspace_metadata_updated",
  "workspace_closed",
  "workspace_renamed",
  "workspace_moved",
  "workspace_focused",
  "worktree_created",
  "worktree_opened",
  "worktree_removed",
  "tab_created",
  "tab_closed",
  "tab_renamed",
  "tab_moved",
  "tab_focused",
  "pane_created",
  "pane_closed",
  "pane_updated",
  "pane_focused",
  "pane_moved",
  "pane_output_changed",
  "pane_exited",
  "pane_agent_detected",
  "pane_agent_status_changed",
  "layout_updated",
])

/**
 * `EventEnvelope.data`'s payload, a discriminated union keyed by `type`,
 * one variant per {@link EventKind} — mirroring
 * `schemas.success_response.$defs.EventData`. Nested object fields reuse
 * this module's existing `*Wire` classes (`WorkspaceInfoWire`/
 * `TabInfoWire`/`PaneInfoWire`/`WorktreeInfoWire`/`PaneLayoutSnapshotWire`)
 * rather than duplicating their shapes.
 *
 * @category models
 * @since 0.1.0
 */
export const EventData = Schema.Union([
  Schema.Struct({ type: Schema.Literal("workspace_created"), workspace: WorkspaceInfoWire }),
  Schema.Struct({ type: Schema.Literal("workspace_updated"), workspace: WorkspaceInfoWire }),
  Schema.Struct({ type: Schema.Literal("workspace_metadata_updated"), workspace: WorkspaceInfoWire }),
  Schema.Struct({
    type: Schema.Literal("workspace_closed"),
    workspace_id: Schema.String,
    workspace: Schema.optional(Schema.NullOr(WorkspaceInfoWire)),
  }),
  Schema.Struct({
    type: Schema.Literal("workspace_renamed"),
    workspace_id: Schema.String,
    label: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("workspace_moved"),
    workspace_id: Schema.String,
    insert_index: Schema.Number,
    workspaces: Schema.Array(WorkspaceInfoWire),
  }),
  Schema.Struct({ type: Schema.Literal("workspace_focused"), workspace_id: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("worktree_created"),
    workspace: WorkspaceInfoWire,
    worktree: WorktreeInfoWire,
  }),
  Schema.Struct({
    type: Schema.Literal("worktree_opened"),
    workspace: WorkspaceInfoWire,
    worktree: WorktreeInfoWire,
    already_open: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("worktree_removed"),
    workspace_id: Schema.String,
    workspace: Schema.optional(Schema.NullOr(WorkspaceInfoWire)),
    worktree: WorktreeInfoWire,
    forced: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("tab_created"), tab: TabInfoWire }),
  Schema.Struct({
    type: Schema.Literal("tab_closed"),
    tab_id: Schema.String,
    workspace_id: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tab_renamed"),
    tab_id: Schema.String,
    workspace_id: Schema.String,
    label: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tab_moved"),
    tab_id: Schema.String,
    workspace_id: Schema.String,
    insert_index: Schema.Number,
    tabs: Schema.Array(TabInfoWire),
  }),
  Schema.Struct({
    type: Schema.Literal("tab_focused"),
    tab_id: Schema.String,
    workspace_id: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("pane_created"), pane: PaneInfoWire }),
  Schema.Struct({
    type: Schema.Literal("pane_closed"),
    pane_id: Schema.String,
    workspace_id: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("pane_updated"), pane: PaneInfoWire }),
  Schema.Struct({
    type: Schema.Literal("pane_focused"),
    pane_id: Schema.String,
    workspace_id: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("pane_moved"),
    previous_pane_id: Schema.String,
    previous_workspace_id: Schema.String,
    previous_tab_id: Schema.String,
    pane: PaneInfoWire,
    closed_tab_id: Schema.optional(Schema.NullOr(Schema.String)),
    closed_workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
    created_tab: Schema.optional(Schema.NullOr(TabInfoWire)),
    created_workspace: Schema.optional(Schema.NullOr(WorkspaceInfoWire)),
  }),
  Schema.Struct({
    type: Schema.Literal("pane_output_changed"),
    pane_id: Schema.String,
    workspace_id: Schema.String,
    revision: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("pane_exited"),
    pane_id: Schema.String,
    workspace_id: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("pane_agent_detected"),
    pane_id: Schema.String,
    workspace_id: Schema.String,
    agent: Schema.optional(Schema.NullOr(Schema.String)),
    final_status: Schema.optional(Schema.NullOr(Schema.Literals(["idle", "working", "blocked", "done", "unknown"]))),
    released: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("pane_agent_status_changed"),
    pane_id: Schema.String,
    workspace_id: Schema.String,
    agent_status: Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
    agent: Schema.optional(Schema.NullOr(Schema.String)),
    display_agent: Schema.optional(Schema.NullOr(Schema.String)),
    title: Schema.optional(Schema.NullOr(Schema.String)),
    state_labels: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
  Schema.Struct({ type: Schema.Literal("layout_updated"), layout: PaneLayoutSnapshotWire }),
])

/**
 * The decoded type of {@link EventData}.
 *
 * @category models
 * @since 0.1.0
 */
export type EventData = typeof EventData.Type

/**
 * One pushed/matched herdr lifecycle event — `event` names the kind,
 * `data` carries its kind-specific payload. Mirrors
 * `schemas.success_response.$defs.EventEnvelope`; the wire naming
 * (`event: "pane_focused"`, underscore form) matches `HerdrEventPush.event`
 * from `HerdrEventsSocket.ts` exactly.
 *
 * @category models
 * @since 0.1.0
 */
export class EventEnvelopeWire extends Schema.Class<EventEnvelopeWire>("EventEnvelopeWire")({
  event: EventKind,
  data: EventData,
}) {}

/**
 * Decodes `events.wait`'s success reply on a match — herdr's
 * `success_response.$defs.ResponseResult`'s `wait_matched` variant.
 *
 * @category models
 * @since 0.1.0
 */
export class EventsWaitResult extends Schema.Class<EventsWaitResult>("EventsWaitResult")({
  type: Schema.Literal("wait_matched"),
  event: EventEnvelopeWire,
}) {}

/** Decodes `workspace.create`'s reply. */
export class WorkspaceCreatedResult extends Schema.Class<WorkspaceCreatedResult>("WorkspaceCreatedResult")({
  type: Schema.Literal("workspace_created"),
  workspace: WorkspaceInfoWire,
  tab: TabInfoWire,
  root_pane: PaneInfoWire,
}) {}

/** Decodes `workspace.rename`'s and `workspace.focus`'s reply — both echo the mutated workspace's state, same shape as `workspace.get`. */
export class WorkspaceRenameOrFocusResult
  extends Schema.Class<WorkspaceRenameOrFocusResult>("WorkspaceRenameOrFocusResult")({
    type: Schema.Literal("workspace_info"),
    workspace: WorkspaceInfoWire,
  })
{}

/** Decodes `workspace.move`'s reply — the whole reordered workspace list, same shape as `workspace.list`. */
export class WorkspaceMoveResult extends Schema.Class<WorkspaceMoveResult>("WorkspaceMoveResult")({
  type: Schema.Literal("workspace_list"),
  workspaces: Schema.Array(WorkspaceInfoWire),
}) {}

/** Decodes `tab.create`'s reply. */
export class TabCreatedResult extends Schema.Class<TabCreatedResult>("TabCreatedResult")({
  type: Schema.Literal("tab_created"),
  tab: TabInfoWire,
  root_pane: PaneInfoWire,
}) {}

/** Decodes `tab.rename`'s and `tab.focus`'s reply — both echo the mutated tab's state, same shape as `tab.get`. */
export class TabRenameOrFocusResult extends Schema.Class<TabRenameOrFocusResult>("TabRenameOrFocusResult")({
  type: Schema.Literal("tab_info"),
  tab: TabInfoWire,
}) {}

/** Decodes `tab.move`'s and `tab.list`'s reply — the (whole or reordered) tab list for one workspace. */
export class TabListResult extends Schema.Class<TabListResult>("TabListResult")({
  type: Schema.Literal("tab_list"),
  tabs: Schema.Array(TabInfoWire),
}) {}

/** herdr's `AgentSessionInfo` — the session identity attached to an agent, from `AgentInfo.agent_session`. */
export class AgentSessionInfoWire extends Schema.Class<AgentSessionInfoWire>("AgentSessionInfoWire")({
  source: Schema.String,
  agent: Schema.String,
  kind: Schema.String,
  value: Schema.String,
}) {}

/**
 * One entry of herdr's `AgentInfo`, from `agent.list`/`agent.get`/echoed
 * by `agent.rename`/`agent.focus`/`agent.start`. Only the subset of
 * wire fields this SDK's `AgentSnapshot` needs is modeled.
 */
export class AgentInfoWire extends Schema.Class<AgentInfoWire>("AgentInfoWire")({
  pane_id: Schema.String,
  tab_id: Schema.String,
  workspace_id: Schema.String,
  terminal_id: Schema.String,
  focused: Schema.Boolean,
  revision: Schema.Number,
  agent_status: Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
  agent: Schema.optional(Schema.NullOr(Schema.String)),
  agent_session: Schema.optional(Schema.NullOr(AgentSessionInfoWire)),
  cwd: Schema.optional(Schema.NullOr(Schema.String)),
  display_agent: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  state_labels: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  tokens: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

/** Decodes `agent.list`'s reply. */
export class AgentListResult extends Schema.Class<AgentListResult>("AgentListResult")({
  type: Schema.Literal("agent_list"),
  agents: Schema.Array(AgentInfoWire),
}) {}

/** Decodes `agent.get`'s reply — also reused by `agent.rename`/`agent.focus`, which echo the same shape. */
export class AgentInfoResult extends Schema.Class<AgentInfoResult>("AgentInfoResult")({
  type: Schema.Literal("agent_info"),
  agent: AgentInfoWire,
}) {}

/** Decodes `agent.start`'s reply — the started agent's info plus the argv herdr actually launched. */
export class AgentStartedResult extends Schema.Class<AgentStartedResult>("AgentStartedResult")({
  type: Schema.Literal("agent_started"),
  agent: AgentInfoWire,
  argv: Schema.Array(Schema.String),
}) {}

/** Decodes `agent.explain`'s reply. `explain`'s shape is deliberately untyped debug output — decoded as `unknown`. */
export class AgentExplainResult extends Schema.Class<AgentExplainResult>("AgentExplainResult")({
  type: Schema.Literal("agent_explain"),
  explain: Schema.Unknown,
}) {}

/** Decodes `agent.view.set`'s and `agent.view.clear`'s reply. */
export class AgentViewResult extends Schema.Class<AgentViewResult>("AgentViewResult")({
  type: Schema.Literal("agent_view"),
  active: Schema.Boolean,
  source: Schema.optional(Schema.NullOr(Schema.String)),
  label: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

/**
 * `agent.view.set`'s `filter` payload — a recursive boolean-combinator
 * tree over field comparisons (`all`/`any`/`not`/`eq`/`exists`/`in`).
 * Passed through untyped: #18's resolution explicitly deferred fully
 * specing this filter DSL to implementation time, and this effect
 * version's `Schema` has no `suspend`/recursive-schema combinator to
 * model the self-referential `all`/`any`/`not` variants type-safely.
 * Callers build the filter object by hand against herdr's documented
 * shape; the SDK validates only that it's a plain object.
 *
 * @category models
 * @since 0.1.0
 */
export const AgentViewFilter = Schema.Record(Schema.String, Schema.Unknown)

/** `agent.view.set`'s `sort` payload — one sort key and direction. */
export class AgentViewSortWire extends Schema.Class<AgentViewSortWire>("AgentViewSortWire")({
  field: Schema.String,
  order: Schema.optional(Schema.Literals(["asc", "desc"])),
}) {}

// =============================================================================
// Self-reporting agent-state wire schemas — #23
// =============================================================================

/**
 * `pane.report_agent`'s `state` payload — a narrower enum than the
 * response-side `AgentStatus`: `"done"` is detection-derived, never
 * legitimately self-reported.
 */
export const PaneAgentState = Schema.Literals(["idle", "working", "blocked", "unknown"])

// =============================================================================
// The RpcGroup
// =============================================================================

/**
 * The complete typed RpcGroup herdr's `HerdrConnection`/`HerdrSession`
 * build their client from. Enumerates every method, its payload schema,
 * its success schema, and its error schema (`HerdrProtocolError`
 * uniformly).
 *
 * **Example** (calling a method through the built client)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const session = yield* HerdrSession
 *   const { workspaces } = yield* session.rpc["workspace.list"]()
 *   return workspaces
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export const HerdrRpcs = RpcGroup.make(
  Rpc.make("ping", {
    success: PongResult,
    error: HerdrProtocolError,
  }),
  Rpc.make("workspace.list", {
    success: WorkspaceListResult,
    error: HerdrProtocolError,
  }),
  Rpc.make("workspace.get", {
    payload: { workspace_id: Schema.String },
    success: WorkspaceInfoResult,
    error: HerdrProtocolError,
  }),
  Rpc.make("tab.get", {
    payload: { tab_id: Schema.String },
    success: TabInfoResult,
    error: HerdrProtocolError,
  }),
  Rpc.make("pane.list", {
    payload: { workspace_id: Schema.NullOr(Schema.String) },
    success: PaneListResult,
    error: HerdrProtocolError,
  }),
  Rpc.make("pane.get", {
    payload: { pane_id: Schema.String },
    success: PaneInfoResult,
    error: HerdrProtocolError,
  }),
  /**
   * Splits a pane. The wire also accepts `workspace_id`/`cwd`/`env`/`ratio`
   * (all optional), but only `target_pane_id`/`direction`/`focus` — what
   * `SplitOptions` exposes — are modeled here.
   */
  Rpc.make("pane.split", {
    payload: {
      target_pane_id: Schema.NullOr(Schema.String),
      direction: Schema.Literals(["right", "down"]),
      focus: Schema.optional(Schema.Boolean),
    },
    success: PaneInfoResult,
    error: HerdrProtocolError,
  }),
  /** Focuses a pane; replies with the newly-focused pane's echoed state. */
  Rpc.make("pane.focus", {
    payload: { pane_id: Schema.String },
    success: PaneInfoResult,
    error: HerdrProtocolError,
  }),
  /** Captures the whole session's state in one call; takes no params. */
  Rpc.make("session.snapshot", {
    success: SessionSnapshotResult,
    error: HerdrProtocolError,
  }),
  /**
   * Types text into a pane — herdr's only text-input method; there is no
   * separate "run" method. Submission is purely "does `text` end in
   * `\n`" — herdr appends nothing itself.
   */
  Rpc.make("pane.send_text", {
    payload: { pane_id: Schema.String, text: Schema.String },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /** Closes/destroys a pane; herdr collapses the parent tab/workspace if it was the last child. */
  Rpc.make("pane.close", {
    payload: { pane_id: Schema.String },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /**
   * Reads a pane's buffered output. `format`/`lines`/`strip_ansi` are also
   * accepted server-side (defaulting to `"text"`/unset/`true`) but unused
   * by any current SDK caller, so only `pane_id`/`source` are modeled.
   */
  Rpc.make("pane.read", {
    payload: {
      pane_id: Schema.String,
      source: Schema.Literals(["visible", "recent", "recent_unwrapped", "detection"]),
    },
    success: PaneReadResult,
    error: HerdrProtocolError,
  }),
  /**
   * Blocks until `match` appears in the pane's output or `timeout_ms`
   * elapses, then replies exactly once — a plain request/reply, not a
   * wire-level stream. On timeout, replies with a `HerdrProtocolError`
   * whose `code` is `"timeout"`. `lines`/`strip_ansi` are also accepted
   * server-side but unused by any current SDK caller, so only
   * `pane_id`/`source`/`match`/`timeout_ms` are modeled.
   */
  Rpc.make("pane.wait_for_output", {
    payload: {
      pane_id: Schema.String,
      source: Schema.Literals(["visible", "recent", "recent_unwrapped", "detection"]),
      match: OutputMatch,
      timeout_ms: Schema.optional(Schema.Number),
    },
    success: PaneWaitForOutputResult,
    error: HerdrProtocolError,
  }),
  /** Renames a pane's display label; `label: null` clears it. Echoes the mutated pane's state. */
  Rpc.make("pane.rename", {
    payload: {
      pane_id: Schema.String,
      label: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: PaneRenameResult,
    error: HerdrProtocolError,
  }),
  /**
   * Sends raw named key presses (arrow keys, function keys, modifiers) to
   * a pane — distinct from `pane.send_text`'s literal-character input.
   */
  Rpc.make("pane.send_keys", {
    payload: {
      pane_id: Schema.String,
      keys: Schema.Array(Schema.String),
    },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /**
   * Moves a pane to a new location — an existing tab's split, a brand-new
   * tab, or a brand-new workspace. `destination`'s three variants mirror
   * the wire's `PaneMoveDestination` discriminated union exactly.
   */
  Rpc.make("pane.move", {
    payload: {
      pane_id: Schema.String,
      destination: Schema.Union([
        Schema.Struct({
          type: Schema.Literal("tab"),
          tab_id: Schema.String,
          split: Schema.Literals(["right", "down"]),
          target_pane_id: Schema.optional(Schema.NullOr(Schema.String)),
          ratio: Schema.optional(Schema.NullOr(Schema.Number)),
        }),
        Schema.Struct({
          type: Schema.Literal("new_tab"),
          workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
          label: Schema.optional(Schema.NullOr(Schema.String)),
        }),
        Schema.Struct({
          type: Schema.Literal("new_workspace"),
          label: Schema.optional(Schema.NullOr(Schema.String)),
          tab_label: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ]),
      focus: Schema.optional(Schema.Boolean),
    },
    success: PaneMoveWireResult,
    error: HerdrProtocolError,
  }),
  /**
   * Swaps two panes' positions within a tab's layout. Either an explicit
   * `source_pane_id`/`target_pane_id` pair, or `pane_id`/`direction` to
   * swap with whichever neighbor lies that way — `swapPane` only exposes
   * the explicit source/target pair, dropping the direction-based mode.
   */
  Rpc.make("pane.swap", {
    payload: {
      pane_id: Schema.optional(Schema.NullOr(Schema.String)),
      source_pane_id: Schema.optional(Schema.NullOr(Schema.String)),
      target_pane_id: Schema.optional(Schema.NullOr(Schema.String)),
      direction: Schema.optional(Schema.NullOr(Schema.Literals(["left", "right", "up", "down"]))),
    },
    success: PaneSwapWireResult,
    error: HerdrProtocolError,
  }),
  /** Resizes a pane's split by `amount` (fraction of the split) in `direction`. */
  Rpc.make("pane.resize", {
    payload: {
      pane_id: Schema.optional(Schema.NullOr(Schema.String)),
      direction: Schema.Literals(["left", "right", "up", "down"]),
      amount: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: PaneResizeWireResult,
    error: HerdrProtocolError,
  }),
  /** Toggles or sets a pane's zoom (full-tab) state. */
  Rpc.make("pane.zoom", {
    payload: {
      pane_id: Schema.optional(Schema.NullOr(Schema.String)),
      mode: Schema.optional(Schema.Literals(["toggle", "on", "off"])),
    },
    success: PaneZoomWireResult,
    error: HerdrProtocolError,
  }),
  /** Focuses whichever pane lies `direction` of `pane_id` within its tab. */
  Rpc.make("pane.focus_direction", {
    payload: {
      pane_id: Schema.optional(Schema.NullOr(Schema.String)),
      direction: Schema.Literals(["left", "right", "up", "down"]),
    },
    success: PaneFocusDirectionWireResult,
    error: HerdrProtocolError,
  }),
  /** Finds whichever pane lies `direction` of `pane_id`, without focusing it. `neighbor_pane_id` is `null` if there is none. */
  Rpc.make("pane.neighbor", {
    payload: {
      pane_id: Schema.optional(Schema.NullOr(Schema.String)),
      direction: Schema.Literals(["left", "right", "up", "down"]),
    },
    success: PaneNeighborResult,
    error: HerdrProtocolError,
  }),
  /** Reports which of a pane's four sides has a neighboring pane within its tab. */
  Rpc.make("pane.edges", {
    payload: {
      pane_id: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: PaneEdgesResult,
    error: HerdrProtocolError,
  }),
  /**
   * Resolves the caller's own pane by env-var identity server-side —
   * distinct from this SDK's `currentPane` (which resolves from
   * `HERDR_PANE_ID` directly, no RPC round-trip). `currentPaneById`
   * wraps this for case-B callers with no env var of their own, passing
   * an explicit `caller_pane_id`.
   */
  Rpc.make("pane.current", {
    payload: {
      caller_pane_id: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: PaneCurrentResult,
    error: HerdrProtocolError,
  }),
  /** Reads a pane's current geometry — every pane's rect, every split divider, and zoom state. */
  Rpc.make("pane.layout", {
    payload: {
      pane_id: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: PaneLayoutResult,
    error: HerdrProtocolError,
  }),
  /** Reads a pane's shell/process state — shell PID, tty, and the foreground process group. */
  Rpc.make("pane.process_info", {
    payload: {
      pane_id: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: PaneProcessInfoResult,
    error: HerdrProtocolError,
  }),
  /** Lists git worktrees for the repo scoping `cwd` (or the given `workspace_id`). */
  Rpc.make("worktree.list", {
    payload: {
      cwd: Schema.optional(Schema.NullOr(Schema.String)),
      workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: WorktreeListResult,
    error: HerdrProtocolError,
  }),
  /** Creates a new git worktree (and an attached workspace/tab/pane) from `base`/`branch`/`path`. */
  Rpc.make("worktree.create", {
    payload: {
      base: Schema.optional(Schema.NullOr(Schema.String)),
      branch: Schema.optional(Schema.NullOr(Schema.String)),
      cwd: Schema.optional(Schema.NullOr(Schema.String)),
      focus: Schema.optional(Schema.Boolean),
      label: Schema.optional(Schema.NullOr(Schema.String)),
      path: Schema.optional(Schema.NullOr(Schema.String)),
      workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: WorktreeCreatedResult,
    error: HerdrProtocolError,
  }),
  /** Opens an existing git worktree as a workspace; replies with `already_open: true` and the existing workspace if it's already open, instead of creating a second one. */
  Rpc.make("worktree.open", {
    payload: {
      branch: Schema.optional(Schema.NullOr(Schema.String)),
      cwd: Schema.optional(Schema.NullOr(Schema.String)),
      focus: Schema.optional(Schema.Boolean),
      label: Schema.optional(Schema.NullOr(Schema.String)),
      path: Schema.optional(Schema.NullOr(Schema.String)),
      workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: WorktreeOpenedResult,
    error: HerdrProtocolError,
  }),
  /** Removes a git worktree by tearing down its open workspace. `workspace_id` is unconditionally required on the wire — there is no RPC-level handle for a worktree that isn't currently open. */
  Rpc.make("worktree.remove", {
    payload: {
      workspace_id: Schema.String,
      force: Schema.optional(Schema.Boolean),
    },
    success: WorktreeRemovedResult,
    error: HerdrProtocolError,
  }),
  /** Shows a desktop toast notification to the human operator. `shown`/`reason` in the reply are decoded, not discarded, so callers can tell a suppressed/DND notification from a real send. */
  Rpc.make("notification.show", {
    payload: {
      title: Schema.String,
      body: Schema.optional(Schema.NullOr(Schema.String)),
      position: Schema.optional(Schema.NullOr(Schema.Literals(["top-left", "top-right", "bottom-left", "bottom-right"]))),
      sound: Schema.optional(Schema.Literals(["none", "done", "request"])),
    },
    success: NotificationShowResult,
    error: HerdrProtocolError,
  }),
  /** Installs herdr's shell integration for the agent CLI named by `target`. */
  Rpc.make("integration.install", {
    payload: { target: IntegrationTarget },
    success: IntegrationInstallResult,
    error: HerdrProtocolError,
  }),
  /** Uninstalls herdr's shell integration for the agent CLI named by `target`. */
  Rpc.make("integration.uninstall", {
    payload: { target: IntegrationTarget },
    success: IntegrationUninstallResult,
    error: HerdrProtocolError,
  }),
  /** Creates a new workspace (with an initial tab/pane), optionally focusing it. */
  Rpc.make("workspace.create", {
    payload: {
      cwd: Schema.optional(Schema.NullOr(Schema.String)),
      label: Schema.optional(Schema.NullOr(Schema.String)),
      focus: Schema.optional(Schema.Boolean),
    },
    success: WorkspaceCreatedResult,
    error: HerdrProtocolError,
  }),
  /** Closes a workspace and every tab/pane it contains. */
  Rpc.make("workspace.close", {
    payload: { workspace_id: Schema.String },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /** Renames a workspace; replies with the mutated workspace's echoed state. */
  Rpc.make("workspace.rename", {
    payload: { workspace_id: Schema.String, label: Schema.String },
    success: WorkspaceRenameOrFocusResult,
    error: HerdrProtocolError,
  }),
  /** Focuses a workspace; replies with the mutated workspace's echoed state. */
  Rpc.make("workspace.focus", {
    payload: { workspace_id: Schema.String },
    success: WorkspaceRenameOrFocusResult,
    error: HerdrProtocolError,
  }),
  /** Moves a workspace to `insert_index` in the global workspace order; replies with the whole reordered list. */
  Rpc.make("workspace.move", {
    payload: { workspace_id: Schema.String, insert_index: Schema.Number },
    success: WorkspaceMoveResult,
    error: HerdrProtocolError,
  }),
  /** Creates a new tab (with an initial pane) in `workspace_id` (or the focused workspace if omitted), optionally focusing it. */
  Rpc.make("tab.create", {
    payload: {
      workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
      cwd: Schema.optional(Schema.NullOr(Schema.String)),
      label: Schema.optional(Schema.NullOr(Schema.String)),
      focus: Schema.optional(Schema.Boolean),
    },
    success: TabCreatedResult,
    error: HerdrProtocolError,
  }),
  /** Closes a tab and every pane it contains. */
  Rpc.make("tab.close", {
    payload: { tab_id: Schema.String },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /** Renames a tab; replies with the mutated tab's echoed state. */
  Rpc.make("tab.rename", {
    payload: { tab_id: Schema.String, label: Schema.String },
    success: TabRenameOrFocusResult,
    error: HerdrProtocolError,
  }),
  /** Focuses a tab; replies with the mutated tab's echoed state. */
  Rpc.make("tab.focus", {
    payload: { tab_id: Schema.String },
    success: TabRenameOrFocusResult,
    error: HerdrProtocolError,
  }),
  /** Moves a tab to `insert_index` within its own workspace's tab order; replies with that workspace's whole reordered tab list. */
  Rpc.make("tab.move", {
    payload: { tab_id: Schema.String, insert_index: Schema.Number },
    success: TabListResult,
    error: HerdrProtocolError,
  }),
  /** Lists tabs in `workspace_id` (or every tab across every workspace if omitted). */
  Rpc.make("tab.list", {
    payload: { workspace_id: Schema.NullOr(Schema.String) },
    success: TabListResult,
    error: HerdrProtocolError,
  }),
  /**
   * Blocks until an event matching `match_event` occurs, or `timeout_ms`
   * elapses, then replies exactly once — a plain request/reply, not a
   * wire-level stream, the same family as `pane.wait_for_output`. This is
   * distinct from `events.subscribe` (see `HerdrConnection.subscribeEvents`
   * / `HerdrEventsSocket.ts`), herdr's one true push-stream method, whose
   * socket stays open across multiple pushes. On timeout, replies with a
   * `HerdrProtocolError` whose `code` is `"timeout"`.
   */
  Rpc.make("events.wait", {
    payload: {
      match_event: EventMatch,
      timeout_ms: Schema.optional(Schema.Number),
    },
    success: EventsWaitResult,
    error: HerdrProtocolError,
  }),
  /** Lists every agent herdr currently tracks, across every workspace. */
  Rpc.make("agent.list", {
    success: AgentListResult,
    error: HerdrProtocolError,
  }),
  /** Resolves `target` — a pane id or a caller-assigned name, herdr disambiguates server-side — to its current `AgentInfo`. */
  Rpc.make("agent.get", {
    payload: { target: Schema.String },
    success: AgentInfoResult,
    error: HerdrProtocolError,
  }),
  /** Reads an agent's buffered terminal output — same reply shape as `pane.read`, resolved by agent target instead of pane id. */
  Rpc.make("agent.read", {
    payload: {
      target: Schema.String,
      source: Schema.Literals(["visible", "recent", "recent_unwrapped", "detection"]),
      lines: Schema.optional(Schema.NullOr(Schema.Number)),
      format: Schema.optional(Schema.Literals(["text", "ansi"])),
      strip_ansi: Schema.optional(Schema.Boolean),
    },
    success: PaneReadResult,
    error: HerdrProtocolError,
  }),
  /** Debug-only agent-detection explanation; `explain`'s shape is deliberately untyped. */
  Rpc.make("agent.explain", {
    payload: { target: Schema.String },
    success: AgentExplainResult,
    error: HerdrProtocolError,
  }),
  /** Renames an agent's display name; `name: null` clears it. Echoes the mutated agent's state. */
  Rpc.make("agent.rename", {
    payload: { target: Schema.String, name: Schema.optional(Schema.NullOr(Schema.String)) },
    success: AgentInfoResult,
    error: HerdrProtocolError,
  }),
  /** Focuses an agent's pane. Echoes the focused agent's state. */
  Rpc.make("agent.focus", {
    payload: { target: Schema.String },
    success: AgentInfoResult,
    error: HerdrProtocolError,
  }),
  /** Starts a known interactive agent kind inside an existing pane. */
  Rpc.make("agent.start", {
    payload: {
      name: Schema.String,
      kind: Schema.String,
      pane_id: Schema.String,
      args: Schema.optional(Schema.Array(Schema.String)),
      timeout_ms: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: AgentStartedResult,
    error: HerdrProtocolError,
  }),
  /** Sends raw named key presses to an agent's pane — same primitive as `pane.send_keys`, resolved by agent target. */
  Rpc.make("agent.send_keys", {
    payload: { target: Schema.String, keys: Schema.Array(Schema.String) },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /**
   * Submits `text` to an agent's active generation — distinct from
   * `agent.send_keys`'s raw key input. `wait`, if given, blocks the reply
   * until the agent reaches one of `wait.until`'s statuses or
   * `wait.timeout_ms` elapses.
   */
  Rpc.make("agent.prompt", {
    payload: {
      target: Schema.String,
      text: Schema.String,
      wait: Schema.optional(Schema.NullOr(Schema.Struct({
        until: Schema.optional(Schema.Array(Schema.Literals(["idle", "working", "blocked", "done", "unknown"]))),
        timeout_ms: Schema.optional(Schema.NullOr(Schema.Number)),
      }))),
    },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /** Blocks until an agent reaches one of `until`'s statuses, or `timeout_ms` elapses — a plain request/reply, not a subscription. */
  Rpc.make("agent.wait", {
    payload: {
      target: Schema.String,
      until: Schema.optional(Schema.Array(Schema.Literals(["idle", "working", "blocked", "done", "unknown"]))),
      timeout_ms: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: AgentInfoResult,
    error: HerdrProtocolError,
  }),
  /** Configures a named agent-list view's filter/sort for `source`. */
  Rpc.make("agent.view.set", {
    payload: {
      source: Schema.String,
      filter: Schema.optional(Schema.NullOr(AgentViewFilter)),
      label: Schema.optional(Schema.NullOr(Schema.String)),
      sort: Schema.optional(Schema.Array(AgentViewSortWire)),
    },
    success: AgentViewResult,
    error: HerdrProtocolError,
  }),
  /** Clears a named agent-list view's configuration for `source` (or every source if omitted). */
  Rpc.make("agent.view.clear", {
    payload: { source: Schema.optional(Schema.NullOr(Schema.String)) },
    success: AgentViewResult,
    error: HerdrProtocolError,
  }),
  /**
   * Reports a pane's agent lifecycle state — the only self-reporting call
   * that drives waits/notifications/rollups. `seq` is per-`(pane_id,
   * source)`; herdr silently ignores a stale or duplicate `seq`.
   */
  Rpc.make("pane.report_agent", {
    payload: {
      pane_id: Schema.String,
      source: Schema.String,
      agent: Schema.String,
      state: PaneAgentState,
      message: Schema.optional(Schema.NullOr(Schema.String)),
      agent_session_id: Schema.optional(Schema.NullOr(Schema.String)),
      agent_session_path: Schema.optional(Schema.NullOr(Schema.String)),
      seq: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /** Reports a pane's agent-session identity — state-independent, doesn't affect waits/notifications/rollups. */
  Rpc.make("pane.report_agent_session", {
    payload: {
      pane_id: Schema.String,
      source: Schema.String,
      agent: Schema.String,
      agent_session_id: Schema.optional(Schema.NullOr(Schema.String)),
      agent_session_path: Schema.optional(Schema.NullOr(Schema.String)),
      session_start_source: Schema.optional(Schema.NullOr(Schema.String)),
      seq: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /** Reports display-only pane metadata — title/labels/tokens. Never drives semantic agent state. */
  Rpc.make("pane.report_metadata", {
    payload: {
      pane_id: Schema.String,
      source: Schema.String,
      agent: Schema.optional(Schema.NullOr(Schema.String)),
      applies_to_source: Schema.optional(Schema.NullOr(Schema.String)),
      display_agent: Schema.optional(Schema.NullOr(Schema.String)),
      title: Schema.optional(Schema.NullOr(Schema.String)),
      state_labels: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      tokens: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
      ttl_ms: Schema.optional(Schema.NullOr(Schema.Number)),
      clear_display_agent: Schema.optional(Schema.Boolean),
      clear_title: Schema.optional(Schema.Boolean),
      clear_state_labels: Schema.optional(Schema.Boolean),
      seq: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /** Reports display-only workspace metadata — tokens only, same token-map contract as `pane.report_metadata`. */
  Rpc.make("workspace.report_metadata", {
    payload: {
      workspace_id: Schema.String,
      source: Schema.String,
      tokens: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
      ttl_ms: Schema.optional(Schema.NullOr(Schema.Number)),
      seq: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /**
   * Deregisters `agent` from a pane entirely — a subsequent `agent.get`
   * on that pane 404s with `agent_not_found`. Confirmed empirically
   * against a live herdr server; stronger than `clear_agent_authority`.
   */
  Rpc.make("pane.release_agent", {
    payload: {
      pane_id: Schema.String,
      source: Schema.String,
      agent: Schema.String,
      seq: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /**
   * Drops `source`'s live-status claim on a pane's agent state, resetting
   * `agent_status` to `unknown`. Confirmed empirically: scoped strictly
   * to the calling `source` — clearing a different source's authority is
   * a no-op (`ok`, but state is unchanged).
   */
  Rpc.make("pane.clear_agent_authority", {
    payload: {
      pane_id: Schema.String,
      source: Schema.optional(Schema.NullOr(Schema.String)),
      seq: Schema.optional(Schema.NullOr(Schema.Number)),
    },
    success: OkResult,
    error: HerdrProtocolError,
  }),
)

/**
 * The decoded type of {@link HerdrRpcs}.
 *
 * @category models
 * @since 0.1.0
 */
export type HerdrRpcs = typeof HerdrRpcs
