/**
 * Spin up a private, isolated herdr server for E2E tests.
 *
 * Uses herdr's native named-session support (`herdr --session <name>`), which
 * creates a dedicated server bound to its own unix socket under
 * `~/.config/herdr/sessions/<name>/` — completely isolated from the user's
 * default herdr session, so tests never touch real workspaces/tabs/panes.
 *
 * Torn down deterministically via `herdr session stop <name>` on Scope close.
 */

import { Effect, Scope } from "effect"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

export interface HerdrTestServer {
  readonly sessionName: string
  readonly socketPath: string
}

const HERDR_BIN = process.env["HERDR_BIN_PATH"] ?? "herdr"

const runHerdr = (args: ReadonlyArray<string>): Promise<{ stdout: string; code: number | null }> => {
  const { promise, resolve, reject } = Promise.withResolvers<{ stdout: string; code: number | null }>()
  const child = spawn(HERDR_BIN, [...args], { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (b) => { stdout += String(b) })
  child.stderr.on("data", (b) => { stderr += String(b) })
  child.once("error", reject)
  child.once("close", (code) => {
    if (code !== 0 && code !== null) {
      reject(new Error(`herdr ${args.join(" ")} exited ${code}: ${stderr}`))
    } else {
      resolve({ stdout, code })
    }
  })
  return promise
}

const waitForSocket = async (path: string, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await sleep(50)
  }
  throw new Error(`socket ${path} never appeared`)
}

/**
 * Acquire an isolated herdr server, scoped: torn down when the enclosing Scope closes.
 *
 * NOTE: This uses herdr's real `herdr server` daemon plus `herdr session stop`
 * for teardown. It shells out to the herdr binary rather than the SDK-under-test
 * on purpose — the SDK must not be a dependency of the test bootstrap.
 */
export const acquire: Effect.Effect<HerdrTestServer, Error, Scope.Scope> = Effect.acquireRelease(
  Effect.tryPromise({
    try: async () => {
      const sessionName = `effect-herdr-test-${randomUUID().slice(0, 8)}`
      const socketPath = join(homedir(), ".config", "herdr", "sessions", sessionName, "herdr.sock")

      // Spawn the daemon detached; herdr's own session machinery owns lifetime,
      // we identify the server by name for teardown.
      const daemon = spawn(HERDR_BIN, ["--session", sessionName, "server"], {
        stdio: "ignore",
        detached: true,
      })
      daemon.unref()

      await waitForSocket(socketPath)
      return { sessionName, socketPath }
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  }),
  (server) =>
    Effect.promise(async () => {
      try {
        await runHerdr(["session", "stop", server.sessionName])
      } catch {
        // best effort — daemon may already be gone
      }
    }),
)
