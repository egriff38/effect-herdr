import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { RpcTest } from "effect/unstable/rpc"
import { HerdrConnection } from "../src/HerdrConnection.js"
import { HerdrRpcs, PongResult, WorkspaceListResult } from "../src/protocol/HerdrRpcs.js"
import { listWorkspaces } from "../src/listWorkspaces.js"
import * as HerdrSession from "../src/HerdrSession.js"
import type { CurrentIds } from "../src/HerdrSession.js"

/**
 * Unit tests for slice 2 (issue #3): HerdrSession service + currentIds
 * resolution + listWorkspaces, verified through the unit seam described
 * in issue #1's spec — a fake `HerdrConnection` built from an in-memory
 * RpcTest client, never touching a real socket.
 */

const fakeConnectionLayer = (handlers: {
  readonly ping?: () => Effect.Effect<PongResult>
  readonly "workspace.list"?: () => Effect.Effect<WorkspaceListResult>
}) =>
  Layer.unwrap(
    Effect.gen(function*() {
      const rpc = yield* RpcTest.makeClient(HerdrRpcs).pipe(
        Effect.provide(
          HerdrRpcs.toLayer({
            ping: handlers.ping ?? (() => Effect.die("ping not stubbed")),
            "workspace.list": handlers["workspace.list"] ?? (() => Effect.die("workspace.list not stubbed")),
            "workspace.get": () => Effect.die("workspace.get not stubbed"),
            "tab.get": () => Effect.die("tab.get not stubbed"),
            "pane.list": () => Effect.die("pane.list not stubbed"),
            "pane.get": () => Effect.die("pane.get not stubbed"),
            "pane.split": () => Effect.die("pane.split not stubbed"),
            "pane.focus": () => Effect.die("pane.focus not stubbed"),
            "session.snapshot": () => Effect.die("session.snapshot not stubbed"),
            "pane.send_text": () => Effect.die("pane.send_text not stubbed"),
            "pane.close": () => Effect.die("pane.close not stubbed"),
            "pane.read": () => Effect.die("pane.read not stubbed"),
            "pane.wait_for_output": () => Effect.die("pane.wait_for_output not stubbed"),
            "pane.rename": () => Effect.die("pane.rename not stubbed"),
            "pane.send_keys": () => Effect.die("pane.send_keys not stubbed"),
            "pane.move": () => Effect.die("pane.move not stubbed"),
            "pane.swap": () => Effect.die("pane.swap not stubbed"),
            "pane.resize": () => Effect.die("pane.resize not stubbed"),
            "pane.zoom": () => Effect.die("pane.zoom not stubbed"),
            "pane.focus_direction": () => Effect.die("pane.focus_direction not stubbed"),
            "pane.neighbor": () => Effect.die("pane.neighbor not stubbed"),
            "pane.edges": () => Effect.die("pane.edges not stubbed"),
            "pane.current": () => Effect.die("pane.current not stubbed"),
            "pane.layout": () => Effect.die("pane.layout not stubbed"),
            "pane.process_info": () => Effect.die("pane.process_info not stubbed"),
            "worktree.list": () => Effect.die("worktree.list not stubbed"),
            "worktree.create": () => Effect.die("worktree.create not stubbed"),
            "worktree.open": () => Effect.die("worktree.open not stubbed"),
            "worktree.remove": () => Effect.die("worktree.remove not stubbed"),
            "notification.show": () => Effect.die("notification.show not stubbed"),
            "integration.install": () => Effect.die("integration.install not stubbed"),
            "integration.uninstall": () => Effect.die("integration.uninstall not stubbed"),
            "workspace.create": () => Effect.die("workspace.create not stubbed"),
            "workspace.close": () => Effect.die("workspace.close not stubbed"),
            "workspace.rename": () => Effect.die("workspace.rename not stubbed"),
            "workspace.focus": () => Effect.die("workspace.focus not stubbed"),
            "workspace.move": () => Effect.die("workspace.move not stubbed"),
            "tab.create": () => Effect.die("tab.create not stubbed"),
            "tab.close": () => Effect.die("tab.close not stubbed"),
            "tab.rename": () => Effect.die("tab.rename not stubbed"),
            "tab.focus": () => Effect.die("tab.focus not stubbed"),
            "tab.move": () => Effect.die("tab.move not stubbed"),
            "tab.list": () => Effect.die("tab.list not stubbed"),
            "events.wait": () => Effect.die("events.wait not stubbed"),
            "agent.list": () => Effect.die("agent.list not stubbed"),
            "agent.get": () => Effect.die("agent.get not stubbed"),
            "agent.read": () => Effect.die("agent.read not stubbed"),
            "agent.explain": () => Effect.die("agent.explain not stubbed"),
            "agent.rename": () => Effect.die("agent.rename not stubbed"),
            "agent.focus": () => Effect.die("agent.focus not stubbed"),
            "agent.start": () => Effect.die("agent.start not stubbed"),
            "agent.send_keys": () => Effect.die("agent.send_keys not stubbed"),
            "agent.prompt": () => Effect.die("agent.prompt not stubbed"),
            "agent.wait": () => Effect.die("agent.wait not stubbed"),
            "agent.view.set": () => Effect.die("agent.view.set not stubbed"),
            "agent.view.clear": () => Effect.die("agent.view.clear not stubbed"),
            "pane.report_agent": () => Effect.die("pane.report_agent not stubbed"),
            "pane.report_agent_session": () => Effect.die("pane.report_agent_session not stubbed"),
            "pane.report_metadata": () => Effect.die("pane.report_metadata not stubbed"),
            "workspace.report_metadata": () => Effect.die("workspace.report_metadata not stubbed"),
            "pane.release_agent": () => Effect.die("pane.release_agent not stubbed"),
            "pane.clear_agent_authority": () => Effect.die("pane.clear_agent_authority not stubbed"),
          }),
        ),
      )
      return Layer.succeed(HerdrConnection, {
        rpc,
        subscribeEvents: () => Effect.die("subscribeEvents not stubbed"),
      })
    }),
  )

