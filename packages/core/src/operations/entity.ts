/**
 * Kind-polymorphic combinators over herdr's identity types.
 *
 * `closePane`/`closeTab`/`closeWorkspace` differ only in which RPC they
 * dispatch and which id field they fill; likewise for the `focus*` and
 * `rename*` families. Since `Pane`/`Tab`/`Workspace` now carry a
 * discriminating {@link EntityTypeId} tag, one combinator can serve all three
 * soundly — `close(pane)`, `close(tab)`, `close(workspace)`.
 *
 * The per-kind combinators remain the primitives and stay exported; these are
 * a uniform surface over them, not a replacement. Reach for the specific one
 * when the kind is statically known and you want the type system to enforce
 * it; reach for these when writing code generic over kind.
 *
 * **`move` is deliberately absent.** It is not uniform across kinds:
 * `movePane` takes a `PaneMoveDestination` union and returns the pane's fresh
 * identity, while `moveTab`/`moveWorkspace` take a numeric index and return
 * `void`. Collapsing those would mean a union-typed second parameter and a
 * union-typed result, which is worse at every call site than the three
 * honest signatures.
 *
 * @since 0.1.0
 */

import { Effect, Function } from "effect"
import type { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { Pane, Tab, Workspace } from "../protocol/schemas.js"
import { EntityTypeId, isEntity } from "../protocol/schemas.js"
import { closePane, focusPane, renamePane } from "./pane.js"
import { closeTab, focusTab, renameTab } from "./tab.js"
import { closeWorkspace, focusWorkspace, renameWorkspace } from "./workspace.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * Any herdr identity value: a {@link Pane}, {@link Tab}, or
 * {@link Workspace}. The domain of the combinators in this module.
 *
 * @category models
 * @since 0.1.0
 */
export type AnyEntity = Pane | Tab | Workspace

/** Narrows a tagged entity to the per-kind primitive it dispatches to. */
const dispatch = <A, E, R>(
  entity: AnyEntity,
  handlers: {
    readonly pane: (pane: Pane) => Effect.Effect<A, E, R>
    readonly tab: (tab: Tab) => Effect.Effect<A, E, R>
    readonly workspace: (workspace: Workspace) => Effect.Effect<A, E, R>
  },
): Effect.Effect<A, E, R> => {
  switch (entity[EntityTypeId]) {
    case "pane":
      return handlers.pane(entity)
    case "tab":
      return handlers.tab(entity)
    case "workspace":
      return handlers.workspace(entity)
  }
}

/**
 * Closes a pane, tab, or workspace — `pane.close`, `tab.close`, or
 * `workspace.close` depending on the value's kind.
 *
 * **Example** (closing whatever you were handed)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { close, HerdrSession } from "effect-herdr"
 * import type { Pane, Tab, Workspace } from "effect-herdr"
 *
 * const tidy = (resource: Pane | Tab | Workspace) => close(resource)
 *
 * tidy.length
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const close = (
  entity: AnyEntity,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  dispatch(entity, { pane: closePane, tab: closeTab, workspace: closeWorkspace })

/**
 * Focuses a pane, tab, or workspace — `pane.focus`, `tab.focus`, or
 * `workspace.focus` depending on the value's kind.
 *
 * @category combinators
 * @since 0.1.0
 */
export const focus = (
  entity: AnyEntity,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  dispatch(entity, { pane: focusPane, tab: focusTab, workspace: focusWorkspace })

/**
 * Renames a pane, tab, or workspace — `pane.rename`, `tab.rename`, or
 * `workspace.rename` depending on the value's kind. Dual-shaped, matching the
 * per-kind `rename*` combinators.
 *
 * **Example** (labelling whatever you were handed)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { rename } from "effect-herdr"
 * import type { Tab } from "effect-herdr"
 *
 * const label = (tab: Tab) => rename(tab, "build")
 *
 * label.length
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const rename: {
  (entity: AnyEntity, label: string): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    label: string,
  ): (entity: AnyEntity) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isEntity(args[0]),
  (entity: AnyEntity, label: string) =>
    dispatch(entity, {
      pane: (pane) => renamePane(pane, label),
      tab: (tab) => renameTab(tab, label),
      workspace: (workspace) => renameWorkspace(workspace, label),
    }),
)
