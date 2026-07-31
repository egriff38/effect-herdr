/**
 * Combinators for listing, creating, opening, and removing git worktrees.
 *
 * A `WorktreeInfo` has no server-issued opaque id — unlike `Pane`/`Tab`/
 * `Workspace`, whose whole point is a stable branded id — so there is no
 * `Worktree` identity type here. Its natural key is the filesystem `path`,
 * and several of its fields (`isPrunable`, `openWorkspaceId`) are
 * point-in-time mutable state, which is exactly what `WorktreeSnapshot`
 * exists for. `createWorktree`/`openWorktree` do surface a fresh
 * `Workspace`/`Tab`/`Pane` identity for the attached workspace they
 * create/reuse — same discipline as `createWorkspace`/`createTab`.
 *
 * @since 0.1.0
 */

import { DateTime, Effect, Function, Option } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type {
  Pane,
  PaneId,
  Tab,
  TabId,
  Workspace,
  WorkspaceId,
  WorktreeSnapshot,
  WorktreeSource,
} from "../protocol/schemas.js"
import { isWorkspace, makePane, makeTab, makeWorkspace } from "../protocol/schemas.js"
import type { WorktreeInfoWire, WorktreeSourceInfoWire } from "../protocol/HerdrRpcs.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

// Decodes herdr's worktree wire shape into a `WorktreeSnapshot`; `capturedAt` is stamped via Effect's Clock, not the wire.
const decodeWorktreeSnapshot = (wire: WorktreeInfoWire): Effect.Effect<WorktreeSnapshot> =>
  Effect.map(DateTime.now, (capturedAt) => ({
    path: wire.path,
    label: wire.label,
    branch: Option.fromNullOr(wire.branch),
    isBare: wire.is_bare,
    isDetached: wire.is_detached,
    isLinkedWorktree: wire.is_linked_worktree,
    isPrunable: wire.is_prunable,
    openWorkspaceId: Option.fromNullOr(wire.open_workspace_id) as Option.Option<WorkspaceId>,
    capturedAt,
  }))

// Decodes herdr's worktree-source wire shape into a `WorktreeSource` — no `capturedAt`, this is static repo metadata, not evolving state.
const decodeWorktreeSource = (wire: WorktreeSourceInfoWire): WorktreeSource => ({
  repoKey: wire.repo_key,
  repoName: wire.repo_name,
  repoRoot: wire.repo_root,
  sourceCheckoutPath: wire.source_checkout_path,
  sourceWorkspaceId: Option.fromNullOr(wire.source_workspace_id ?? null) as Option.Option<WorkspaceId>,
})

/**
 * Options for `listWorktrees`. `cwd` and `workspace` are independent
 * scoping dimensions — either selects which repo's worktrees herdr
 * returns.
 *
 * @category models
 * @since 0.1.0
 */
export interface ListWorktreesOptions {
  readonly cwd?: string
  readonly workspace?: Workspace
}

/**
 * Lists the git worktrees for the repo scoping `options.cwd` (or
 * `options.workspace`), as snapshots, alongside the repo metadata herdr
 * scoped the query to.
 *
 * **Example** (listing worktrees for the current workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, listWorktrees } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   const { worktrees } = yield* listWorktrees({ workspace: workspace.value })
 *   yield* Effect.log(worktrees.map((w) => w.path))
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const listWorktrees = (
  options?: ListWorktreesOptions,
): Effect.Effect<
  { readonly worktrees: ReadonlyArray<WorktreeSnapshot>; readonly source: WorktreeSource },
  HerdrProtocolError | RpcClientError,
  HerdrSession
> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["worktree.list"]({
      cwd: options?.cwd ?? null,
      workspace_id: options?.workspace?.id ?? null,
    })
    const worktrees = yield* Effect.all(result.worktrees.map(decodeWorktreeSnapshot))
    return { worktrees, source: decodeWorktreeSource(result.source) }
  })

/**
 * Options shared by `createWorktree` and `openWorktree`.
 *
 * @category models
 * @since 0.1.0
 */
export interface OpenWorktreeOptions {
  readonly branch?: string
  readonly cwd?: string
  readonly focus?: boolean
  readonly label?: string
  readonly path?: string
  readonly workspace?: Workspace
}

/**
 * Options for `createWorktree` — `OpenWorktreeOptions` plus `base`, the
 * ref the new branch/worktree is created from.
 *
 * @category models
 * @since 0.1.0
 */
export interface CreateWorktreeOptions extends OpenWorktreeOptions {
  readonly base?: string
}

