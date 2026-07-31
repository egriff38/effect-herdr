/**
 * Combinators for creating, mutating, and reading workspace lifecycle.
 *
 * Every combinator here operates on `Workspace` identity (its `id`), not a
 * snapshot — none of them need a workspace's mutable state, only its
 * stable id. There is no `snapshotWorkspace` yet (see the `TODO` on
 * `createWorkspace`); callers who need current state today go through
 * `currentWorkspace`/`focusedWorkspace` in `current.ts`/`focus.ts`.
 *
 * @since 0.1.0
 */

import { Effect, Function } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { Workspace, WorkspaceId } from "../protocol/schemas.js"
import { isWorkspace, makeWorkspace } from "../protocol/schemas.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * Options for `createWorkspace`. All optional — herdr defaults `focus` to
 * `false` server-side, and picks a `cwd`/`label` itself when omitted.
 *
 * @category models
 * @since 0.1.0
 */
export interface CreateWorkspaceOptions {
  readonly cwd?: string
  readonly label?: string
  readonly focus?: boolean
}

/**
 * Creates a new workspace (with an initial tab and root pane), returning
 * the new workspace's identity — not a snapshot, same discipline as
 * `splitPane` returning a bare `Pane`. herdr's reply also echoes the new
 * tab and root pane, which is discarded here.
 *
 * TODO(#14): no `snapshotWorkspace` combinator exists yet, so a caller
 * needing the new workspace's full state (or the new tab/pane herdr also
 * created) has nothing to call afterwards — flagged as a gap in #14's
 * resolution, out of this ticket's scope.
 *
 * **Example** (creating a workspace)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, createWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* createWorkspace({ label: "feature-x" })
 *   yield* Effect.log(workspace.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const createWorkspace = (
  options?: CreateWorkspaceOptions,
): Effect.Effect<Workspace, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["workspace.create"]({
      cwd: options?.cwd ?? null,
      label: options?.label ?? null,
      focus: options?.focus,
    })
    return makeWorkspace({ id: result.workspace.workspace_id as WorkspaceId })
  })

/**
 * Closes `workspace` and every tab/pane it contains. Resolves to `void` on
 * success.
 *
 * **Example** (closing a workspace)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, closeWorkspace, createWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* createWorkspace()
 *   yield* closeWorkspace(workspace)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const closeWorkspace = (
  workspace: Workspace,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["workspace.close"]({ workspace_id: workspace.id })
  })

/**
 * Renames `workspace` to `label`. Discards herdr's echoed reply,
 * resolving to `void`. Dual-shaped: data-first
 * (`renameWorkspace(workspace, label)`) and data-last
 * (`workspace.pipe(renameWorkspace(label))`).
 *
 * **Example** (renaming a workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, renameWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   yield* renameWorkspace(workspace.value, "renamed")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const renameWorkspace: {
  (workspace: Workspace, label: string): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (label: string): (workspace: Workspace) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isWorkspace(args[0]),
  (workspace: Workspace, label: string) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["workspace.rename"]({ workspace_id: workspace.id, label })
    }),
)

/**
 * Focuses `workspace`. Not dual-shaped — focus is a global mutation, not a
 * relation between two values, same reasoning as `focusPane`. Discards
 * herdr's echoed reply, resolving to `void`.
 *
 * **Example** (focusing a workspace)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, focusWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   yield* focusWorkspace(workspace.value)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const focusWorkspace = (
  workspace: Workspace,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["workspace.focus"]({ workspace_id: workspace.id })
  })

/**
 * Moves `workspace` to `index` in the global workspace order. Discards
 * herdr's echoed reply (the whole reordered workspace list), resolving to
 * `void`. Dual-shaped: data-first (`moveWorkspace(workspace, index)`) and
 * data-last (`workspace.pipe(moveWorkspace(index))`).
 *
 * **Example** (moving a workspace to the front)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, moveWorkspace } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   yield* moveWorkspace(workspace.value, 0)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const moveWorkspace: {
  (workspace: Workspace, index: number): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (index: number): (workspace: Workspace) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isWorkspace(args[0]),
  (workspace: Workspace, index: number) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["workspace.move"]({ workspace_id: workspace.id, insert_index: index })
    }),
)
