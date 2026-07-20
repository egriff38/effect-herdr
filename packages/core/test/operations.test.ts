import { describe, expect, test } from "bun:test"
import { Cause, Data, DateTime, Effect, Layer, Option, Stream } from "effect"
import { RpcTest } from "effect/unstable/rpc"
import { HerdrConnection } from "../src/HerdrConnection.js"
import { HerdrProtocolError, WaitError } from "../src/protocol/errors.js"
import {
  HerdrRpcs,
  OkResult,
  PaneInfoResult,
  PaneListResult,
  PaneReadResult,
  PaneWaitForOutputResult,
  PongResult,
  SessionSnapshotResult,
  TabInfoResult,
  WorkspaceInfoResult,
  WorkspaceListResult,
} from "../src/protocol/HerdrRpcs.js"
import * as HerdrSession from "../src/HerdrSession.js"
import { currentPane, currentTab, currentWorkspace } from "../src/operations/current.js"
import { activePane, activeTab, focusedPane, focusedTab, focusedWorkspace } from "../src/operations/focus.js"
import { focusPane, listPanes, runInPane, snapshotPane, splitPane, waitForOutput } from "../src/operations/pane.js"
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
  readonly "pane.split"?: (p: {
    readonly target_pane_id: string | null
    readonly direction: "right" | "down"
    readonly focus?: boolean | undefined
  }) => Effect.Effect<PaneInfoResult>
  readonly "pane.focus"?: (p: { readonly pane_id: string }) => Effect.Effect<PaneInfoResult>
  readonly "session.snapshot"?: () => Effect.Effect<SessionSnapshotResult>
  readonly "pane.send_text"?: (
    p: { readonly pane_id: string; readonly text: string },
  ) => Effect.Effect<OkResult, HerdrProtocolError>
  readonly "pane.close"?: (p: { readonly pane_id: string }) => Effect.Effect<OkResult, HerdrProtocolError>
  readonly "pane.read"?: (p: {
    readonly pane_id: string
    readonly source: "visible" | "recent" | "recent_unwrapped" | "detection"
  }) => Effect.Effect<PaneReadResult>
  readonly "pane.wait_for_output"?: (p: {
    readonly pane_id: string
    readonly source: "visible" | "recent" | "recent_unwrapped" | "detection"
    readonly match: { readonly type: "substring" | "regex"; readonly value: string }
    readonly timeout_ms?: number | undefined
  }) => Effect.Effect<PaneWaitForOutputResult, HerdrProtocolError>
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
            "pane.split": handlers["pane.split"] ?? (() => Effect.die("pane.split not stubbed")),
            "pane.focus": handlers["pane.focus"] ?? (() => Effect.die("pane.focus not stubbed")),
            "session.snapshot": handlers["session.snapshot"] ?? (() => Effect.die("session.snapshot not stubbed")),
            "pane.send_text": handlers["pane.send_text"] ?? (() => Effect.die("pane.send_text not stubbed")),
            "pane.close": handlers["pane.close"] ?? (() => Effect.die("pane.close not stubbed")),
            "pane.read": handlers["pane.read"] ?? (() => Effect.die("pane.read not stubbed")),
            "pane.wait_for_output": handlers["pane.wait_for_output"]
              ?? (() => Effect.die("pane.wait_for_output not stubbed")),
          }),
        ),
      )
      return Layer.succeed(HerdrConnection, {
        rpc,
        subscribeEvents: () => Effect.die("subscribeEvents not stubbed"),
      })
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

  test("splitPane dual-shape: data-first and data-last dispatch identical pane.split calls", async () => {
    const original = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }
    const wireNewPane = {
      pane_id: "w1:p2",
      tab_id: "w1:t1",
      workspace_id: "w1",
      terminal_id: "term-2",
      focused: false,
      agent_status: "idle" as const,
      revision: 0,
    }
    const splitHandler = (p: { readonly target_pane_id: string | null; readonly direction: "right" | "down" }) => {
      expect(p.target_pane_id).toBe("w1:p1")
      expect(p.direction).toBe("right")
      return Effect.succeed(new PaneInfoResult({ type: "pane_info", pane: wireNewPane }))
    }
    const expected = { id: "w1:p2" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }

    const dataFirst = await Effect.runPromise(
      Effect.scoped(
        splitPane(original, { direction: "right" }).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(fakeConnectionLayer({ "pane.split": splitHandler })),
        ),
      ),
    )
    const dataLast = await Effect.runPromise(
      Effect.scoped(
        splitPane({ direction: "right" })(original).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(fakeConnectionLayer({ "pane.split": splitHandler })),
        ),
      ),
    )

    expect(dataFirst).toEqual(expected)
    expect(dataLast).toEqual(expected)
  })

  test("splitPane defaults direction to right and omits focus when not provided", async () => {
    await Effect.runPromise(
      Effect.scoped(
        splitPane({ id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.split": (p) => {
                expect(p.direction).toBe("right")
                expect(p.focus).toBeUndefined()
                return Effect.succeed(
                  new PaneInfoResult({
                    type: "pane_info",
                    pane: {
                      pane_id: "w1:p2",
                      tab_id: "w1:t1",
                      workspace_id: "w1",
                      terminal_id: "term-2",
                      focused: false,
                      agent_status: "idle",
                      revision: 0,
                    },
                  }),
                )
              },
            }),
          ),
        ),
      ),
    )
  })

  test("focusPane dispatches pane.focus with the pane's id", async () => {
    let dispatchedId: string | undefined
    await Effect.runPromise(
      Effect.scoped(
        focusPane({ id: "w1:p2" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.focus": (p) => {
                dispatchedId = p.pane_id
                return Effect.succeed(
                  new PaneInfoResult({
                    type: "pane_info",
                    pane: {
                      pane_id: "w1:p2",
                      tab_id: "w1:t1",
                      workspace_id: "w1",
                      terminal_id: "term-2",
                      focused: true,
                      agent_status: "idle",
                      revision: 1,
                    },
                  }),
                )
              },
            }),
          ),
        ),
      ),
    )

    expect(dispatchedId).toBe("w1:p2")
  })

  test("runInPane appends a trailing newline to the caller's text before dispatching pane.send_text", async () => {
    let dispatched: { readonly pane_id: string; readonly text: string } | undefined
    await Effect.runPromise(
      Effect.scoped(
        runInPane(
          { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId },
          "echo hello",
        ).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.send_text": (p) => {
                dispatched = p
                return Effect.succeed(new OkResult({ type: "ok" }))
              },
            }),
          ),
        ),
      ),
    )

    expect(dispatched?.pane_id).toBe("w1:p1")
    expect(dispatched?.text).toBe("echo hello\n")
  })

  test("runInPane dual-shape: data-first and data-last dispatch identical pane.send_text calls", async () => {
    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }
    const dispatchedDataFirst: Array<{ readonly pane_id: string; readonly text: string }> = []
    const dispatchedDataLast: Array<{ readonly pane_id: string; readonly text: string }> = []

    await Effect.runPromise(
      Effect.scoped(
        runInPane(pane, "echo hello").pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.send_text": (p) => {
                dispatchedDataFirst.push(p)
                return Effect.succeed(new OkResult({ type: "ok" }))
              },
            }),
          ),
        ),
      ),
    )
    await Effect.runPromise(
      Effect.scoped(
        runInPane("echo hello")(pane).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.send_text": (p) => {
                dispatchedDataLast.push(p)
                return Effect.succeed(new OkResult({ type: "ok" }))
              },
            }),
          ),
        ),
      ),
    )

    expect(dispatchedDataFirst).toEqual(dispatchedDataLast)
    expect(dispatchedDataFirst).toEqual([{ pane_id: "w1:p1", text: "echo hello\n" }])
  })

  test("runInPane propagates a HerdrProtocolError from pane.send_text (not silently discarded)", async () => {
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runInPane({ id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }, "echo hi").pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.send_text": () =>
                Effect.fail(new HerdrProtocolError({ code: "pane_not_found", rawMessage: "pane not found" })),
            }),
          ),
        ),
      ),
    )

    expect(result._tag).toBe("Failure")
  })

  test("streaming runInPane dispatches one pane.send_text per chunk, in order, verbatim (no newline appended)", async () => {
    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }
    const dispatched: Array<{ readonly pane_id: string; readonly text: string }> = []

    await Effect.runPromise(
      Effect.scoped(
        runInPane(pane, Stream.make("hello ", "world", "\n")).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.send_text": (p) => {
                dispatched.push(p)
                return Effect.succeed(new OkResult({ type: "ok" }))
              },
            }),
          ),
        ),
      ),
    )

    expect(dispatched).toEqual([
      { pane_id: "w1:p1", text: "hello " },
      { pane_id: "w1:p1", text: "world" },
      { pane_id: "w1:p1", text: "\n" },
    ])
  })

  test("streaming runInPane dual-shape: data-first and data-last dispatch identical pane.send_text call sequences", async () => {
    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }
    const dispatchedDataFirst: Array<{ readonly pane_id: string; readonly text: string }> = []
    const dispatchedDataLast: Array<{ readonly pane_id: string; readonly text: string }> = []

    await Effect.runPromise(
      Effect.scoped(
        runInPane(pane, Stream.make("no-", "newline")).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.send_text": (p) => {
                dispatchedDataFirst.push(p)
                return Effect.succeed(new OkResult({ type: "ok" }))
              },
            }),
          ),
        ),
      ),
    )
    await Effect.runPromise(
      Effect.scoped(
        runInPane(Stream.make("no-", "newline"))(pane).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.send_text": (p) => {
                dispatchedDataLast.push(p)
                return Effect.succeed(new OkResult({ type: "ok" }))
              },
            }),
          ),
        ),
      ),
    )

    expect(dispatchedDataFirst).toEqual(dispatchedDataLast)
    expect(dispatchedDataFirst).toEqual([
      { pane_id: "w1:p1", text: "no-" },
      { pane_id: "w1:p1", text: "newline" },
    ])
  })

  test("streaming runInPane propagates a tagged stream error mid-stream (not swallowed alongside HerdrProtocolError)", async () => {
    class MyStreamError extends Data.TaggedError("MyStreamError")<{ readonly reason: string }> {}

    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }
    const dispatched: Array<string> = []
    const failingStream = Stream.concat(
      Stream.make("chunk-1", "chunk-2"),
      Stream.fail(new MyStreamError({ reason: "upstream broke" })),
    ).pipe(Stream.concat(Stream.make("chunk-3-never-sent")))

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        runInPane(pane, failingStream).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.send_text": (p) => {
                dispatched.push(p.text)
                return Effect.succeed(new OkResult({ type: "ok" }))
              },
            }),
          ),
        ),
      ),
    )

    expect(dispatched).toEqual(["chunk-1", "chunk-2"])
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(Cause.squash(result.cause)).toEqual(new MyStreamError({ reason: "upstream broke" }))
    }
  })

  test("waitForOutput emits the matched_line from a successful pane.wait_for_output reply", async () => {
    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }
    let dispatched:
      | {
        readonly pane_id: string
        readonly source: string
        readonly match: { readonly type: string; readonly value: string }
        readonly timeout_ms?: number | undefined
      }
      | undefined

    const chunks = await Effect.runPromise(
      Effect.scoped(
        waitForOutput(pane, "ready").pipe(
          Stream.runCollect,
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.wait_for_output": (p) => {
                dispatched = p
                return Effect.succeed(
                  new PaneWaitForOutputResult({
                    type: "output_matched",
                    pane_id: "w1:p1",
                    revision: 0,
                    matched_line: "echo ready",
                    read: {
                      pane_id: "w1:p1",
                      workspace_id: "w1",
                      tab_id: "w1:t1",
                      source: "recent_unwrapped",
                      format: "text",
                      text: "echo ready\nready\n",
                      revision: 0,
                      truncated: false,
                    },
                  }),
                )
              },
            }),
          ),
        ),
      ),
    )

    expect(Array.from(chunks)).toEqual(["echo ready"])
    expect(dispatched?.pane_id).toBe("w1:p1")
    expect(dispatched?.source).toBe("recent")
    expect(dispatched?.match).toEqual({ type: "substring", value: "ready" })
    expect(dispatched?.timeout_ms).toBeUndefined()
  })

  test("waitForOutput sends a regex match when options.regex is true, and forwards timeout_ms", async () => {
    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }
    let dispatchedMatch: { readonly type: string; readonly value: string } | undefined
    let dispatchedTimeout: number | undefined

    await Effect.runPromise(
      Effect.scoped(
        waitForOutput(pane, "READY-\\d+", { regex: true, timeout: "2 seconds" }).pipe(
          Stream.runCollect,
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.wait_for_output": (p) => {
                dispatchedMatch = p.match
                dispatchedTimeout = p.timeout_ms
                return Effect.succeed(
                  new PaneWaitForOutputResult({
                    type: "output_matched",
                    pane_id: "w1:p1",
                    revision: 0,
                    matched_line: "echo READY-42",
                    read: {
                      pane_id: "w1:p1",
                      workspace_id: "w1",
                      tab_id: "w1:t1",
                      source: "recent_unwrapped",
                      format: "text",
                      text: "echo READY-42\nREADY-42\n",
                      revision: 0,
                      truncated: false,
                    },
                  }),
                )
              },
            }),
          ),
        ),
      ),
    )

    expect(dispatchedMatch).toEqual({ type: "regex", value: "READY-\\d+" })
    expect(dispatchedTimeout).toBe(2000)
  })

  test("waitForOutput maps a timeout-coded HerdrProtocolError to WaitError({ reason: \"timeout\" })", async () => {
    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        waitForOutput(pane, "will-never-appear", { timeout: "500 millis" }).pipe(
          Stream.runCollect,
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.wait_for_output": () =>
                Effect.fail(
                  new HerdrProtocolError({ code: "timeout", rawMessage: "timed out waiting for output match" }),
                ),
            }),
          ),
        ),
      ),
    )

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(Cause.squash(result.cause)).toEqual(new WaitError({ reason: "timeout" }))
    }
  })

  test("waitForOutput propagates a non-timeout HerdrProtocolError unchanged", async () => {
    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }

    const result = await Effect.runPromiseExit(
      Effect.scoped(
        waitForOutput(pane, "ready").pipe(
          Stream.runCollect,
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "pane.wait_for_output": () =>
                Effect.fail(new HerdrProtocolError({ code: "pane_not_found", rawMessage: "pane not found" })),
            }),
          ),
        ),
      ),
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(Cause.squash(result.cause)).toEqual(
        new HerdrProtocolError({ code: "pane_not_found", rawMessage: "pane not found" }),
      )
    }
  })

  test("waitForOutput dual-shape: data-first and data-last dispatch identical pane.wait_for_output calls", async () => {
    const pane = { id: "w1:p1" as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }
    const wireResult = new PaneWaitForOutputResult({
      type: "output_matched",
      pane_id: "w1:p1",
      revision: 0,
      matched_line: "echo ready",
      read: {
        pane_id: "w1:p1",
        workspace_id: "w1",
        tab_id: "w1:t1",
        source: "recent_unwrapped",
        format: "text",
        text: "echo ready\nready\n",
        revision: 0,
        truncated: false,
      },
    })

    const dataFirst = await Effect.runPromise(
      Effect.scoped(
        waitForOutput(pane, "ready").pipe(
          Stream.runCollect,
          Effect.provide(HerdrSession.layer),
          Effect.provide(fakeConnectionLayer({ "pane.wait_for_output": () => Effect.succeed(wireResult) })),
        ),
      ),
    )
    const dataLast = await Effect.runPromise(
      Effect.scoped(
        waitForOutput("ready")(pane).pipe(
          Stream.runCollect,
          Effect.provide(HerdrSession.layer),
          Effect.provide(fakeConnectionLayer({ "pane.wait_for_output": () => Effect.succeed(wireResult) })),
        ),
      ),
    )

    expect(Array.from(dataFirst)).toEqual(["echo ready"])
    expect(Array.from(dataLast)).toEqual(["echo ready"])
  })
})

