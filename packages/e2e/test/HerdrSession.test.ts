import { describe, expect, test } from "bun:test"
import { runTest, runTestExit } from "./testRuntime.js"
import { Effect, Option } from "effect"
import { HerdrConnection, HerdrSession, listWorkspaces } from "effect-herdr"
import { acquire } from "../src/HerdrTestServer.js"

/**
 * E2E test for issue #3 (slice 2): HerdrSession service seam + currentIds
 * resolution + listWorkspaces, all through the real herdr binary via the
 * isolated-session harness.
 */
describe("HerdrSession E2E — listWorkspaces", () => {
  test("program.pipe(Effect.provide(HerdrSession.layer)) works end-to-end", async () => {
    await runTest(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })

          const result = yield* listWorkspaces.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provideService(HerdrConnection.HerdrConnection, connection),
          )

          expect(result.type).toBe("workspace_list")
          expect(Array.isArray(result.workspaces)).toBe(true)
        }),
      )
  }, 20_000)

  test("HerdrSession.currentIds resolution is consistent with the process's actual HERDR_* env state", async () => {
    // Deliberately does NOT assert Option.none or Option.some — this test
    // runs inside whatever ambient environment invoked it (which may itself
    // be a herdr-managed pane, as it is when run from inside an agent
    // session with HERDR_ENV=1 already set). The real env-boundary
    // Option.none/Option.some behavior is unit-tested with explicit
    // env save/restore in packages/core/test/HerdrSession.test.ts, where
    // ambient state can't leak in. This E2E test instead verifies the two
    // resolutions agree with each other: resolving currentIds twice through
    // separate sessions in the same ambient environment must be consistent.
    await runTest(
        Effect.gen(function*() {
          const server = yield* acquire
          const connection = yield* HerdrConnection.make({ socketPath: server.socketPath })

          const sessionLayer = Effect.provide(HerdrSession.layer)
          const withConnection = Effect.provideService(HerdrConnection.HerdrConnection, connection)

          const first = yield* HerdrSession.HerdrSession.pipe(sessionLayer, withConnection)
          const second = yield* HerdrSession.HerdrSession.pipe(sessionLayer, withConnection)

          expect(Option.isSome(first.currentIds)).toBe(Option.isSome(second.currentIds))
          if (Option.isSome(first.currentIds) && Option.isSome(second.currentIds)) {
            expect(first.currentIds.value).toEqual(second.currentIds.value)
          }
        }),
      )
  }, 20_000)
})