/**
 * Creates a new git worktree, plus an attached `Workspace`/`Tab`/`Pane`
 * to work in it from. Returns the new worktree's `WorktreeSnapshot`
 * alongside the *identities* of the new workspace/tab/root pane — not
 * snapshots; callers needing fresh state call `snapshotPane` for the
 * pane, or await a future `snapshotWorkspace`/`snapshotTab` for the rest.
 *
 * **Example** (creating a worktree from a base branch)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, createWorktree } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const { worktree, workspace } = yield* createWorktree({
 *     branch: "feature/x",
 *     base: "main",
 *   })
 *   yield* Effect.log(worktree.path, workspace.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const createWorktree = (
  options: CreateWorktreeOptions,
): Effect.Effect<
  { readonly worktree: WorktreeSnapshot; readonly workspace: Workspace; readonly tab: Tab; readonly rootPane: Pane },
  HerdrProtocolError | RpcClientError,
  HerdrSession
> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["worktree.create"]({
      base: options.base ?? null,
      branch: options.branch ?? null,
      cwd: options.cwd ?? null,
      focus: options.focus,
      label: options.label ?? null,
      path: options.path ?? null,
      workspace_id: options.workspace?.id ?? null,
    })
    const worktree = yield* decodeWorktreeSnapshot(result.worktree)
    return {
      worktree,
      workspace: makeWorkspace({ id: result.workspace.workspace_id as WorkspaceId }),
      tab: makeTab({ id: result.tab.tab_id as TabId, workspaceId: result.tab.workspace_id as WorkspaceId }),
      rootPane: makePane({
        id: result.root_pane.pane_id as PaneId,
        tabId: result.root_pane.tab_id as TabId,
        workspaceId: result.root_pane.workspace_id as WorkspaceId,
      }),
    }
  })

/**
 * Opens an existing git worktree as a workspace. If the worktree already
 * has a live workspace, herdr returns that same workspace instead of
 * creating a second one — signaled by `alreadyOpen: true`. Returns
 * identity, same discipline as `createWorktree`.
 *
 * **Example** (opening a worktree by path)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, openWorktree } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const { workspace, alreadyOpen } = yield* openWorktree({ path: "/repo/.worktrees/feature-x" })
 *   yield* Effect.log(workspace.id, alreadyOpen)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const openWorktree = (
  options: OpenWorktreeOptions,
): Effect.Effect<
  {
    readonly worktree: WorktreeSnapshot
    readonly workspace: Workspace
    readonly tab: Tab
    readonly rootPane: Pane
    readonly alreadyOpen: boolean
  },
  HerdrProtocolError | RpcClientError,
  HerdrSession
> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["worktree.open"]({
      branch: options.branch ?? null,
      cwd: options.cwd ?? null,
      focus: options.focus,
      label: options.label ?? null,
      path: options.path ?? null,
      workspace_id: options.workspace?.id ?? null,
    })
    const worktree = yield* decodeWorktreeSnapshot(result.worktree)
    return {
      worktree,
      workspace: makeWorkspace({ id: result.workspace.workspace_id as WorkspaceId }),
      tab: makeTab({ id: result.tab.tab_id as TabId, workspaceId: result.tab.workspace_id as WorkspaceId }),
      rootPane: makePane({
        id: result.root_pane.pane_id as PaneId,
        tabId: result.root_pane.tab_id as TabId,
        workspaceId: result.root_pane.workspace_id as WorkspaceId,
      }),
      alreadyOpen: result.already_open,
    }
  })

/**
 * Options for `removeWorktree`.
 *
 * @category models
 * @since 0.1.0
 */
export interface RemoveWorktreeOptions {
  readonly force?: boolean
}

/**
 * Removes a git worktree by tearing down its open `workspace` (and the
 * underlying git worktree) together. Takes a `Workspace` identity, not a
 * worktree-level id — herdr's wire itself only ever addresses an "open"
 * worktree via its `workspace_id`; there is no RPC-level handle for a
 * worktree that isn't currently open. A caller holding only a
 * `WorktreeSnapshot` (from `listWorktrees`) with
 * `openWorkspaceId = Option.none()` must `openWorktree` it first to
 * obtain a `Workspace` before it can be removed. Dual-shaped: data-first
 * (`removeWorktree(workspace, options)`) and data-last
 * (`workspace.pipe(removeWorktree(options))`).
 *
 * **Example** (removing a worktree by its open workspace)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, openWorktree, removeWorktree } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const { workspace } = yield* openWorktree({ path: "/repo/.worktrees/feature-x" })
 *   yield* removeWorktree(workspace, { force: true })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const removeWorktree: {
  (
    workspace: Workspace,
    options?: RemoveWorktreeOptions,
  ): Effect.Effect<
    { readonly path: string; readonly forced: boolean },
    HerdrProtocolError | RpcClientError,
    HerdrSession
  >
  (
    options?: RemoveWorktreeOptions,
  ): (
    workspace: Workspace,
  ) => Effect.Effect<
    { readonly path: string; readonly forced: boolean },
    HerdrProtocolError | RpcClientError,
    HerdrSession
  >
} = Function.dual(
  (args) => isWorkspace(args[0]),
  (workspace: Workspace, options?: RemoveWorktreeOptions) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const result = yield* session.rpc["worktree.remove"]({
        workspace_id: workspace.id,
        force: options?.force,
      })
      return { path: result.path, forced: result.forced }
    }),
)
