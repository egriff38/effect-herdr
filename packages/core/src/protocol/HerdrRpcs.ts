/**
 * The typed RpcGroup for herdr's socket protocol.
 *
 * v1 (slice 1) ships two methods only — `ping` (connection liveness check)
 * and `workspace.list` (the foundation method chosen for slice 1's tracer
 * bullet, per issue #2). Every subsequent slice adds methods to this group.
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
 */

import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { HerdrProtocolError } from "./errors.js"

// =============================================================================
// Wire schemas — mirror herdr's ResponseResult variants and ErrorBody 1:1
// =============================================================================

/** `{"id":"req_1","result":{"type":"pong"}}` */
export class PongResult extends Schema.Class<PongResult>("PongResult")({
  type: Schema.Literal("pong"),
}) {}

/** One entry of herdr's `WorkspaceInfo` (from `workspace.list` / `workspace.get`). */
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

/** `{"id","result":{"type":"workspace_list","workspaces":[...]}}` */
export class WorkspaceListResult extends Schema.Class<WorkspaceListResult>("WorkspaceListResult")({
  type: Schema.Literal("workspace_list"),
  workspaces: Schema.Array(WorkspaceInfoWire),
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
)

export type HerdrRpcs = typeof HerdrRpcs
