/**
 * Env-injected identity accessors — the SDK's only env boundary.
 *
 * Every accessor here answers "what pane/tab/workspace launched this
 * Effect program", based on herdr's `HERDR_PANE_ID`/`HERDR_TAB_ID`/
 * `HERDR_WORKSPACE_ID` env vars (resolved once at layer-build, in
 * `HerdrSession.ts`). `Option.none()` iff those env vars are unset — this
 * program isn't running inside a herdr-managed pane — with no RPC
 * round-trip in that case. Fails with `HerdrProtocolError | RpcClientError`
 * if the env vars are set but the id no longer resolves (e.g. the pane
 * was closed after launch); a caller that wants to treat that as "not in
 * herdr" can catch it explicitly with
 * `Effect.catchTag("HerdrProtocolError", () => Effect.succeed(Option.none()))`.
 *
 * @since 0.1.0
 */

import { DateTime, Effect, Option } from "effect"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { PaneSnapshot, TabId, TabSnapshot, WorkspaceId, WorkspaceSnapshot } from "../protocol/schemas.js"
import { snapshotPane } from "./pane.js"

/**
 * The pane that launched this Effect program, if any. `Option.none()`
 * when not running inside a herdr-managed pane.
 *
 * **Example** (the primary entry point)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, runInPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return yield* Effect.log("not in herdr")
 *   yield* runInPane(pane.value, "echo hello from effect-herdr")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
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

/**
 * The tab that launched this Effect program, if any. `Option.none()`
 * when not running inside a herdr-managed pane.
 *
 * **Example** (logging the current tab)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentTab } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const tab = yield* currentTab
 *   if (Option.isSome(tab)) yield* Effect.log(tab.value.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
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

/**
 * The workspace that launched this Effect program, if any. `Option.none()`
 * when not running inside a herdr-managed pane.
 *
 * **Example** (logging the current workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isSome(workspace)) yield* Effect.log(workspace.value.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
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
