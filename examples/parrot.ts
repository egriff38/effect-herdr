/**
 * Example: split the current tab, curl parrot.live for 5 seconds, then
 * close the new pane.
 *
 * How to run (from a herdr pane):
 *
 *   cd effect-herdr && bun run examples/parrot.ts
 *
 * herdr's own env vars (`HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`)
 * are set for every process it spawns inside a pane, and `HerdrSession.Live`
 * reads them to identify the caller's own pane. If run outside a herdr pane
 * this exits cleanly with a message — `currentPane` is `Option.none()`.
 *
 * Wire-level sequence this example exercises:
 *   1. `session.snapshot` (indirectly, via `currentPane`) — resolve the
 *      pane that launched this script.
 *   2. `pane.split` — new pane to the right of the caller.
 *   3. `pane.send_text` — send `curl parrot.live\n` into the new pane.
 *   4. sleep 5s server-side (client-side `Effect.sleep`).
 *   5. `pane.close` — close the new pane. herdr collapses the split
 *      layout automatically since the tab drops back to 1 pane.
 */

import { Effect, Option } from "effect"
import { closePane, currentPane, HerdrSession, runInPane, splitPane } from "../packages/core/src/index.js"

const program = Effect.gen(function*() {
  const current = yield* currentPane
  if (Option.isNone(current)) {
    yield* Effect.logInfo("not running inside a herdr pane — HERDR_ENV/HERDR_PANE_ID unset")
    return
  }

  const original = {
    id: current.value.id,
    tabId: current.value.tabId,
    workspaceId: current.value.workspaceId,
  }

  yield* Effect.logInfo(`splitting from pane ${original.id}`)
  const newPane = yield* splitPane(original, { direction: "right" })
  yield* Effect.logInfo(`new pane ${newPane.id} — curling parrot.live for 5s`)

  yield* runInPane(newPane, "curl parrot.live")

  yield* Effect.sleep("5 seconds")

  yield* Effect.logInfo(`closing pane ${newPane.id}`)
  yield* closePane(newPane)
})

Effect.runPromise(program.pipe(Effect.provide(HerdrSession.Live))).catch((error) => {
  console.error(error)
  process.exit(1)
})
