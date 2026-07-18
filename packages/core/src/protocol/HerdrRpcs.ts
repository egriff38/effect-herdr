/**
 * The typed RpcGroup for herdr's socket protocol.
 *
 * v1 currently ships: `ping`, `workspace.list`, `workspace.get`, `pane.list`,
 * `pane.get`, `tab.get`. Every subsequent slice adds methods to this group.
 *
 * CORRECTION vs. the original design sketch: `pane.wait_for_output` is a
 * plain request/reply on herdr's wire (confirmed against
 * `scripts/herdr-schema.json` and herdr.dev/docs/socket-api/ during
 * implementation) — herdr blocks server-side until match/timeout and
 * replies once. It is NOT `RpcSchema.Stream`. `events.subscribe` IS a real
 * server-push stream (ack on subscribe, then pushed events). Slice 9 will
 * add `events.subscribe` as `RpcSchema.Stream`; slice 6's `waitForOutput`
 * will be a plain request/reply wrapped to look stream-shaped at the
 * service layer if that ergonomic is still wanted, or changed to a plain
 * Effect — that's a slice-6 design decision, not a slice-1 concern.
 *
 * SECOND CORRECTION (D4, docs/design.md): herdr's socket closes after
 * exactly one request/reply for ordinary methods. `HerdrWireProtocol.ts`
 * handles this by dialing a fresh connection per call — irrelevant to the
 * schemas in this file, which only describe payload/success/error shapes.
 */

import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { HerdrProtocolError } from "./errors.js"

// =============================================================================
// Wire schemas — mirror herdr's ResponseResult variants and ErrorBody 1:1
// =============================================================================

/** `{"id":"req_1","result":{"type":"pong"}}` (herdr also sends version/protocol/capabilities; decoded loosely). */
export class PongResult extends Schema.Class<PongResult>("PongResult")({
  type: Schema.Literal("pong"),
}) {}

/**
 * One entry of herdr's `WorkspaceInfo` (from `workspace.list` / `workspace.get`).
 * No `revision` field — confirmed absent from herdr's real schema during
 * implementation of issue #4 (only `PaneInfo`/`AgentInfo` have `revision`).
 */
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

export class WorkspaceListResult extends Schema.Class<WorkspaceListResult>("WorkspaceListResult")({
  type: Schema.Literal("workspace_list"),
  workspaces: Schema.Array(WorkspaceInfoWire),
}) {}

export class WorkspaceInfoResult extends Schema.Class<WorkspaceInfoResult>("WorkspaceInfoResult")({
  type: Schema.Literal("workspace_info"),
  workspace: WorkspaceInfoWire,
}) {}

/** One entry of herdr's `TabInfo` (from `tab.get`). No `revision` field either. */
export class TabInfoWire extends Schema.Class<TabInfoWire>("TabInfoWire")({
  tab_id: Schema.String,
  workspace_id: Schema.String,
  number: Schema.Number,
  label: Schema.String,
  focused: Schema.Boolean,
  pane_count: Schema.Number,
  agent_status: Schema.Literals(["idle", "working", "blocked", "done", "unknown"]),
}) {}

export class TabInfoResult extends Schema.Class<TabInfoResult>("TabInfoResult")({
  type: Schema.Literal("tab_info"),
  tab: TabInfoWire,
}) {}

/**
 * One entry of herdr's `PaneInfo` (from `pane.list` / `pane.get`). Only a
 * subset of the real wire fields are modeled — the ones this SDK's value
 * objects need. herdr sends more (scroll, tokens, terminal_title, etc.);
 * unmodeled fields are ignored by the schema decoder, not an error.
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

export class PaneListResult extends Schema.Class<PaneListResult>("PaneListResult")({
  type: Schema.Literal("pane_list"),
  panes: Schema.Array(PaneInfoWire),
}) {}

export class PaneInfoResult extends Schema.Class<PaneInfoResult>("PaneInfoResult")({
  type: Schema.Literal("pane_info"),
  pane: PaneInfoWire,
}) {}

/**
 * One entry of herdr's `session.snapshot` `layouts` array — the per-tab
 * pane layout, keyed by `tab_id`. Only `workspace_id`/`tab_id`/
 * `focused_pane_id` are modeled — the SDK only needs "which pane is active
 * within this tab" (`activePane(tab)`, issue #9). herdr also sends `zoomed`,
 * `area`, `panes`, `splits` (full layout geometry); unmodeled, ignored by
 * the schema decoder, not an error.
 */
export class PaneLayoutSnapshotWire extends Schema.Class<PaneLayoutSnapshotWire>("PaneLayoutSnapshotWire")({
  workspace_id: Schema.String,
  tab_id: Schema.String,
  focused_pane_id: Schema.String,
}) {}

/**
 * `session.snapshot`'s result. CORRECTION vs. issue #9's own spec text: the
 * issue claimed `tab.get`'s `TabInfo` exposes a `focused_pane_id` field to
 * drill `activePane(tab)` from — confirmed ABSENT from the real wire (see
 * `TabInfoWire` above / `schemas.ts`'s `TabSnapshot` comment). The real
 * per-tab active-pane source is `SessionSnapshotResult.snapshot.layouts[]`
 * (a `PaneLayoutSnapshotWire`, keyed by `tab_id`), verified live against a
 * real herdr server (2-pane split + focus) during implementation of issue
 * #9. The three top-level `focused_*_id` fields are nullable (verified via
 * `scripts/herdr-schema.json`'s `SessionSnapshot` def) — that's the source
 * for `focusedPane`/`focusedTab`/`focusedWorkspace`'s `Option` wrapping.
 * Only the fields this SDK's `focus.ts` combinators need are modeled;
 * herdr's real `SessionSnapshot` also sends `agents` (unmodeled).
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

// =============================================================================
// The RpcGroup
// =============================================================================

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
   * `pane.split` payload — wire also accepts `workspace_id`, `cwd`, `env`,
   * `ratio` (all optional, confirmed via `scripts/herdr-schema.json`'s
   * `PaneSplitParams`) but the SDK's `SplitOptions` (operations/pane.ts,
   * issue #5) only exposes `direction`/`focus`, so only the fields the SDK
   * actually sends are modeled here. Result reuses `PaneInfoResult` — herdr
   * replies with the SAME `{"type":"pane_info","pane":<PaneInfo>}` shape
   * `pane.get` returns (verified live), not a distinct wire class.
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
  /** `pane.focus` also replies with `PaneInfoResult` (verified live) — the newly-focused pane's echoed state. */
  Rpc.make("pane.focus", {
    payload: { pane_id: Schema.String },
    success: PaneInfoResult,
    error: HerdrProtocolError,
  }),
  /** `session.snapshot` params are empty (`{}`, confirmed via `scripts/herdr-schema.json`'s `EmptyParams`). */
  Rpc.make("session.snapshot", {
    success: SessionSnapshotResult,
    error: HerdrProtocolError,
  }),
)

export type HerdrRpcs = typeof HerdrRpcs
