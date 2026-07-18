/**
 * Env-injected identity accessors — the env boundary of the SDK.
 *
 * This is the only place in the SDK that reads `process.env` (via
 * `HerdrSession.currentIds`, resolved once at layer-build in
 * `HerdrSession.ts`). Every accessor here answers "what pane/tab/workspace
 * launched this Effect program", based on herdr's HERDR_PANE_ID /
 * HERDR_TAB_ID / HERDR_WORKSPACE_ID env vars.
 *
 * Behavior (per D1):
 *   - `Option.none` iff HERDR_ENV is unset (this program isn't running
 *     inside a herdr-managed pane) — no RPC round-trip in that case.
 *   - fails with `HerdrProtocolError | RpcClientError` if HERDR_* is set
 *     but the id no longer resolves (pane closed after launch, id
 *     compacted) or the transport itself fails. Fails loud — a caller
 *     that wants to interpret "closed pane" as "not in herdr" can do
 *     `Effect.catchTag("HerdrProtocolError", () => Effect.succeed(Option.none()))`
 *     explicitly.
 *
 * Kept in its own module (@#3) to make the env-boundary distinction
 * visually obvious.
 */

import { DateTime, Effect, Option } from "effect"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { PaneSnapshot, TabId, TabSnapshot, WorkspaceId, WorkspaceSnapshot } from "../protocol/schemas.js"
import { snapshotPane } from "./pane.js"

export const currentPane: Effect.Effect<
  Option.Option<PaneSnapshot>,
  HerdrProtocolError | RpcClientError,
  HerdrSession
> = Effect.gen(function*() {
  const session = yield* HerdrSession
  if (Option.isNone(session.currentIds)) return Option.none()
  const snapshot = yield* snapshotPane({ id: session.currentIds.value.paneId })
  return Option.some(snapshot)
})

export const currentTab: Effect.Effect<
  Option.Option<TabSnapshot>,
  HerdrProtocolError | RpcClientError,
  HerdrSession
> = Effect.gen(function*() {
  const session = yield* HerdrSession
  if (Option.isNone(session.currentIds)) return Option.none()
  const result = yield* session.rpc["tab.get"]({ tab_id: session.currentIds.value.tabId })
  const capturedAt = yield* DateTime.now
  return Option.some<TabSnapshot>({
    id: result.tab.tab_id as TabId,
    workspaceId: result.tab.workspace_id as WorkspaceId,
    label: result.tab.label,
    focused: result.tab.focused,
    paneCount: result.tab.pane_count,
    agentStatus: result.tab.agent_status,
    capturedAt,
  })
})

export const currentWorkspace: Effect.Effect<
  Option.Option<WorkspaceSnapshot>,
  HerdrProtocolError | RpcClientError,
  HerdrSession
> = Effect.gen(function*() {
  const session = yield* HerdrSession
  if (Option.isNone(session.currentIds)) return Option.none()
  const result = yield* session.rpc["workspace.get"]({ workspace_id: session.currentIds.value.workspaceId })
  const capturedAt = yield* DateTime.now
  return Option.some<WorkspaceSnapshot>({
    id: result.workspace.workspace_id as WorkspaceId,
    label: result.workspace.label,
    activeTabId: result.workspace.active_tab_id as TabId,
    focused: result.workspace.focused,
    tabCount: result.workspace.tab_count,
    paneCount: result.workspace.pane_count,
    agentStatus: result.workspace.agent_status,
    capturedAt,
  })
})
