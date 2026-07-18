import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HerdrConnection, HerdrSession } from "effect-herdr"
import { focusPane, listPanes, snapshotPane, splitPane } from "effect-herdr"
import type { Pane, PaneId, TabId, WorkspaceId } from "effect-herdr"
import { acquire, createWorkspaceFixture } from "../src/HerdrTestServer.js"

/**
 * E2E test for slice 4 (issue #5): `splitPane` and `focusPane`, both
 * against a real herdr binary via the isolated-session harness.
 */
describe("Slice 4 E2E — splitPane, focusPane", () => {
  test("splitPane creates a distinct new pane and listPanes reflects it", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-4-e2e-split")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const original: Pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }

          const newPane = yield* splitPane(original, { direction: "right" }).pipe(withSession, withConnection)
          expect(newPane.id).not.toBe(fixture.paneId as PaneId)
          expect(newPane.tabId).toBe(fixture.tabId as never)
          expect(newPane.workspaceId).toBe(fixture.workspaceId as never)

          const panes = yield* listPanes({ id: fixture.workspaceId as WorkspaceId }).pipe(withSession, withConnection)
          expect(panes).toHaveLength(2)
        }),
      ),
    )
  }, 20_000)

  test("focusPane focuses the new pane and unfocuses the original", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-4-e2e-focus")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const original: Pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }
          const newPane = yield* splitPane(original, { direction: "right" }).pipe(withSession, withConnection)

          yield* focusPane(newPane).pipe(withSession, withConnection)

          const newSnapshot = yield* snapshotPane(newPane).pipe(withSession, withConnection)
          expect(newSnapshot.focused).toBe(true)

          const originalSnapshot = yield* snapshotPane(original).pipe(withSession, withConnection)
          expect(originalSnapshot.focused).toBe(false)
        }),
      ),
    )
  }, 20_000)
})
