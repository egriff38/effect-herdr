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
            "pane.read": () => Effect.die("pane.read not stubbed"),
            "pane.wait_for_output": () => Effect.die("pane.wait_for_output not stubbed"),
          }),
        ),
      )
      return Layer.succeed(HerdrConnection, { rpc })
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
