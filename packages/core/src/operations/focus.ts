/**
 * Focus combinators — three families with distinct semantics.
 *
 * `active*(parent)` reads the child a container remembers as active
 * (always resolves — herdr's schema guarantees it exists). `focused*`
 * reads the entity herdr reports as globally focused right now (nullable,
 * so `Option`-wrapped). `focusedPaneRef` is a live-updating view of the
 * globally focused pane, fed by herdr's event-push stream.
 *
 * @since 0.1.0
 */

import { DateTime, Effect, Option, Scope, Stream, SubscriptionRef } from "effect"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import { HerdrConnection } from "../HerdrConnection.js"
import type { HerdrEventPush, HerdrSubscribeAckError } from "../HerdrEventsSocket.js"
import { HerdrSession } from "../HerdrSession.js"
import { HerdrProtocolError } from "../protocol/errors.js"
import type { TabInfoWire, WorkspaceInfoWire } from "../protocol/HerdrRpcs.js"
import type {
  PaneId,
  PaneSnapshot,
  Tab,
  TabId,
  TabSnapshot,
  Workspace,
  WorkspaceId,
  WorkspaceSnapshot,
} from "../protocol/schemas.js"
import { snapshotPane } from "./pane.js"

// `Tab` has a `workspaceId` field, `Workspace` does not — the runtime discriminant for `activePane`'s sum-typed argument.
const isTab = (parent: Tab | Workspace): parent is Tab => "workspaceId" in parent

const decodeTabSnapshot = (wire: TabInfoWire): Effect.Effect<TabSnapshot> =>
  Effect.map(DateTime.now, (capturedAt) => ({
    id: wire.tab_id as TabId,
    workspaceId: wire.workspace_id as WorkspaceId,
    label: wire.label,
    focused: wire.focused,
    paneCount: wire.pane_count,
    agentStatus: wire.agent_status,
    capturedAt,
  }))

const decodeWorkspaceSnapshot = (wire: WorkspaceInfoWire): Effect.Effect<WorkspaceSnapshot> =>
  Effect.map(DateTime.now, (capturedAt) => ({
    id: wire.workspace_id as WorkspaceId,
    label: wire.label,
    activeTabId: wire.active_tab_id as TabId,
    focused: wire.focused,
    tabCount: wire.tab_count,
    paneCount: wire.pane_count,
    agentStatus: wire.agent_status,
    capturedAt,
  }))

// Per-container active-child

