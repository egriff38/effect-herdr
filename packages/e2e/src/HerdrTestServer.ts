/**
 * Spin up a private, isolated herdr server for E2E tests.
 *
 * Uses herdr's native named-session support (`herdr --session <name>`), which
 * creates a dedicated server bound to its own unix socket under
 * `~/.config/herdr/sessions/<name>/` — completely isolated from the user's
 * default herdr session, so tests never touch real workspaces/tabs/panes.
 *
 * Torn down deterministically via `herdr session stop <name>` on Scope close.
 *
 * Uses Effect's platform primitives (`ChildProcess`/`ChildProcessSpawner`,
 * `FileSystem`, `Crypto`) rather than `node:child_process`/`node:fs`/
 * `node:crypto` directly — callers provide a runtime layer (e.g.
 * `BunServices.layer`) exactly once, at the test entrypoint.
 */

import * as NodeSocket from "@effect/platform-bun/BunSocket"
import type { Duration, Scope } from "effect"
import { Deferred, Effect, Schedule } from "effect"
import { Crypto } from "effect/Crypto"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as Socket from "effect/unstable/socket/Socket"

export interface HerdrTestServer {
  readonly sessionName: string
  readonly socketPath: string
}

const HERDR_BIN = process.env["HERDR_BIN_PATH"] ?? "herdr"

const herdrHome = (...segments: ReadonlyArray<string>): string =>
  `${process.env["HOME"] ?? "/root"}/.config/herdr/${segments.join("/")}`

/** Run a herdr CLI subcommand to completion, discarding its exit code. */
const runHerdr = (
  args: ReadonlyArray<string>,
): Effect.Effect<void, PlatformError, ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const handle = yield* ChildProcess.make(HERDR_BIN, args)
      yield* handle.exitCode
    }),
  )

/** Poll for `path` to exist, failing after `timeout` elapses. */
const waitForSocket = (
  path: string,
  timeout: Duration.Input = "5 seconds",
): Effect.Effect<void, PlatformError | Error, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const found = yield* fs.exists(path).pipe(
      Effect.repeat({ schedule: Schedule.spaced("50 millis"), until: (exists) => exists }),
      Effect.timeoutOption(timeout),
    )
    if (found === undefined || !found) {
      return yield* Effect.fail(new Error(`socket ${path} never appeared`))
    }
  })

/**
 * Acquire an isolated herdr server, scoped: torn down when the enclosing Scope closes.
 *
 * NOTE: This uses herdr's real `herdr server` daemon plus `herdr session stop`
 * for teardown. It shells out to the herdr binary rather than the SDK-under-test
 * on purpose — the SDK must not be a dependency of the test bootstrap.
 */
export const acquire: Effect.Effect<
  HerdrTestServer,
  PlatformError | Error,
  ChildProcessSpawner | FileSystem | Crypto | Scope.Scope
> = Effect.acquireRelease(
  Effect.gen(function*() {
    const crypto = yield* Crypto
    const uuid = yield* crypto.randomUUIDv4
    const sessionName = `effect-herdr-test-${uuid.slice(0, 8)}`
    const socketPath = herdrHome("sessions", sessionName, "herdr.sock")

    // Spawn the daemon in the AMBIENT scope (the caller's scope passed to
    // `acquire` via `Effect.acquireRelease`) — NOT a nested `Effect.scoped`,
    // which would close (and kill the child process, per
    // `ChildProcessSpawner`'s own scope-finalizer contract) the instant
    // `ChildProcess.make` returns, before `unref` ever runs. `unref` then
    // detaches the daemon from this fiber's own process-exit tracking so
    // it keeps running under herdr's own session machinery regardless of
    // what later happens to this scope; the release action below (`herdr
    // session stop`) is the SOLE intended teardown path.
    const handle = yield* ChildProcess.make(HERDR_BIN, ["--session", sessionName, "server"])
    yield* handle.unref

    yield* waitForSocket(socketPath)
    return { sessionName, socketPath }
  }),
  (server) =>
    runHerdr(["session", "stop", server.sessionName]).pipe(
      // Best effort — the daemon may already be gone.
      Effect.ignore,
    ),
)

/**
 * Create a workspace as a test fixture, via a raw unix-socket JSON-lines
 * request — deliberately NOT through the SDK-under-test's `HerdrConnection`,
 * for the same reason `acquire` shells out to the herdr binary: fixture
 * setup must not depend on the thing being tested. Returns the freshly
 * created workspace/tab/pane ids so E2E tests have a real target to read.
 */
export const createWorkspaceFixture = (
  socketPath: string,
  label: string,
): Effect.Effect<{ readonly workspaceId: string; readonly tabId: string; readonly paneId: string }, Error> =>
  Effect.scoped(
    Effect.gen(function*() {
      const socket = yield* NodeSocket.makeNet({ path: socketPath })
      const write = yield* socket.writer
      const reply = yield* Deferred.make<string, Socket.SocketError>()

      let buffered = ""
      yield* socket.runString((chunk) => {
        buffered += chunk
        const newlineIndex = buffered.indexOf("\n")
        if (newlineIndex !== -1) {
          return Deferred.succeed(reply, buffered.slice(0, newlineIndex))
        }
        return Effect.void
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Deferred.fail(reply, error),
          onSuccess: () => Effect.void,
        }),
        Effect.forkScoped,
      )

      yield* write(JSON.stringify({ id: "fixture", method: "workspace.create", params: { label } }) + "\n")

      const line = yield* Deferred.await(reply).pipe(
        Effect.mapError((error) => new Error(String(error))),
      )

      const response = JSON.parse(line) as {
        readonly error?: { readonly message: string }
        readonly result?: {
          readonly workspace: { readonly workspace_id: string }
          readonly tab: { readonly tab_id: string }
          readonly root_pane: { readonly pane_id: string }
        }
      }
      if (response.error !== undefined) {
        return yield* Effect.fail(new Error(response.error.message))
      }
      const result = response.result!
      return {
        workspaceId: result.workspace.workspace_id,
        tabId: result.tab.tab_id,
        paneId: result.root_pane.pane_id,
      }
    }),
  )
