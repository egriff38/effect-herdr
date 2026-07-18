import { describe, expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { HerdrConnection, HerdrSession } from "effect-herdr"
import { currentPane, currentTab, currentWorkspace, listPanes, snapshotPane } from "effect-herdr"
import type { PaneId, WorkspaceId } from "effect-herdr"
import { acquire, createWorkspaceFixture } from "../src/HerdrTestServer.js"

/**
 * E2E test for issue #4 (slice 3): identity/snapshot value objects,
 * `snapshotPane`/`listPanes`, and `current*` — all through the real herdr
 * binary via the isolated-session harness. A workspace/tab/pane fixture is
 * created via a raw socket call (see `createWorkspaceFixture`) so these
 * tests have a real target to read, not just the empty-session case
 * already covered by the slice-1/2 E2E tests.
 */
describe("Slice 3 E2E — snapshotPane, listPanes, current*", () => {
  test("snapshotPane and listPanes round-trip through a real herdr server", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-3-e2e")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const pane = yield* snapshotPane({ id: fixture.paneId as PaneId }).pipe(withSession, withConnection)
          expect(pane.id).toBe(fixture.paneId as PaneId)
          expect(pane.tabId).toBe(fixture.tabId as never)
          expect(pane.workspaceId).toBe(fixture.workspaceId as never)
          expect(pane.revision).toBe(0)
          expect(pane.cwd.length).toBeGreaterThan(0)
          expect(pane.focused).toBe(true)

          const panes = yield* listPanes({ id: fixture.workspaceId as WorkspaceId }).pipe(withSession, withConnection)
          expect(panes).toHaveLength(1)
          expect(panes[0]?.id).toBe(fixture.paneId as PaneId)
        }),
      ),
    )
  }, 20_000)

  test("current* resolve real snapshots when HERDR_* env vars point at the fixture", async () => {
    const prev = {
      workspaceId: process.env["HERDR_WORKSPACE_ID"],
      tabId: process.env["HERDR_TAB_ID"],
      paneId: process.env["HERDR_PANE_ID"],
    }

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const server = yield* acquire
            const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
            const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-3-e2e-current")

            process.env["HERDR_WORKSPACE_ID"] = fixture.workspaceId
            process.env["HERDR_TAB_ID"] = fixture.tabId
            process.env["HERDR_PANE_ID"] = fixture.paneId

            const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
            const withSession = Effect.provide(HerdrSession.layer)

            const pane = yield* currentPane.pipe(withSession, withConnection)
            expect(Option.isSome(pane)).toBe(true)
            if (Option.isSome(pane)) expect(pane.value.id).toBe(fixture.paneId as never)

            const tab = yield* currentTab.pipe(withSession, withConnection)
            expect(Option.isSome(tab)).toBe(true)
            if (Option.isSome(tab)) expect(tab.value.id).toBe(fixture.tabId as never)

            const workspace = yield* currentWorkspace.pipe(withSession, withConnection)
            expect(Option.isSome(workspace)).toBe(true)
            if (Option.isSome(workspace)) expect(workspace.value.id).toBe(fixture.workspaceId as never)
          }),
        ),
      )
    } finally {
      for (const [key, value] of [
        ["HERDR_WORKSPACE_ID", prev.workspaceId],
        ["HERDR_TAB_ID", prev.tabId],
        ["HERDR_PANE_ID", prev.paneId],
      ] as const) {
        if (value !== undefined) process.env[key] = value
        else delete process.env[key]
      }
    }
  }, 20_000)

  test("snapshotPane fails with pane_not_found for a nonexistent pane", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          return yield* snapshotPane({ id: "wZZZZZ:pZZZZZ" as PaneId }).pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provideService(HerdrConnection.HerdrConnection, connection),
          )
        }),
      ),
    )

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      const failure = result.cause
      expect(JSON.stringify(failure)).toContain("pane_not_found")
    }
  }, 20_000)
})
