import { describe, expect, test } from "bun:test"
import { runTest, runTestExit } from "./testRuntime.js"
import { Effect, Option } from "effect"
import { HerdrConnection, HerdrSession } from "effect-herdr"
import { activePane, focusedPane } from "effect-herdr"
import { focusPane, splitPane } from "effect-herdr"
import type { Pane, PaneId, TabId, WorkspaceId } from "effect-herdr"
import { acquire, createWorkspaceFixture } from "../src/HerdrTestServer.js"

/**
 * E2E test for slice 8 (issue #9): `activePane`/`focusedPane`, both against
 * a real herdr binary via the isolated-session harness. Uses `splitPane`/
 * `focusPane` (landed in slice 4, issue #5) through the SDK-under-test
 * itself to set up the 2-pane focus scenario — no raw-socket fixture
 * needed since both land in the same package and are available at
 * implementation time.
 */
describe("Slice 8 E2E — activePane, focusedPane", () => {
  test("activePane(workspace) returns the pane focused via focusPane", async () => {
    await runTest(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-8-e2e-active-pane-workspace")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const original: Pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }
          const newPane = yield* splitPane(original, { direction: "right" }).pipe(withSession, withConnection)
          yield* focusPane(newPane).pipe(withSession, withConnection)

          const active = yield* activePane({ id: fixture.workspaceId as WorkspaceId }).pipe(
            withSession,
            withConnection,
          )
          expect(active.id).toBe(newPane.id)
          expect(active.focused).toBe(true)
        }),
      )
  }, 20_000)

  test("activePane(tab) returns the pane focused via focusPane, drilled through session.snapshot's layouts", async () => {
    await runTest(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-8-e2e-active-pane-tab")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const original: Pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }
          const newPane = yield* splitPane(original, { direction: "down" }).pipe(withSession, withConnection)
          yield* focusPane(newPane).pipe(withSession, withConnection)

          const active = yield* activePane({ id: fixture.tabId as TabId, workspaceId: fixture.workspaceId as WorkspaceId })
            .pipe(withSession, withConnection)
          expect(active.id).toBe(newPane.id)
          expect(active.focused).toBe(true)
        }),
      )
  }, 20_000)

  test("focusedPane returns Option.some(the pane) after focusPane, Option.none is never observed once a pane exists", async () => {
    await runTest(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-8-e2e-focused-pane")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const original: Pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }
          const newPane = yield* splitPane(original, { direction: "right" }).pipe(withSession, withConnection)
          yield* focusPane(newPane).pipe(withSession, withConnection)

          const result = yield* focusedPane.pipe(withSession, withConnection)
          expect(Option.isSome(result)).toBe(true)
          if (Option.isSome(result)) {
            expect(result.value.id).toBe(newPane.id)
            expect(result.value.focused).toBe(true)
          }

          // Refocus the original pane and confirm focusedPane tracks the change.
          yield* focusPane(original).pipe(withSession, withConnection)
          const afterRefocus = yield* focusedPane.pipe(withSession, withConnection)
          expect(Option.isSome(afterRefocus)).toBe(true)
          if (Option.isSome(afterRefocus)) expect(afterRefocus.value.id).toBe(original.id)
        }),
      )
  }, 20_000)
})
