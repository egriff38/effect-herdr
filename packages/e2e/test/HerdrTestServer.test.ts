/**
 * Meta-test: verifies the E2E bootstrap itself works before any SDK-under-test tests exist.
 *
 * If this test doesn't pass, no other E2E test will be trustworthy — the private
 * server plumbing is upstream of everything else.
 */

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { existsSync } from "node:fs"
import { acquire } from "../src/HerdrTestServer.js"

describe("HerdrTestServer bootstrap", () => {
  test("spins up an isolated named session and tears it down on Scope close", async () => {
    let seenSocketPath: string | undefined
    let seenSessionName: string | undefined

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* acquire
          seenSocketPath = server.socketPath
          seenSessionName = server.sessionName
          expect(existsSync(server.socketPath)).toBe(true)
        }),
      ),
    )

    expect(seenSocketPath).toBeDefined()
    expect(seenSessionName).toBeDefined()
    // After scope closes, the socket file should be gone (herdr removes it on stop).
    // Small allowance for the daemon's own cleanup handshake.
    await new Promise((r) => setTimeout(r, 200))
    expect(existsSync(seenSocketPath!)).toBe(false)
  }, 15_000)
})
