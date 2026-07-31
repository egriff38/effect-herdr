/**
 * wiki-loop: creates a scratch workspace `wiki-{5 random chars}`, then
 * loops reading names from stdin — each name opens a new tab and runs
 * `omp -p "share 3 interesting facts about <name>"` in it. On quit
 * (Ctrl+C or Ctrl+D), closes the workspace. Closing the workspace from the
 * herdr UI also ends the loop, via `withClaim`'s liveness watcher.
 *
 * Uses Node's own `readline` (cooked mode — real character echo while
 * typing) rather than `effect`'s `Terminal` service, whose `readLine`
 * puts stdin in raw mode and doesn't echo input back itself. Uses
 * `BunRuntime.runMain` (not a bare `Effect.runPromise`) so `SIGINT`/
 * `SIGTERM` are translated into fiber interruption, letting the
 * scope-bound workspace close before the process exits.
 *
 * How to run (from a herdr pane):
 *
 *   cd effect-herdr && bun run examples/wiki-loop.ts
 */

import { BunFileSystem, BunRuntime } from "@effect/platform-bun"
import { Effect } from "effect"
import * as readline from "node:readline"
import {
  createTab,
  createWorkspace,
  HerdrSession,
  listPanes,
  runInPane,
  withClaim,
} from "../packages/core/src/index.js"
import { Live as HerdrConnectionLive } from "../packages/core/src/HerdrConnection.js"

const randomChars = (length: number): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

// POSIX single-quote escaping: wraps `value` in `'...'`, escaping any
// embedded `'` as `'\''`. Neutralizes every shell metacharacter — `$`,
// backticks, `"`, `;`, newlines — regardless of which shell is running
// inside the pane, since `value` is typed verbatim into a live terminal
// as part of a shell command line, not just displayed.
const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

// Cooked-mode line reader: echoes input as typed, resolves `null` on Ctrl+D (EOF).
const readLine = (rl: readline.Interface): Effect.Effect<string | null> =>
  Effect.callback<string | null>((resume) => {
    let resumed = false
    const finish = (value: string | null) => {
      if (resumed) return
      resumed = true
      resume(Effect.succeed(value))
    }
    rl.once("close", () => finish(null))
    try {
      rl.question("> ", (answer) => finish(answer))
    } catch {
      finish(null)
    }
  })

const program = Effect.gen(function*() {
  const label = `wiki-${randomChars(5)}`
  // `withClaim` + `disconnectPolicy: "destroy"` both closes the workspace when
  // this scope ends AND interrupts this loop if the workspace is closed from
  // the herdr UI — so a manual close ends the script instead of leaving it
  // reading names into a workspace that no longer exists.
  const workspace = yield* withClaim(
    createWorkspace({ label }),
    { disconnectPolicy: "destroy" },
  )
  yield* Effect.logInfo(`created workspace ${label} (${workspace.id}) — type a name, Ctrl+C/Ctrl+D to quit`)

  const rl = yield* Effect.acquireRelease(
    Effect.sync(() => readline.createInterface({ input: process.stdin, output: process.stdout })),
    (rl) => Effect.sync(() => rl.close()),
  )

  while (true) {
    const name = yield* readLine(rl)
    if (name === null) break
    if (name.trim().length === 0) continue

    const tab = yield* createTab({ workspace, label: name })
    const panes = yield* listPanes(workspace)
    const pane = panes.find((p) => p.tabId === tab.id)
    if (!pane) {
      yield* Effect.logWarning(`no pane found for new tab ${tab.id} — skipping ${name}`)
      continue
    }

    yield* runInPane(pane, ` omp -p ${shellQuote(`share 3 interesting facts about ${name}`)}`)
  }
}).pipe(Effect.scoped)

BunRuntime.runMain(
  program.pipe(
    Effect.provide(HerdrSession.Live),
    Effect.provide(HerdrConnectionLive),
    Effect.provide(BunFileSystem.layer),
  ),
)
