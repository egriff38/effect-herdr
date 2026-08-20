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
  "pane.close": () => Effect.die("pane.close not stubbed for this test"),
  "pane.read": () => Effect.die("pane.read not stubbed for this test"),
  "pane.wait_for_output": () => Effect.die("pane.wait_for_output not stubbed for this test"),
  "pane.rename": () => Effect.die("pane.rename not stubbed for this test"),
  "pane.send_keys": () => Effect.die("pane.send_keys not stubbed for this test"),
  "pane.move": () => Effect.die("pane.move not stubbed for this test"),
  "pane.swap": () => Effect.die("pane.swap not stubbed for this test"),
  "pane.resize": () => Effect.die("pane.resize not stubbed for this test"),
  "pane.zoom": () => Effect.die("pane.zoom not stubbed for this test"),
  "pane.focus_direction": () => Effect.die("pane.focus_direction not stubbed for this test"),
  "pane.neighbor": () => Effect.die("pane.neighbor not stubbed for this test"),
  "pane.edges": () => Effect.die("pane.edges not stubbed for this test"),
  "pane.current": () => Effect.die("pane.current not stubbed for this test"),
  "pane.layout": () => Effect.die("pane.layout not stubbed for this test"),
  "pane.process_info": () => Effect.die("pane.process_info not stubbed for this test"),
  "worktree.list": () => Effect.die("worktree.list not stubbed for this test"),
  "worktree.create": () => Effect.die("worktree.create not stubbed for this test"),
  "worktree.open": () => Effect.die("worktree.open not stubbed for this test"),
  "worktree.remove": () => Effect.die("worktree.remove not stubbed for this test"),
  "notification.show": () => Effect.die("notification.show not stubbed for this test"),
  "integration.install": () => Effect.die("integration.install not stubbed for this test"),
  "integration.uninstall": () => Effect.die("integration.uninstall not stubbed for this test"),
  "workspace.create": () => Effect.die("workspace.create not stubbed for this test"),
  "workspace.close": () => Effect.die("workspace.close not stubbed for this test"),
  "workspace.rename": () => Effect.die("workspace.rename not stubbed for this test"),
  "workspace.focus": () => Effect.die("workspace.focus not stubbed for this test"),
  "workspace.move": () => Effect.die("workspace.move not stubbed for this test"),
  "tab.create": () => Effect.die("tab.create not stubbed for this test"),
  "tab.close": () => Effect.die("tab.close not stubbed for this test"),
  "tab.rename": () => Effect.die("tab.rename not stubbed for this test"),
  "tab.focus": () => Effect.die("tab.focus not stubbed for this test"),
  "tab.move": () => Effect.die("tab.move not stubbed for this test"),
  "tab.list": () => Effect.die("tab.list not stubbed for this test"),
  "events.wait": () => Effect.die("events.wait not stubbed for this test"),
  "agent.list": () => Effect.die("agent.list not stubbed for this test"),
  "agent.get": () => Effect.die("agent.get not stubbed for this test"),
  "agent.read": () => Effect.die("agent.read not stubbed for this test"),
  "agent.explain": () => Effect.die("agent.explain not stubbed for this test"),
  "agent.rename": () => Effect.die("agent.rename not stubbed for this test"),
  "agent.focus": () => Effect.die("agent.focus not stubbed for this test"),
  "agent.start": () => Effect.die("agent.start not stubbed for this test"),
  "agent.send_keys": () => Effect.die("agent.send_keys not stubbed for this test"),
  "agent.prompt": () => Effect.die("agent.prompt not stubbed for this test"),
  "agent.wait": () => Effect.die("agent.wait not stubbed for this test"),
  "agent.view.set": () => Effect.die("agent.view.set not stubbed for this test"),
  "agent.view.clear": () => Effect.die("agent.view.clear not stubbed for this test"),
  "pane.report_agent": () => Effect.die("pane.report_agent not stubbed for this test"),
  "pane.report_agent_session": () => Effect.die("pane.report_agent_session not stubbed for this test"),
  "pane.report_metadata": () => Effect.die("pane.report_metadata not stubbed for this test"),
  "workspace.report_metadata": () => Effect.die("workspace.report_metadata not stubbed for this test"),
  "pane.release_agent": () => Effect.die("pane.release_agent not stubbed for this test"),
  "pane.clear_agent_authority": () => Effect.die("pane.clear_agent_authority not stubbed for this test"),
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
