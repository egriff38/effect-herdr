/**
 * Lists every workspace herdr currently knows about.
 *
 * **Example** (listing workspaces)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listWorkspaces } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const { workspaces } = yield* listWorkspaces
 *   return workspaces.map((workspace) => workspace.workspace_id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */

import { Effect } from "effect"
import { HerdrSession } from "./HerdrSession.js"

export const listWorkspaces = Effect.gen(function*() {
  const session = yield* HerdrSession
  return yield* session.rpc["workspace.list"]()
})
