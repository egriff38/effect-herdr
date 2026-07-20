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
 * Read-only surface `focusedPaneRef` hands back — `.get`/`.changes`, never
 * `.set`. A real `SubscriptionRef` already has exactly these two functions
 * as free functions over `self` (see `SubscriptionRef.get`/`.changes`), so
 * this interface isn't a runtime wrapper for safety — it's what stops this
 * module's own return statement from accidentally leaking the writable
 * `SubscriptionRef` itself. Nothing in this module calls
 * `SubscriptionRef.set` on the caller's behalf; only this file's own
 * background loop does.
 */
export interface FocusedPaneRef {
  readonly get: Effect.Effect<Option.Option<PaneSnapshot>>
  readonly changes: Stream.Stream<Option.Option<PaneSnapshot>>
}

/**
 * Live-updating view of the globally focused pane. Read-only from the
 * caller's POV (see `FocusedPaneRef` above) — to change focus, call
 * `focusPane(pane)` (already implemented in `pane.ts`) and this ref updates
 * itself on herdr's next `pane_focused` broadcast.
 *
 * Initial value: this file's own `focusedPane` combinator (a real
 * `session.snapshot` round-trip — never a placeholder `Option.none()`).
 * Live updates: `connection.subscribeEvents(["pane.focused"])`, filtered to
 * `event === "pane_focused"` pushes (underscore form — the wire's push-side
 * form, NOT the dotted subscription-request form used above), each
 * resolved to a fresh `PaneSnapshot` via `snapshotPane`.
 *
 * Scoping (issue #10/slice 9's "connection-scope teardown" requirement):
 * `connection.subscribeEvents` itself already forks its persistent socket
 * into a scope that is BOTH a child of the connection's own scope AND torn
 * down by this call's own ambient scope (see `HerdrConnection.ts`'s
 * `subscribeEvents` implementation) — so the push stream this function
 * consumes already ends when either scope closes, with no extra wiring
 * needed here. The loop that consumes it and calls `SubscriptionRef.set`
 * is forked into the ordinary ambient scope via `Effect.forkScoped`
 * (matching `HerdrWireProtocol.ts`'s own idiom for its background read
 * loop) — once the push stream ends (for either of the reasons above), the
 * loop's `Stream.runForEach` completes and the fiber exits on its own; a
 * failure on that stream (e.g. the daemon dying) similarly ends the loop,
 * it just isn't surfaced back to a caller who already received the ref.
 *
 * A `snapshotPane` lookup that fails for one particular push (e.g. the
 * newly-focused pane was already closed by the time this resolves it) is
 * swallowed rather than clobbering the ref with a guess — the ref keeps its
 * last known-good value and simply skips that one update.
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

