import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { RpcTest } from "effect/unstable/rpc"
import { HerdrRpcs, PongResult, WorkspaceListResult } from "../src/protocol/HerdrRpcs.js"

/**
 * Unit tests for the HerdrRpcs protocol contract itself, using effect-smol's
 * RpcTest in-memory harness (real client + real server handlers, connected
 * without opening any socket). This is NOT the HerdrConnection seam described
 * in issue #1's spec — HerdrConnection wraps a *herdr-specific wire adapter*
 * (HerdrWireProtocol.ts) that only makes sense against a real herdr socket.
 *
 * What IS testable in isolation, and what these tests cover: the RpcGroup's
 * schemas decode/encode correctly, and a client built against them dispatches
 * to the right handler shape. The wire-adapter and HerdrConnection.make/.layer/
 * .Live acquire-time behavior (SocketFileMissing / ConnectionRefused paths)
 * are covered by the E2E suite in packages/e2e, since they require exercising
 * a real (or genuinely absent) unix socket — faking that boundary would test
 * the fake, not the SDK.
 */

const dyingHandlers = {
  ping: () => Effect.die("ping not stubbed for this test"),
  "workspace.list": () => Effect.die("workspace.list not stubbed for this test"),
  "workspace.get": () => Effect.die("workspace.get not stubbed for this test"),
  "tab.get": () => Effect.die("tab.get not stubbed for this test"),
  "pane.list": () => Effect.die("pane.list not stubbed for this test"),
  "pane.get": () => Effect.die("pane.get not stubbed for this test"),
  "pane.split": () => Effect.die("pane.split not stubbed for this test"),
  "pane.focus": () => Effect.die("pane.focus not stubbed for this test"),
  "session.snapshot": () => Effect.die("session.snapshot not stubbed for this test"),
  "pane.send_text": () => Effect.die("pane.send_text not stubbed for this test"),
  "pane.read": () => Effect.die("pane.read not stubbed for this test"),
} as const

describe("HerdrRpcs", () => {
  test("ping round-trips through an in-memory client/server pair", async () => {
    const program = Effect.gen(function*() {
      const client = yield* RpcTest.makeClient(HerdrRpcs)
      return yield* client.ping()
    })

    const result = await Effect.runPromise(
      Effect.scoped(
        program.pipe(
          Effect.provide(
            HerdrRpcs.toLayer({
              ...dyingHandlers,
              ping: () => Effect.succeed(new PongResult({ type: "pong" })),
            }),
          ),
        ),
      ),
    )

    expect(result).toEqual(new PongResult({ type: "pong" }))
  })

  test("workspace.list decodes a WorkspaceInfoWire array into WorkspaceListResult", async () => {
    const program = Effect.gen(function*() {
      const client = yield* RpcTest.makeClient(HerdrRpcs)
      return yield* client["workspace.list"]()
    })

    const result = await Effect.runPromise(
      Effect.scoped(
        program.pipe(
          Effect.provide(
            HerdrRpcs.toLayer({
              ...dyingHandlers,
              "workspace.list": () =>
                Effect.succeed(
                  new WorkspaceListResult({
                    type: "workspace_list",
                    workspaces: [
                      {
                        workspace_id: "w1",
                        number: 1,
                        label: "default",
                        focused: true,
                        active_tab_id: "w1:t1",
                        tab_count: 1,
                        pane_count: 1,
                        agent_status: "idle",
                      },
                    ],
                  }),
                ),
            }),
          ),
        ),
      ),
    )

    expect(result.workspaces).toHaveLength(1)
    expect(result.workspaces[0]?.workspace_id).toBe("w1")
    expect(result.workspaces[0]?.agent_status).toBe("idle")
  })
})
