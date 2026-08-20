/**
 * Combinators for creating, mutating, and reading tab lifecycle.
 *
 * Every combinator here operates on `Tab` identity (its `id`/
 * `workspaceId`), not a snapshot. `listTabs` is the one exception worth
 * calling out: unlike `listPanes` (which decodes `pane.list`'s wire into
 * `PaneSnapshot`, since it already carries `cwd`/`agent`/`focused`),
 * `tab.list`'s wire has no snapshot-worthy fields the SDK's `TabSnapshot`
 * doesn't already need a dedicated round-trip for, so `listTabs` returns
 * bare `Tab` identity. There is no `snapshotTab` yet (see the `TODO` on
 * `createTab`); callers who need current state today go through
 * `currentTab`/`focusedTab` in `current.ts`/`focus.ts`.
 *
 * @since 0.1.0
 */

import { Effect, Function } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { Tab, TabId, Workspace, WorkspaceId } from "../protocol/schemas.js"
import { isTab, makeTab } from "../protocol/schemas.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * Options for `createTab`. All optional — herdr defaults `focus` to
 * `false` server-side, creates the tab in the focused workspace when
 * `workspace` is omitted, and picks a `cwd`/`label` itself when omitted.
 *
 * @category models
 * @since 0.1.0
 */
export interface CreateTabOptions {
  readonly workspace?: Workspace
  readonly cwd?: string
  readonly label?: string
  readonly focus?: boolean
}

/**
 * Creates a new tab (with an initial root pane), returning the new tab's
 * identity — not a snapshot, same discipline as `splitPane` returning a
 * bare `Pane`. herdr's reply also echoes the new root pane, which is
 * discarded here.
 *
 * TODO(#14): no `snapshotTab` combinator exists yet, so a caller needing
 * the new tab's full state (or the new root pane herdr also created) has
 * nothing to call afterwards — flagged as a gap in #14's resolution, out
 * of this ticket's scope.
 *
 * **Example** (creating a tab in the current workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, createTab } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   const tab = yield* createTab({ workspace: workspace.value, label: "feature-x" })
 *   yield* Effect.log(tab.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const createTab = (
  options?: CreateTabOptions,
): Effect.Effect<Tab, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["tab.create"]({
      workspace_id: options?.workspace?.id ?? null,
      cwd: options?.cwd ?? null,
      label: options?.label ?? null,
      focus: options?.focus,
    })
    return makeTab({
      id: result.tab.tab_id as TabId,
      workspaceId: result.tab.workspace_id as WorkspaceId,
    })
  })

/**
 * Closes `tab` and every pane it contains. Resolves to `void` on success.
 *
 * **Example** (closing a tab)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, closeTab, createTab } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   const tab = yield* createTab({ workspace: workspace.value })
 *   yield* closeTab(tab)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const closeTab = (tab: Tab): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["tab.close"]({ tab_id: tab.id })
  })

/**
 * Renames `tab` to `label`. Discards herdr's echoed reply, resolving to
 * `void`. Dual-shaped: data-first (`renameTab(tab, label)`) and data-last
 * (`tab.pipe(renameTab(label))`).
 *
 * **Example** (renaming a tab)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentTab, renameTab } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const tab = yield* currentTab
 *   if (Option.isNone(tab)) return
 *   yield* renameTab(tab.value, "renamed")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const renameTab: {
  (tab: Tab, label: string): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (label: string): (tab: Tab) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isTab(args[0]),
  (tab: Tab, label: string) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["tab.rename"]({ tab_id: tab.id, label })
    }),
)

/**
 * Focuses `tab`. Not dual-shaped — focus is a global mutation, not a
 * relation between two values, same reasoning as `focusPane`. Discards
 * herdr's echoed reply, resolving to `void`.
 *
 * **Example** (focusing a tab)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentTab, focusTab } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const tab = yield* currentTab
 *   if (Option.isNone(tab)) return
 *   yield* focusTab(tab.value)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const focusTab = (tab: Tab): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["tab.focus"]({ tab_id: tab.id })
  })

/**
 * Moves `tab` to `index` within its own workspace's tab order. Discards
 * herdr's echoed reply (that workspace's whole reordered tab list),
 * resolving to `void`. Dual-shaped: data-first (`moveTab(tab, index)`)
 * and data-last (`tab.pipe(moveTab(index))`).
 *
 * **Example** (moving a tab to the front)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentTab, moveTab } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const tab = yield* currentTab
 *   if (Option.isNone(tab)) return
 *   yield* moveTab(tab.value, 0)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const moveTab: {
  (tab: Tab, index: number): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (index: number): (tab: Tab) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isTab(args[0]),
  (tab: Tab, index: number) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["tab.move"]({ tab_id: tab.id, insert_index: index })
    }),
)

/**
 * Lists tabs, as bare identity (not snapshots — see this module's
 * top-of-file note on why `tab.list`'s wire doesn't warrant a snapshot
 * decode the way `pane.list`'s does). Lists every tab across every
 * workspace when `workspace` is omitted, mirroring `listPanes`'s
 * optional-workspace scoping.
 *
 * **Example** (listing tabs in the current workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, listTabs } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   const tabs = yield* listTabs(workspace.value)
 *   yield* Effect.log(tabs.map((t) => t.id))
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const listTabs = (
  workspace?: Workspace,
): Effect.Effect<ReadonlyArray<Tab>, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["tab.list"]({ workspace_id: workspace?.id ?? null })
    return result.tabs.map((wire) =>
      makeTab({
        id: wire.tab_id as TabId,
        workspaceId: wire.workspace_id as WorkspaceId,
      })
    )
  })
