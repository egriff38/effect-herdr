import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HerdrConnection } from "effect-herdr"
import { acquire } from "../src/HerdrTestServer.js"

/**
 * E2E test for issue #2 (slice 1): workspace.list round-tripping through the
 * real HerdrConnection primitive against a real, isolated herdr server.
 *
 * This is the tracer-bullet proof for the whole foundation: HerdrRpcs,
 * HerdrWireProtocol (the herdr-specific wire adapter), HerdrConnection.make,
 * HerdrSocketPathConfig resolution (exercised indirectly via explicit
 * socketPath here — the E2E harness always targets a specific isolated
 * session, never the sound-defaults env/default-path resolution, which is
 * covered separately) — and the real herdr binary all working together.
 */
describe("HerdrConnection E2E — workspace.list", () => {
  test("connects to a real herdr server and lists workspaces (a fresh headless session starts empty)", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function*() {
          const server = yield* acquire
          const conn = yield* HerdrConnection.make({ socketPath: server.socketPath })

          const result = yield* conn.rpc["workspace.list"]()

          // A fresh headless herdr server (no UI client ever attached) starts
          // with zero workspaces — verified directly against a real herdr
          // process during implementation, not assumed. The meaningful proof
          // here is that the round-trip decodes into the right shape, not
          // that any particular workspace exists.
          expect(result.type).toBe("workspace_list")
          expect(Array.isArray(result.workspaces)).toBe(true)
          expect(result.workspaces).toHaveLength(0)

          // A second independent call on the same `conn.rpc` proves the
          // per-call-dial model (D4) actually supports multiple calls, not
          // just a lucky single request.
          const pong = yield* conn.rpc.ping()
          expect(pong.type).toBe("pong")
        }),
      ),
    )
  }, 20_000)

  test("fails with SocketFileMissing when the socket path has no server", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(HerdrConnection.make({ socketPath: "/tmp/effect-herdr-e2e-nonexistent.sock" })),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const failure = exit.cause
      expect(JSON.stringify(failure)).toContain("SocketFileMissing")
    }
  })
})
