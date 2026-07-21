import { describe, expect, test } from "bun:test"
import { runTest, runTestExit } from "./testRuntime.js"
import { Effect } from "effect"
import { HerdrConnection, HerdrSession } from "effect-herdr"
import { runInPane } from "effect-herdr"
import type { PaneId, TabId, WorkspaceId } from "effect-herdr"
import { acquire, createWorkspaceFixture } from "../src/HerdrTestServer.js"

/**
 * E2E test for slice 5 (issue #6): `runInPane`'s batch-string overloads,
 * against a real herdr binary via the isolated-session harness.
 *
 * Verification choice per the issue's acceptance criteria ("either path is
 * acceptable"): reads the pane's visible text via a raw `pane.read` RPC call
 * (through `session.rpc` directly — no ergonomic `pane.read` combinator
 * exists yet, that's a later slice's call) rather than `snapshotPane`.
 * `snapshotPane`'s `PaneSnapshot` has no text/content field at all (only
 * identity + `revision`/`cwd`/`agent`/`focused`), and live-probing during
 * implementation confirmed `revision` does NOT change on `pane.send_text`
 * (herdr bumps it on structural pane events, not on every text write), so
 * `snapshotPane` cannot indirectly prove the command landed. Reading the
 * pane's actual terminal text is the only reliable signal here.
 */
describe("Slice 5 E2E — runInPane", () => {
  test("runInPane(pane, text) types the command and submits it — visible in pane.read", async () => {
    await runTest(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-5-e2e-run-in-pane")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }

          yield* runInPane(pane, "echo run-in-pane-e2e-marker").pipe(withSession, withConnection)

          // Give the pane's shell a moment to render the echoed output.
          yield* Effect.sleep("800 millis")

          const read = yield* HerdrSession.HerdrSession.pipe(
            Effect.andThen((session) => session.rpc["pane.read"]({ pane_id: pane.id, source: "visible" })),
            withSession,
            withConnection,
          )
          expect(read.read.text).toContain("run-in-pane-e2e-marker")
        }),
      )
  }, 20_000)

  test("runInPane data-last (pane.pipe(runInPane(text))) also submits the command", async () => {
    await runTest(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-5-e2e-run-in-pane-data-last")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }

          yield* Effect.succeed(pane).pipe(
            Effect.andThen(runInPane("echo data-last-marker")),
            withSession,
            withConnection,
          )

          yield* Effect.sleep("800 millis")

          const read = yield* HerdrSession.HerdrSession.pipe(
            Effect.andThen((session) => session.rpc["pane.read"]({ pane_id: pane.id, source: "visible" })),
            withSession,
            withConnection,
          )
          expect(read.read.text).toContain("data-last-marker")
        }),
      )
  }, 20_000)
})
