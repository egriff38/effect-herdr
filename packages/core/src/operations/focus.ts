/**
 * Focus combinators — three families with distinct semantics.
 *
 *   active*(parent)   — the child a container remembers as active. Herdr's
 *                       schema guarantees this exists (WorkspaceInfo.active_tab_id
 *                       and PaneLayoutSnapshot.focused_pane_id are non-null),
 *                       so the return type has no Option.
 *
 *   focused*          — the globally focused entity right now. SessionSnapshot's
 *                       focused_pane_id is nullable (transient unfocus, headless
 *                       server) — Option-wrapped.
 *
 *   focusedPaneRef    — live-updating SubscriptionRef fed by events.subscribe.
 *                       Read-only from the caller's POV; to change focus, call
 *                       `focusPane(pane)` and the ref updates on herdr's broadcast.
 *
 * CORRECTION vs. issue #9's own spec text (found during implementation):
 * the issue claimed `tab.get`'s `TabInfo` wire shape exposes a
 * `focused_pane_id` field to drill `activePane(tab)` from directly — this
 * is WRONG, confirmed absent from the real wire (see `schemas.ts`'s
 * `TabSnapshot` comment and `HerdrRpcs.ts`'s `TabInfoWire`). The real
 * per-tab active-pane source is `session.snapshot`'s `layouts[]` array (a
 * `PaneLayoutSnapshotWire`, keyed by `tab_id`, carrying its own
 * `focused_pane_id`) — verified live against a real herdr server (2-pane
 * split + focus) during implementation of this slice. So `activePane(tab)`
 * calls `session.snapshot` and scans `layouts` for the matching `tab_id`,
 * not `tab.get`.
 */

import { DateTime, Effect, Option } from "effect"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
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

/**
 * `Tab` has a `workspaceId` field; `Workspace` does not (see `schemas.ts`'s
 * `Pane`/`Tab`/`Workspace` identity interfaces) — the runtime discriminant
 * for `activePane`'s sum-typed argument.
 */
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

// =============================================================================
// Per-container active-child (@211-b)
// =============================================================================

/**
 * The pane that `parent` remembers as active. Sum-typed argument (@#2):
 * one function, one signature, internal branching on Tab vs. Workspace.
 *
 * `activePane(tab)`       → `session.snapshot`, find the `layouts[]` entry
 *                           whose `tab_id` matches, read its `focused_pane_id`.
 * `activePane(workspace)` → `workspace.get` → `active_tab_id`, then the same
 *                           `session.snapshot` layout drill as above.
 *
 * Always resolves (returns a snapshot, not an Option) — herdr guarantees
 * >=1 pane per tab per workspace within an active session. Stale ids fail
 * with HerdrProtocolError.
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
 * The tab that `workspace` remembers as active.
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

// =============================================================================
// Global focus (@211-c)
// =============================================================================

/**
 * The pane herdr reports as globally focused right now. `Option.none`
 * when nothing is focused (transient unfocus, headless server) — that's
 * a session-level nullable in herdr's own schema (`session.snapshot`'s
 * top-level `focused_pane_id`).
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
 * Live-updating view of the globally focused pane. Read-only from the
 * caller's POV — `SubscriptionRef` exposes `.get` and `.changes`, not
 * `.set`. To change focus, call `focusPane(pane)` and the ref updates on
 * herdr's next broadcast.
 *
 * Scoped: the underlying events.subscribe stream lives while the caller's
 * scope does.
 */
export declare const focusedPaneRef: unknown /* Effect.Effect<
  SubscriptionRef.SubscriptionRef<Option.Option<PaneSnapshot>>,
  HerdrProtocolError,
  HerdrSession | Scope.Scope
> */

