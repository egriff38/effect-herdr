import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { HerdrConnection, HerdrSession } from "effect-herdr"
import { WaitError, waitForOutput } from "effect-herdr"
import { runInPane } from "effect-herdr"
import type { PaneId, TabId, WorkspaceId } from "effect-herdr"
import { acquire, createWorkspaceFixture } from "../src/HerdrTestServer.js"

/**
 * E2E test for slice 6 (issue #7): `waitForOutput`, against a real herdr
 * binary via the isolated-session harness.
 *
 * `waitForOutput` wraps `pane.wait_for_output` — a BLOCKING plain
 * request/reply on herdr's wire (verified live during implementation, and
 * again here): herdr itself holds the connection until match-or-timeout
 * and replies once. There is no wire-level stream to consume; the
 * `Stream`-returning ergonomic is a service-layer choice (`Stream.fromEffect`
 * around the one RPC call), matching the issue's `Stream.take(1)` +
 * `Stream.runCollect` acceptance criteria.
 */
describe("Slice 6 E2E — waitForOutput", () => {
  test("waitForOutput matches runInPane's echoed command and terminates cleanly", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-6-e2e-wait-for-output")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }

          yield* runInPane(pane, "echo ready").pipe(withSession, withConnection)

          const chunks = yield* waitForOutput(pane, "ready").pipe(
            Stream.take(1),
            Stream.runCollect,
            withSession,
            withConnection,
          )

          expect(chunks).toHaveLength(1)
          expect(Array.from(chunks)[0]).toContain("ready")
        }),
      ),
    )
  }, 20_000)

  test("waitForOutput regex mode matches a numbered marker", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-6-e2e-wait-for-output-regex")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }

          yield* runInPane(pane, "echo READY-42").pipe(withSession, withConnection)

          const chunks = yield* waitForOutput(pane, "READY-\\d+", { regex: true }).pipe(
            Stream.take(1),
            Stream.runCollect,
            withSession,
            withConnection,
          )

          expect(chunks).toHaveLength(1)
          expect(Array.from(chunks)[0]).toContain("READY-42")
        }),
      ),
    )
  }, 20_000)

  test("waitForOutput fails with WaitError({ reason: \"timeout\" }) when the match never appears", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-6-e2e-wait-for-output-timeout")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }

          yield* waitForOutput(pane, "will-never-appear", { timeout: "500 millis" }).pipe(
            Stream.runCollect,
            withSession,
            withConnection,
          )
        }),
      ),
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      const failure = result.cause
      expect(JSON.stringify(failure)).toContain("WaitError")
      expect(JSON.stringify(failure)).toContain("timeout")
    }
  }, 20_000)
})
