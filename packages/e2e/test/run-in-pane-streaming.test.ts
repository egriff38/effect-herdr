import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { HerdrConnection, HerdrSession } from "effect-herdr"
import { runInPane, waitForOutput } from "effect-herdr"
import type { PaneId, TabId, WorkspaceId } from "effect-herdr"
import { acquire, createWorkspaceFixture } from "../src/HerdrTestServer.js"

/**
 * E2E test for slice 7 (issue #8): `runInPane`'s streaming overloads,
 * against a real herdr binary via the isolated-session harness.
 *
 * Kept separate from slice 5's `run-in-pane.test.ts` (batch overloads) per
 * the issue's own numbered-slice-per-file convention, rather than growing
 * that file further.
 */
describe("Slice 7 E2E — runInPane streaming", () => {
  test("streaming with a trailing-newline chunk submits the concatenated text — visible via waitForOutput", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-7-e2e-streaming-newline")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }

          yield* runInPane(pane, Stream.make("echo hello ", "world", "\n")).pipe(withSession, withConnection)

          const chunks = yield* waitForOutput(pane, "hello world").pipe(
            Stream.take(1),
            Stream.runCollect,
            withSession,
            withConnection,
          )

          expect(chunks).toHaveLength(1)
          expect(Array.from(chunks)[0]).toContain("hello world")
        }),
      ),
    )
  }, 20_000)

  test("streaming without a trailing newline leaves the text typed but unsubmitted — visible via a raw pane.read, no shell execution", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })
          const fixture = yield* createWorkspaceFixture(server.socketPath, "slice-7-e2e-streaming-no-newline")

          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)
          const withSession = Effect.provide(HerdrSession.layer)

          const pane = {
            id: fixture.paneId as PaneId,
            tabId: fixture.tabId as TabId,
            workspaceId: fixture.workspaceId as WorkspaceId,
          }

          yield* runInPane(pane, Stream.make("no-newline-here")).pipe(withSession, withConnection)

          // Give herdr a moment to apply the typed (but not submitted) text
          // to the pty before reading it back.
          yield* Effect.sleep("300 millis")

          const read = yield* HerdrSession.HerdrSession.pipe(
            Effect.andThen((session) => session.rpc["pane.read"]({ pane_id: pane.id, source: "visible" })),
            withSession,
            withConnection,
          )

          // No Enter was ever sent, so the shell never echoed a new prompt
          // line or ran anything — the typed text sits uncommitted on the
          // current input line. Confirmed live: `pane.read`'s `text` field
          // includes whatever is currently on the pty, submitted or not,
          // which is exactly what this assertion needs — `waitForOutput`
          // would be the wrong tool here since without Enter the shell
          // produces no new output to match against.
          expect(read.read.text).toContain("no-newline-here")
        }),
      ),
    )
  }, 20_000)
})
