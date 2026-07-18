import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Layer, Option } from "effect"
import { RpcTest } from "effect/unstable/rpc"
import { HerdrConnection } from "../src/HerdrConnection.js"
import {
  HerdrRpcs,
  PaneInfoResult,
  PaneListResult,
  PongResult,
  TabInfoResult,
  WorkspaceInfoResult,
  WorkspaceListResult,
} from "../src/protocol/HerdrRpcs.js"
import * as HerdrSession from "../src/HerdrSession.js"
import { currentPane, currentTab, currentWorkspace } from "../src/operations/current.js"
import { listPanes, snapshotPane } from "../src/operations/pane.js"
import type { PaneId, TabId, WorkspaceId } from "../src/protocol/schemas.js"

/**
 * Unit tests for slice 3 (issue #4): identity/snapshot value objects,
 * `snapshotPane`/`listPanes`, and `current*` — through the same fake
 * `HerdrConnection` unit seam as HerdrSession.test.ts.
 */

type Handlers = {
  readonly ping?: () => Effect.Effect<PongResult>
  readonly "workspace.list"?: () => Effect.Effect<WorkspaceListResult>
  readonly "workspace.get"?: (p: { readonly workspace_id: string }) => Effect.Effect<WorkspaceInfoResult>
  readonly "tab.get"?: (p: { readonly tab_id: string }) => Effect.Effect<TabInfoResult>
  readonly "pane.list"?: (p: { readonly workspace_id: string | null }) => Effect.Effect<PaneListResult>
  readonly "pane.get"?: (p: { readonly pane_id: string }) => Effect.Effect<PaneInfoResult>
}

const fakeConnectionLayer = (handlers: Handlers) =>
  Layer.unwrap(
    Effect.gen(function*() {
      const rpc = yield* RpcTest.makeClient(HerdrRpcs).pipe(
        Effect.provide(
          HerdrRpcs.toLayer({
            ping: handlers.ping ?? (() => Effect.die("ping not stubbed")),
            "workspace.list": handlers["workspace.list"] ?? (() => Effect.die("workspace.list not stubbed")),
            "workspace.get": handlers["workspace.get"] ?? (() => Effect.die("workspace.get not stubbed")),
            "tab.get": handlers["tab.get"] ?? (() => Effect.die("tab.get not stubbed")),
            "pane.list": handlers["pane.list"] ?? (() => Effect.die("pane.list not stubbed")),
            "pane.get": handlers["pane.get"] ?? (() => Effect.die("pane.get not stubbed")),
          }),
        ),
      )
      return Layer.succeed(HerdrConnection, { rpc })
    }),
  )

const withEnv = <A>(ids: { workspaceId?: string; tabId?: string; paneId?: string }, fn: () => Promise<A>) => {
  const prev = {
    workspaceId: process.env["HERDR_WORKSPACE_ID"],
    tabId: process.env["HERDR_TAB_ID"],
    paneId: process.env["HERDR_PANE_ID"],
  }
  if (ids.workspaceId === undefined) delete process.env["HERDR_WORKSPACE_ID"]
  else process.env["HERDR_WORKSPACE_ID"] = ids.workspaceId
  if (ids.tabId === undefined) delete process.env["HERDR_TAB_ID"]
  else process.env["HERDR_TAB_ID"] = ids.tabId
  if (ids.paneId === undefined) delete process.env["HERDR_PANE_ID"]
  else process.env["HERDR_PANE_ID"] = ids.paneId

  return fn().finally(() => {
    for (const [key, value] of [
      ["HERDR_WORKSPACE_ID", prev.workspaceId],
      ["HERDR_TAB_ID", prev.tabId],
      ["HERDR_PANE_ID", prev.paneId],
    ] as const) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  })
}

