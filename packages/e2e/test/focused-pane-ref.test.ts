import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { Effect, Exit, Fiber, Option, Scope, Stream } from "effect"
import { HerdrConnection, HerdrSession } from "effect-herdr"
import { focusedPaneRef, focusPane, splitPane } from "effect-herdr"
import type { Pane, PaneId, TabId, WorkspaceId } from "effect-herdr"
import { acquire, createWorkspaceFixture } from "../src/HerdrTestServer.js"

/**
 * E2E tests for slice 9 (issue #10): `focusedPaneRef` — subscribable global
 * focus fed by `events.subscribe`, plus the connection-scope teardown
 * requirement (killing the connection's scope tears down the subscription).
 *
 * The "kill the daemon" test uses `herdr session stop <name>` — the exact
 * mechanism `HerdrTestServer.acquire`'s own finalizer uses — invoked
 * out-of-band mid-test.
 */

const HERDR_BIN = process.env["HERDR_BIN_PATH"] ?? "herdr"

/** Kill an isolated harness daemon by name, out-of-band. */
const killDaemon = (sessionName: string): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>()
  const child = spawn(HERDR_BIN, ["session", "stop", sessionName], { stdio: "ignore" })
  child.once("close", () => resolve())
  child.once("error", () => resolve())
  return promise
}

describe("Slice 9 E2E — focusedPaneRef", () => {
  test("initial value reflects herdr's actual current focus (not a placeholder)", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-9-e2e-initial")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          // The fresh workspace's root pane is what herdr focuses by default.
          const ref = yield* focusedPaneRef.pipe(withSession, withConnection)
          const initial = yield* ref.get

          expect(Option.isSome(initial)).toBe(true)
          if (Option.isSome(initial)) expect(initial.value.id).toBe(fixture.paneId as PaneId)
        }),
      ),
    )
  }, 20_000)

  test("changes observes A → B → A across focusPane calls", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-9-e2e-observe")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const paneA: Pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }
          const paneB = yield* splitPane(paneA, { direction: "right" }).pipe(withSession, withConnection)

          const ref = yield* focusedPaneRef.pipe(withSession, withConnection)

          // Collect distinct pane ids observed on `.changes`. The initial
          // replayed value (whatever herdr's current focus is — typically
          // paneB right after splitPane) is included; we assert on the
          // sequence of A/B/A ids that follows the focusPane calls below.
          const collected = yield* ref.changes.pipe(
            Stream.map((opt) => Option.getOrElse(opt, () => ({ id: "" as PaneId }))),
            Stream.map((p) => p.id),
            Stream.take(4),
            Stream.runCollect,
            Effect.forkChild,
          )

          // Small stagger between focusPane calls lets herdr's event pipeline
          // deliver each pane_focused broadcast before the next request.
          yield* focusPane(paneA).pipe(withSession, withConnection)
          yield* Effect.sleep("50 millis")
          yield* focusPane(paneB).pipe(withSession, withConnection)
          yield* Effect.sleep("50 millis")
          yield* focusPane(paneA).pipe(withSession, withConnection)

          const values = yield* Fiber.join(collected)
          const ids = Array.from(values)

          // ids[0] is the replayed initial value (a real pane id); the tail
          // is the A/B/A sequence produced by the three focusPane calls.
          expect(ids.slice(-3)).toEqual([paneA.id, paneB.id, paneA.id])
        }),
      ),
    )
  }, 30_000)

  test("scoped: closing the caller's scope tears down the underlying subscription", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          void (yield* createWorkspaceFixture(server.socketPath, "slice-9-e2e-scope-caller"))

          // Open the raw subscribe stream under an explicit caller scope,
          // then close that scope and assert the stream terminates.
          // `focusedPaneRef` uses the same underlying `subscribeEvents`,
          // so its teardown behavior is a corollary of this.
          const callerScope = yield* Scope.make()
          const stream = yield* connection.subscribeEvents(["pane.focused"]).pipe(Scope.provide(callerScope))
          const runner = yield* Stream.runDrain(stream).pipe(Effect.forkChild)

          yield* Effect.sleep("100 millis")
          yield* Scope.close(callerScope, Exit.void)

          const exit = yield* Effect.exit(Fiber.await(runner).pipe(Effect.timeout("2 seconds")))
          expect(Exit.isSuccess(exit)).toBe(true)
        }),
      ),
    )
  }, 30_000)

  test("connection-scope teardown: closing the connection's scope tears down any subscription built from it", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          void (yield* createWorkspaceFixture(server.socketPath, "slice-9-e2e-scope-conn"))

          // Bracket the connection's OWN scope explicitly.
          const connectionScope = yield* Scope.make()
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
            .pipe(Scope.provide(connectionScope))

          // Open a subscribe stream under the ambient (outer) scope — NOT
          // the connection's scope. Closing the connection's scope must
          // still tear it down (via the child-scope wiring in `make`).
          const stream = yield* connection.subscribeEvents(["pane.focused"])
          const runner = yield* Stream.runDrain(stream).pipe(Effect.forkChild)

          yield* Effect.sleep("100 millis")
          yield* Scope.close(connectionScope, Exit.void)

          const exit = yield* Effect.exit(Fiber.await(runner).pipe(Effect.timeout("2 seconds")))
          expect(Exit.isSuccess(exit)).toBe(true)
        }),
      ),
    )
  }, 30_000)

  test("killing the daemon ends the subscribe stream within a bounded timeout", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          void (yield* createWorkspaceFixture(server.socketPath, "slice-9-e2e-daemon-death"))
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })

          const stream = yield* connection.subscribeEvents(["pane.focused"])
          const runner = yield* Stream.runDrain(stream).pipe(Effect.forkChild)

          yield* Effect.sleep("100 millis")

          // Kill the daemon out-of-band. The persistent events.subscribe
          // socket must observe the disconnection and end/fail the push
          // stream, which drains the runner. `Stream.runDrain` swallows
          // stream failures into a success value (drained "nothing"), so
          // "the runner exited within the timeout" is the real signal,
          // regardless of success-vs-failure.
          yield* Effect.promise(() => killDaemon(server.sessionName))

          const exit = yield* Effect.exit(Fiber.await(runner).pipe(Effect.timeout("5 seconds")))
          // Either outcome (natural stream-end or read-error propagated
          // through) is acceptable; a timeout is not.
          expect(Exit.isSuccess(exit)).toBe(true)
        }),
      ),
    )
  }, 30_000)
})