describe("operations/focus", () => {
  test("activePane(tab) dispatches session.snapshot + pane.get, not workspace.get", async () => {
    let snapshotCalled = false
    let paneGetCalled = false

    const result = await Effect.runPromise(
      Effect.scoped(
        activePane({ id: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId }).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "workspace.get": () => Effect.die("activePane(tab) must not call workspace.get"),
              "session.snapshot": () => {
                snapshotCalled = true
                return Effect.succeed(
                  new SessionSnapshotResult({
                    type: "session_snapshot",
                    snapshot: {
                      focused_workspace_id: "w1",
                      focused_tab_id: "w1:t1",
                      focused_pane_id: "w1:p2",
                      workspaces: [],
                      tabs: [],
                      panes: [],
                      layouts: [
                        { workspace_id: "w1", tab_id: "w1:t1", focused_pane_id: "w1:p2" },
                      ],
                    },
                  }),
                )
              },
              "pane.get": (p) => {
                paneGetCalled = true
                expect(p.pane_id).toBe("w1:p2")
                return Effect.succeed(
                  new PaneInfoResult({
                    type: "pane_info",
                    pane: {
                      pane_id: "w1:p2",
                      tab_id: "w1:t1",
                      workspace_id: "w1",
                      terminal_id: "term-2",
                      focused: true,
                      agent_status: "idle",
                      revision: 2,
                    },
                  }),
                )
              },
            }),
          ),
        ),
      ),
    )

    expect(snapshotCalled).toBe(true)
    expect(paneGetCalled).toBe(true)
    expect(result.id).toBe("w1:p2" as PaneId)
  })

  test("activePane(workspace) dispatches workspace.get -> session.snapshot -> pane.get", async () => {
    const calls: Array<string> = []

    const result = await Effect.runPromise(
      Effect.scoped(
        activePane({ id: "w1" as WorkspaceId }).pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "workspace.get": (p) => {
                calls.push("workspace.get")
                return Effect.succeed(
                  new WorkspaceInfoResult({
                    type: "workspace_info",
                    workspace: {
                      workspace_id: p.workspace_id,
                      number: 1,
                      label: "default",
                      focused: true,
                      active_tab_id: "w1:t1",
                      tab_count: 1,
                      pane_count: 2,
                      agent_status: "idle",
                    },
                  }),
                )
              },
              "session.snapshot": () => {
                calls.push("session.snapshot")
                return Effect.succeed(
                  new SessionSnapshotResult({
                    type: "session_snapshot",
                    snapshot: {
                      focused_workspace_id: "w1",
                      focused_tab_id: "w1:t1",
                      focused_pane_id: "w1:p1",
                      workspaces: [],
                      tabs: [],
                      panes: [],
                      layouts: [
                        { workspace_id: "w1", tab_id: "w1:t1", focused_pane_id: "w1:p1" },
                      ],
                    },
                  }),
                )
              },
              "pane.get": (p) => {
                calls.push("pane.get")
                return Effect.succeed(
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
                    },
                  }),
                )
              },
            }),
          ),
        ),
      ),
    )

    expect(calls).toEqual(["workspace.get", "session.snapshot", "pane.get"])
    expect(result.id).toBe("w1:p1" as PaneId)
  })

  test("activeTab dispatches workspace.get -> tab.get and decodes a TabSnapshot", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        activeTab({ id: "w1" as WorkspaceId }).pipe(
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

    expect(result.id).toBe("w1:t1" as TabId)
    expect(result.label).toBe("main")
  })

  test("focusedPane is Option.none when session.snapshot's focused_pane_id is null", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        focusedPane.pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "session.snapshot": () =>
                Effect.succeed(
                  new SessionSnapshotResult({
                    type: "session_snapshot",
                    snapshot: {
                      focused_workspace_id: null,
                      focused_tab_id: null,
                      focused_pane_id: null,
                      workspaces: [],
                      tabs: [],
                      panes: [],
                      layouts: [],
                    },
                  }),
                ),
            }),
          ),
        ),
      ),
    )

    expect(Option.isNone(result)).toBe(true)
  })

  test("focusedPane is Option.some(pane) when session.snapshot's focused_pane_id is non-null", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        focusedPane.pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "session.snapshot": () =>
                Effect.succeed(
                  new SessionSnapshotResult({
                    type: "session_snapshot",
                    snapshot: {
                      focused_workspace_id: "w1",
                      focused_tab_id: "w1:t1",
                      focused_pane_id: "w1:p1",
                      workspaces: [],
                      tabs: [],
                      panes: [],
                      layouts: [],
                    },
                  }),
                ),
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

  test("focusedTab is Option.none/Option.some following session.snapshot's focused_tab_id", async () => {
    const noneResult = await Effect.runPromise(
      Effect.scoped(
        focusedTab.pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "session.snapshot": () =>
                Effect.succeed(
                  new SessionSnapshotResult({
                    type: "session_snapshot",
                    snapshot: {
                      focused_workspace_id: null,
                      focused_tab_id: null,
                      focused_pane_id: null,
                      workspaces: [],
                      tabs: [],
                      panes: [],
                      layouts: [],
                    },
                  }),
                ),
            }),
          ),
        ),
      ),
    )
    expect(Option.isNone(noneResult)).toBe(true)

    const someResult = await Effect.runPromise(
      Effect.scoped(
        focusedTab.pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "session.snapshot": () =>
                Effect.succeed(
                  new SessionSnapshotResult({
                    type: "session_snapshot",
                    snapshot: {
                      focused_workspace_id: "w1",
                      focused_tab_id: "w1:t1",
                      focused_pane_id: "w1:p1",
                      workspaces: [],
                      tabs: [],
                      panes: [],
                      layouts: [],
                    },
                  }),
                ),
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
    expect(Option.isSome(someResult)).toBe(true)
    if (Option.isSome(someResult)) expect(someResult.value.id).toBe("w1:t1" as TabId)
  })

  test("focusedWorkspace is Option.none/Option.some following session.snapshot's focused_workspace_id", async () => {
    const noneResult = await Effect.runPromise(
      Effect.scoped(
        focusedWorkspace.pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "session.snapshot": () =>
                Effect.succeed(
                  new SessionSnapshotResult({
                    type: "session_snapshot",
                    snapshot: {
                      focused_workspace_id: null,
                      focused_tab_id: null,
                      focused_pane_id: null,
                      workspaces: [],
                      tabs: [],
                      panes: [],
                      layouts: [],
                    },
                  }),
                ),
            }),
          ),
        ),
      ),
    )
    expect(Option.isNone(noneResult)).toBe(true)

    const someResult = await Effect.runPromise(
      Effect.scoped(
        focusedWorkspace.pipe(
          Effect.provide(HerdrSession.layer),
          Effect.provide(
            fakeConnectionLayer({
              "session.snapshot": () =>
                Effect.succeed(
                  new SessionSnapshotResult({
                    type: "session_snapshot",
                    snapshot: {
                      focused_workspace_id: "w1",
                      focused_tab_id: "w1:t1",
                      focused_pane_id: "w1:p1",
                      workspaces: [],
                      tabs: [],
                      panes: [],
                      layouts: [],
                    },
                  }),
                ),
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
    expect(Option.isSome(someResult)).toBe(true)
    if (Option.isSome(someResult)) expect(someResult.value.id).toBe("w1" as WorkspaceId)
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