describe("HerdrSession", () => {
  test("resolveCurrentIds via layer: Option.none when env vars are unset", async () => {
    const prevWorkspace = process.env["HERDR_WORKSPACE_ID"]
    const prevTab = process.env["HERDR_TAB_ID"]
    const prevPane = process.env["HERDR_PANE_ID"]
    delete process.env["HERDR_WORKSPACE_ID"]
    delete process.env["HERDR_TAB_ID"]
    delete process.env["HERDR_PANE_ID"]

    try {
      const session = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            return yield* HerdrSession.HerdrSession
          }).pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(fakeConnectionLayer({})),
          ),
        ),
      )

      expect(Option.isNone(session.currentIds)).toBe(true)
    } finally {
      if (prevWorkspace !== undefined) process.env["HERDR_WORKSPACE_ID"] = prevWorkspace
      if (prevTab !== undefined) process.env["HERDR_TAB_ID"] = prevTab
      if (prevPane !== undefined) process.env["HERDR_PANE_ID"] = prevPane
    }
  })

  test("resolveCurrentIds via layer: Option.some when all three env vars are set", async () => {
    const prevWorkspace = process.env["HERDR_WORKSPACE_ID"]
    const prevTab = process.env["HERDR_TAB_ID"]
    const prevPane = process.env["HERDR_PANE_ID"]
    process.env["HERDR_WORKSPACE_ID"] = "w1"
    process.env["HERDR_TAB_ID"] = "w1:t1"
    process.env["HERDR_PANE_ID"] = "w1:p1"

    try {
      const session = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            return yield* HerdrSession.HerdrSession
          }).pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(fakeConnectionLayer({})),
          ),
        ),
      )

      expect(Option.isSome(session.currentIds)).toBe(true)
      if (Option.isSome(session.currentIds)) {
        expect(session.currentIds.value).toEqual({
          workspaceId: "w1" as CurrentIds["workspaceId"],
          tabId: "w1:t1" as CurrentIds["tabId"],
          paneId: "w1:p1" as CurrentIds["paneId"],
        })
      }
    } finally {
      if (prevWorkspace !== undefined) process.env["HERDR_WORKSPACE_ID"] = prevWorkspace
      else delete process.env["HERDR_WORKSPACE_ID"]
      if (prevTab !== undefined) process.env["HERDR_TAB_ID"] = prevTab
      else delete process.env["HERDR_TAB_ID"]
      if (prevPane !== undefined) process.env["HERDR_PANE_ID"] = prevPane
      else delete process.env["HERDR_PANE_ID"]
    }
  })

  test("listWorkspaces dispatches through session.rpc to the fake workspace.list handler", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        listWorkspaces.pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "workspace.list": () =>
                Effect.succeed(
                  new WorkspaceListResult({
                    type: "workspace_list",
                    workspaces: [
                      {
                        workspace_id: "w1",
                        number: 1,
                        label: "test",
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
  })
})
