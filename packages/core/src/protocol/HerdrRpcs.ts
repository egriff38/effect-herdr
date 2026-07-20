/**
 * The typed RpcGroup for herdr's socket protocol.
 *
 * v1 currently ships: `ping`, `workspace.list`, `workspace.get`, `pane.list`,
 * `pane.get`, `tab.get`, `pane.split`, `pane.focus`, `session.snapshot`,
 * `pane.send_text`, `pane.read`, `pane.wait_for_output`. Every subsequent
 * slice adds methods to this group.
 *
 * CORRECTION vs. the original design sketch: `pane.wait_for_output` is a
 * plain request/reply on herdr's wire (confirmed against
 * `scripts/herdr-schema.json` and a live probe during implementation of
 * issue #7/slice 6) — herdr blocks server-side until match/timeout and
 * replies once. It is NOT `RpcSchema.Stream`. `events.subscribe` IS a real
 * server-push stream (ack on subscribe, then pushed events); slice 9 adds
 * that separately, outside this `RpcGroup` (see `HerdrConnection.ts`'s
 * comments). `operations/pane.ts`'s `waitForOutput` (issue #7) wraps this
 * one blocking RPC call as a single-element `Stream` — an ergonomic
 * decision at the service layer, not a wire-level stream.
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

/**
 * `pane.send_text`'s success reply — a bare `{"type":"ok"}` ack with no
 * payload fields (confirmed live during implementation of issue #6/slice
 * 5). herdr's socket protocol has no separate "submit" concept: the
 * caller's `text` is typed verbatim into the pane, and if it should also
 * run, the caller must include a trailing `\n` themselves — herdr does not
 * append one. See `operations/pane.ts`'s `runInPane` for the SDK-level
 * batch semantics built on top of this bare ack.
 */
export class OkResult extends Schema.Class<OkResult>("OkResult")({
  type: Schema.Literal("ok"),
}) {}

/**
 * One `pane.read` reply's `read` payload (from `scripts/herdr-schema.json`'s
 * `PaneReadResult`, confirmed live). Added as a byproduct of issue #6's E2E
 * test (verifying `runInPane`'s text actually reached the pane's shell);
 * slice 6's `waitForOutput` (issue #7) also needs read-adjacent RPC access
 * and reuses this rather than inventing a second wire class — its own
 * `output_matched` reply nests the SAME `PaneReadResult` shape under a
 * `read` field (see the shared-context doc's wire facts).
 */
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
 * substring/regex matchers (confirmed via `scripts/herdr-schema.json`'s
 * `OutputMatch` and live probing during implementation of issue #7). No
 * existing discriminated-union example elsewhere in this codebase (every
 * prior wire type is a flat struct), so this follows `Schema.Union` of two
 * `type`-tagged `Schema.Struct`s — the natural encoding for a wire union
 * whose members are distinguished by a literal field, mirroring how herdr
 * itself models it.
 */
export const OutputMatch = Schema.Union([
  Schema.Struct({ type: Schema.Literal("substring"), value: Schema.String }),
  Schema.Struct({ type: Schema.Literal("regex"), value: Schema.String }),
])
export type OutputMatch = typeof OutputMatch.Type

/**
 * `pane.wait_for_output`'s success reply on a match (verified live during
 * implementation of issue #7): `{"type":"output_matched","pane_id",
 * "revision","matched_line","read":<PaneReadResult>}`. Nests the SAME
 * `read` shape `PaneReadResult` above models — declared as a bare struct
 * (not the `PaneReadResult` class itself) since here it's a nested field,
 * not a top-level reply; `PaneReadResult`'s own `read` sub-struct schema
 * is duplicated rather than referenced because `Schema.Class` fields
 * aren't reusable as struct fragments without unwrapping.
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
  /**
   * `pane.send_text` — herdr's ONLY text-input method (verified live during
   * implementation of issue #6/slice 5); there is no separate `pane.run`.
   * Params are exactly `{ pane_id, text }` — no submit/enter flag. Success
   * replies with a bare `OkResult` (`{"type":"ok"}`), no echoed pane state.
   * Submission is purely "does `text` end in `\n`" — herdr appends nothing.
   * See `operations/pane.ts`'s `runInPane` for the SDK's batch semantics.
   */
  Rpc.make("pane.send_text", {
    payload: { pane_id: Schema.String, text: Schema.String },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /**
   * `pane.close` — close/destroy a pane. Params `{pane_id}`; success reply
   * is a bare `OkResult` (`{"type":"ok"}`) per `scripts/herdr-schema.json`'s
   * `PaneTarget`/`OkResult`. herdr's built-in `pane.close` handles tab and
   * workspace collapse if the pane was the last child.
   */
  Rpc.make("pane.close", {
    payload: { pane_id: Schema.String },
    success: OkResult,
    error: HerdrProtocolError,
  }),
  /**
   * `pane.read` — added as a byproduct of issue #6's E2E verification (no
   * ergonomic SDK combinator wraps this yet; slice 6's `waitForOutput`,
   * issue #7, is the first to need read-adjacent access as a first-class
   * combinator). Params per `scripts/herdr-schema.json`'s `PaneReadParams`:
   * `pane_id`/`source` required, `format`/`lines`/`strip_ansi` optional —
   * only `pane_id`/`source` are modeled since that's all any current
   * caller sends; `format` defaults to `"text"`/`strip_ansi` to `true`
   * server-side when omitted (confirmed via the schema).
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
   * `pane.wait_for_output` — a BLOCKING plain request/reply (verified live
   * during implementation of issue #7): herdr holds the connection open
   * server-side until the match happens or `timeout_ms` elapses, then
   * replies exactly once. On timeout it replies with a real
   * `HerdrProtocolError` whose `code` is `"timeout"` (added to
   * `KnownHerdrErrorCode` in `errors.ts`), not a distinct wire signal.
   * Params per `scripts/herdr-schema.json`'s `PaneWaitForOutputParams`:
   * `lines`/`strip_ansi` are also accepted server-side but unused by any
   * current caller (`operations/pane.ts`'s `waitForOutput`), so only
   * `pane_id`/`source`/`match`/`timeout_ms` are modeled here.
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
)

export type HerdrRpcs = typeof HerdrRpcs