/**
 * The pane that `parent` (a `Tab` or `Workspace`) remembers as active.
 * Always resolves (returns a snapshot, not an `Option`) — herdr guarantees
 * at least one pane per tab within an active session.
 *
 * **Example** (the active pane of the current workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, activePane, currentWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   const pane = yield* activePane(workspace.value)
 *   yield* Effect.log(pane.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const activePane = (
  parent: Tab | Workspace,
): Effect.Effect<PaneSnapshot, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession

    const tabId = isTab(parent)
      ? parent.id
      : (yield* session.rpc["workspace.get"]({ workspace_id: parent.id })).workspace.active_tab_id

    const snapshotResult = yield* session.rpc["session.snapshot"]()
    const layout = snapshotResult.snapshot.layouts.find((entry) => entry.tab_id === tabId)
    if (layout === undefined) {
      return yield* Effect.fail(
        new HerdrProtocolError({
          code: "tab_not_found",
          rawMessage: `session.snapshot has no layout for tab ${tabId}`,
        }),
      )
    }

    return yield* snapshotPane({ id: layout.focused_pane_id as PaneId })
  })

/**
 * The tab that `workspace` remembers as active. Always resolves — herdr
 * guarantees a workspace always has an active tab.
 *
 * **Example** (the active tab of the current workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, activeTab, currentWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   const tab = yield* activeTab(workspace.value)
 *   yield* Effect.log(tab.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const activeTab = (
  workspace: Workspace,
): Effect.Effect<TabSnapshot, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const workspaceResult = yield* session.rpc["workspace.get"]({ workspace_id: workspace.id })
    const tabResult = yield* session.rpc["tab.get"]({ tab_id: workspaceResult.workspace.active_tab_id })
    return yield* decodeTabSnapshot(tabResult.tab)
  })

// Global focus

/**
 * The pane herdr reports as globally focused right now. `Option.none()`
 * when nothing is focused (transient unfocus, headless server).
 *
 * **Example** (logging the focused pane)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, focusedPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* focusedPane
 *   if (Option.isSome(pane)) yield* Effect.log(pane.value.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const focusedPane: Effect.Effect<
  Option.Option<PaneSnapshot>,
  HerdrProtocolError | RpcClientError,
  HerdrSession
> = Effect.gen(function*() {
  const session = yield* HerdrSession
  const result = yield* session.rpc["session.snapshot"]()
  const paneId = result.snapshot.focused_pane_id
  if (paneId === null) return Option.none()
  const pane = yield* snapshotPane({ id: paneId as PaneId })
  return Option.some(pane)
})

/**
 * The tab herdr reports as globally focused right now. `Option.none()`
 * when nothing is focused.
 *
 * **Example** (logging the focused tab)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, focusedTab } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const tab = yield* focusedTab
 *   if (Option.isSome(tab)) yield* Effect.log(tab.value.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const focusedTab: Effect.Effect<
  Option.Option<TabSnapshot>,
  HerdrProtocolError | RpcClientError,
  HerdrSession
> = Effect.gen(function*() {
  const session = yield* HerdrSession
  const result = yield* session.rpc["session.snapshot"]()
  const tabId = result.snapshot.focused_tab_id
  if (tabId === null) return Option.none()
  const tabResult = yield* session.rpc["tab.get"]({ tab_id: tabId })
  const tab = yield* decodeTabSnapshot(tabResult.tab)
  return Option.some(tab)
})

/**
 * The workspace herdr reports as globally focused right now. `Option.none()`
 * when nothing is focused.
 *
 * **Example** (logging the focused workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, focusedWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* focusedWorkspace
 *   if (Option.isSome(workspace)) yield* Effect.log(workspace.value.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const focusedWorkspace: Effect.Effect<
  Option.Option<WorkspaceSnapshot>,
  HerdrProtocolError | RpcClientError,
  HerdrSession
> = Effect.gen(function*() {
  const session = yield* HerdrSession
  const result = yield* session.rpc["session.snapshot"]()
  const workspaceId = result.snapshot.focused_workspace_id
  if (workspaceId === null) return Option.none()
  const workspaceResult = yield* session.rpc["workspace.get"]({ workspace_id: workspaceId })
  const workspace = yield* decodeWorkspaceSnapshot(workspaceResult.workspace)
  return Option.some(workspace)
})

/**
 * Read-only surface `focusedPaneRef` hands back — `.get`/`.changes`, never
 * `.set`. Callers change focus by calling `focusPane`, not by writing to
 * this ref directly.
 *
 * @category models
 * @since 0.1.0
 */
export interface FocusedPaneRef {
  readonly get: Effect.Effect<Option.Option<PaneSnapshot>>
  readonly changes: Stream.Stream<Option.Option<PaneSnapshot>>
}

/**
 * A live-updating view of the globally focused pane. Read-only from the
 * caller's POV (see `FocusedPaneRef`) — to change focus, call
 * `focusPane(pane)` and this ref updates itself on herdr's next
 * `pane_focused` broadcast. Requires a `Scope` — the underlying event
 * subscription is torn down when the scope closes.
 *
 * **Example** (subscribing to focus changes)
 *
 * ```ts
 * import { BunFileSystem } from "@effect/platform-bun"
 * import { Effect, Stream } from "effect"
 * import { HerdrSession, HerdrConnection, focusedPaneRef } from "effect-herdr"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function*() {
 *     const ref = yield* focusedPaneRef
 *     yield* Stream.runForEach(ref.changes, (pane) => Effect.log(pane))
 *   }),
 * )
 *
 * program.pipe(
 *   Effect.provide(HerdrSession.Live),
 *   Effect.provide(HerdrConnection.Live),
 *   Effect.provide(BunFileSystem.layer),
 *   Effect.runPromise,
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const focusedPaneRef: Effect.Effect<
  FocusedPaneRef,
  HerdrProtocolError | RpcClientError | HerdrSubscribeAckError,
  HerdrSession | HerdrConnection | Scope.Scope
> = Effect.gen(function*() {
  const connection = yield* HerdrConnection
  const initial = yield* focusedPane
  const ref = yield* SubscriptionRef.make(initial)

  const pushes = yield* connection.subscribeEvents(["pane.focused"])

  const focusedPaneIds = pushes.pipe(
    Stream.filter((push): push is HerdrEventPush & { readonly data: { readonly pane_id: string } } =>
      push.event === "pane_focused" && typeof push.data["pane_id"] === "string"),
    Stream.map((push) => push.data.pane_id as PaneId),
  )

  yield* Stream.runForEach(focusedPaneIds, (paneId) =>
    snapshotPane({ id: paneId }).pipe(
      Effect.flatMap((snapshot) => SubscriptionRef.set(ref, Option.some(snapshot))),
      Effect.ignore,
    )).pipe(Effect.forkScoped)

  return {
    get: SubscriptionRef.get(ref),
    changes: SubscriptionRef.changes(ref),
  }
})

