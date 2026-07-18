/**
 * Trivial combinator proving `HerdrSession` works as a seam (@211-a).
 * Just dispatches `workspace.list` through `session.rpc`.
 *
 * Real domain-shaped operations (splitPane, runInPane, waitForOutput,
 * activePane, focusedPane, current*) land in later slices under
 * `operations/`. This module exists so slice 2 (issue #3) has a concrete,
 * testable proof that the service seam works end-to-end.
 */

import { Effect } from "effect"
import { HerdrSession } from "./HerdrSession.js"

export const listWorkspaces = Effect.gen(function*() {
  const session = yield* HerdrSession
  return yield* session.rpc["workspace.list"]()
})