describe("operations/pane", () => {
  test("snapshotPane decodes PaneInfoWire into a PaneSnapshot", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        snapshotPane({ id: "w1:p1" as PaneId }).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.get": () =>
                Effect.succeed(
                  new PaneInfoResult({
                    type: "pane_info",
                    pane: {
                      pane_id: "w1:p1",
                      tab_id: "w1:t1",
                      workspace_id: "w1",
                      terminal_id: "term-1",
                      focused: true,
                      agent_status: "idle",
                      revision: 7,
                      cwd: "/tmp",
                      agent: "claude",
                    },
                  }),
                ),
            }),
          ),
        ),
      ),
    )

    expect(result.id).toBe("w1:p1" as PaneId)
    expect(result.tabId).toBe("w1:t1" as TabId)
    expect(result.workspaceId).toBe("w1" as WorkspaceId)
    expect(result.revision).toBe(7)
    expect(result.cwd).toBe("/tmp")
    expect(result.agent).toBe("claude")
    expect(result.focused).toBe(true)
    expect(DateTime.isDateTime(result.capturedAt)).toBe(true)
  })

  test("snapshotPane maps wire null agent to undefined", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        snapshotPane({ id: "w1:p1" as PaneId }).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.get": () =>
                Effect.succeed(
                  new PaneInfoResult({
                    type: "pane_info",
                    pane: {
                      pane_id: "w1:p1",
                      tab_id: "w1:t1",
                      workspace_id: "w1",
                      terminal_id: "term-1",
                      focused: false,
                      agent_status: "unknown",
                      revision: 1,
                      agent: null,
                    },
                  }),
                ),
            }),
          ),
        ),
      ),
    )

    expect(result.agent).toBeUndefined()
    expect(result.cwd).toBe("")
  })

  test("listPanes decodes every entry from pane.list into PaneSnapshots", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        listPanes({ id: "w1" as WorkspaceId }).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.list": () =>
                Effect.succeed(
                  new PaneListResult({
                    type: "pane_list",
                    panes: [
                      {
                        pane_id: "w1:p1",
                        tab_id: "w1:t1",
                        workspace_id: "w1",
                        terminal_id: "term-1",
                        focused: true,
                        agent_status: "idle",
                        revision: 1,
                        agent: null,
                      },
                      {
                        pane_id: "w1:p2",
                        tab_id: "w1:t1",
                        workspace_id: "w1",
                        terminal_id: "term-2",
                        focused: false,
                        agent_status: "working",
                        revision: 3,
                        agent: "codex",
                      },
                    ],
                  }),
                ),
            }),
          ),
        ),
      ),
    )

    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe("w1:p1" as PaneId)
    expect(result[1]?.id).toBe("w1:p2" as PaneId)
    expect(result[1]?.agent).toBe("codex")
  })
})

describe("operations/current", () => {
  test("currentPane is Option.none when HERDR_* env vars are unset", async () => {
    await withEnv({}, async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          currentPane.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(fakeConnectionLayer({})),
          ),
        ),
      )
      expect(Option.isNone(result)).toBe(true)
    })
  })

  test("currentPane resolves via pane.get when HERDR_* env vars are set", async () => {
    await withEnv({ workspaceId: "w1", tabId: "w1:t1", paneId: "w1:p1" }, async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          currentPane.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(
              fakeConnectionLayer({
                "pane.get": (p) =>
                  Effect.succeed(
                    new PaneInfoResult({
                      type: "pane_info",
                      pane: {
                        pane_id: p.pane_id,
                        tab_id: "w1:t1",
                        workspace_id: "w1",
                        terminal_id: "term-1",
                        focused: true,
                        agent_status: "idle",
                        revision: 1,
                        agent: null,
                      },
                    }),
                  ),
              }),
            ),
          ),
        ),
      )
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) expect(result.value.id).toBe("w1:p1" as PaneId)
    })
  })

  test("currentTab is Option.none when HERDR_* env vars are unset", async () => {
    await withEnv({}, async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          currentTab.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(fakeConnectionLayer({})),
          ),
        ),
      )
      expect(Option.isNone(result)).toBe(true)
    })
  })

  test("currentTab resolves via tab.get when HERDR_* env vars are set", async () => {
    await withEnv({ workspaceId: "w1", tabId: "w1:t1", paneId: "w1:p1" }, async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          currentTab.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(
              fakeConnectionLayer({
                "tab.get": (p) =>
                  Effect.succeed(
                    new TabInfoResult({
                      type: "tab_info",
                      tab: {
                        tab_id: p.tab_id,
                        workspace_id: "w1",
                        number: 1,
                        label: "main",
                        focused: true,
                        pane_count: 2,
                        agent_status: "idle",
                      },
                    }),
                  ),
              }),
            ),
          ),
        ),
      )
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.id).toBe("w1:t1" as TabId)
        expect(result.value.label).toBe("main")
      }
    })
  })

  test("currentWorkspace is Option.none when HERDR_* env vars are unset", async () => {
    await withEnv({}, async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          currentWorkspace.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(fakeConnectionLayer({})),
          ),
        ),
      )
      expect(Option.isNone(result)).toBe(true)
    })
  })

  test("currentWorkspace resolves via workspace.get when HERDR_* env vars are set", async () => {
    await withEnv({ workspaceId: "w1", tabId: "w1:t1", paneId: "w1:p1" }, async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          currentWorkspace.pipe(
            Effect.provide(HerdrSession.layer),
            Effect.provide(
              fakeConnectionLayer({
                "workspace.get": (p) =>
                  Effect.succeed(
                    new WorkspaceInfoResult({
                      type: "workspace_info",
                      workspace: {
                        workspace_id: p.workspace_id,
                        number: 1,
                        label: "default",
                        focused: true,
                        active_tab_id: "w1:t1",
                        tab_count: 1,
                        pane_count: 1,
                        agent_status: "idle",
                      },
                    }),
                  ),
              }),
            ),
          ),
        ),
      )
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.id).toBe("w1" as WorkspaceId)
        expect(result.value.activeTabId).toBe("w1:t1" as TabId)
      }
    })
  })
})
