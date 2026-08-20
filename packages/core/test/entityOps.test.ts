import { describe, expect, test } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { HerdrConnection } from "../src/HerdrConnection.js"
import * as HerdrSession from "../src/HerdrSession.js"
import { close, focus, rename } from "../src/operations/entity.js"
import { makePane, makeTab, makeWorkspace } from "../src/protocol/schemas.js"
import type { PaneId, TabId, WorkspaceId } from "../src/protocol/schemas.js"

/**
 * Unit tests for the kind-polymorphic `close`/`focus`/`rename`: that each
 * dispatches to the RPC for the entity's own kind. The assertion is the
 * recorded wire call, so a mis-dispatch (a `Pane` routed to `tab.close`) fails
 * — which is exactly what the structural guards used to permit.
 */

const pane = makePane({
  id: "w1:t1:p1" as PaneId,
  tabId: "w1:t1" as TabId,
  workspaceId: "w1" as WorkspaceId,
})
const tab = makeTab({ id: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId })
const workspace = makeWorkspace({ id: "w1" as WorkspaceId })

/** Fake connection recording every RPC method invoked, with its id argument. */
const withRecorder = <A, E, R>(body: (calls: Ref.Ref<ReadonlyArray<string>>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const calls = yield* Ref.make<ReadonlyArray<string>>([])

    const record = (method: string, idField: string) => (params: Record<string, string>) =>
      Ref.update(calls, (prior) => [...prior, `${method}:${params[idField]}`])

    const rpc = {
      "pane.close": record("pane.close", "pane_id"),
      "tab.close": record("tab.close", "tab_id"),
      "workspace.close": record("workspace.close", "workspace_id"),
      "pane.focus": record("pane.focus", "pane_id"),
      "tab.focus": record("tab.focus", "tab_id"),
      "workspace.focus": record("workspace.focus", "workspace_id"),
      "pane.rename": record("pane.rename", "pane_id"),
      "tab.rename": record("tab.rename", "tab_id"),
      "workspace.rename": record("workspace.rename", "workspace_id"),
    }

    const layer = Layer.succeed(HerdrConnection, {
      rpc,
      subscribeEvents: () => Effect.die("subscribeEvents not stubbed"),
    } as unknown as typeof HerdrConnection.Service)

    return yield* body(calls).pipe(
      Effect.provide(HerdrSession.layer),
      Effect.provide(layer),
    ) as Effect.Effect<A, E, never>
  })

describe("operations/entity — polymorphic dispatch", () => {
  test("close routes each kind to its own RPC", async () => {
    const calls = await Effect.runPromise(
      withRecorder((calls) =>
        Effect.gen(function*() {
          yield* close(pane)
          yield* close(tab)
          yield* close(workspace)
          return yield* Ref.get(calls)
        })
      ),
    )

    expect(calls).toEqual(["pane.close:w1:t1:p1", "tab.close:w1:t1", "workspace.close:w1"])
  })

  test("focus routes each kind to its own RPC", async () => {
    const calls = await Effect.runPromise(
      withRecorder((calls) =>
        Effect.gen(function*() {
          yield* focus(pane)
          yield* focus(tab)
          yield* focus(workspace)
          return yield* Ref.get(calls)
        })
      ),
    )

    expect(calls).toEqual(["pane.focus:w1:t1:p1", "tab.focus:w1:t1", "workspace.focus:w1"])
  })

  test("rename routes each kind to its own RPC, data-first", async () => {
    const calls = await Effect.runPromise(
      withRecorder((calls) =>
        Effect.gen(function*() {
          yield* rename(pane, "p")
          yield* rename(tab, "t")
          yield* rename(workspace, "w")
          return yield* Ref.get(calls)
        })
      ),
    )

    expect(calls).toEqual(["pane.rename:w1:t1:p1", "tab.rename:w1:t1", "workspace.rename:w1"])
  })

  test("rename is dual-shaped, so it composes in a pipe", async () => {
    const calls = await Effect.runPromise(
      withRecorder((calls) =>
        Effect.gen(function*() {
          // Data-last: the discriminator must see a string, not an entity.
          yield* Effect.succeed(tab).pipe(Effect.flatMap(rename("build")))
          return yield* Ref.get(calls)
        })
      ),
    )

    expect(calls).toEqual(["tab.rename:w1:t1"])
  })

  test("a pane is never mistaken for a tab or workspace", async () => {
    // The regression this whole branding exists to prevent: a Pane carries
    // every field a Tab does, which carries every field a Workspace does, so
    // a field-presence discriminator would route all three to `pane.*`'s
    // structural superset and silently close the wrong resource.
    const calls = await Effect.runPromise(
      withRecorder((calls) =>
        Effect.gen(function*() {
          yield* close(pane)
          return yield* Ref.get(calls)
        })
      ),
    )

    expect(calls).toEqual(["pane.close:w1:t1:p1"])
    expect(calls).not.toContain("tab.close:w1:t1:p1")
    expect(calls).not.toContain("workspace.close:w1:t1:p1")
  })
})
