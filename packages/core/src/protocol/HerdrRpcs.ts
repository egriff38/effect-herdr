/**
 * The typed RpcGroup for herdr's socket protocol.
 *
 * v1 ships `ping`, `workspace.list`, `workspace.get`, `pane.list`,
 * `pane.get`, `tab.get`, `pane.split`, `pane.focus`, `session.snapshot`,
 * `pane.send_text`, `pane.close`, `pane.read`, and `pane.wait_for_output`.
 * Every method here is a plain request/reply — `pane.wait_for_output`
 * blocks server-side until match-or-timeout and replies exactly once, it
 * is not `RpcSchema.Stream`. herdr's one true server-push stream,
 * `events.subscribe`, lives outside this `RpcGroup` (see
 * `HerdrConnection.subscribeEvents`) because its socket stays open across
 * multiple pushes, unlike every method modeled here. Most SDK users never
 * touch this module directly — reach for `HerdrSession`'s `rpc` client or
 * the `operations/` combinators built on top of it instead.
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
)

/**
 * The decoded type of {@link HerdrRpcs}.
 *
 * @category models
 * @since 0.1.0
 */
export type HerdrRpcs = typeof HerdrRpcs
