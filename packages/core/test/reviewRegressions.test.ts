import { describe, expect, test } from "bun:test"
import { Effect, Equal, HashSet, Layer, Option, Schema } from "effect"
import { HerdrConnection } from "../src/HerdrConnection.js"
import * as HerdrSessionLayer from "../src/HerdrSession.js"
import { currentPaneById } from "../src/operations/current.js"
import {
  AgentPromptedResult,
  AgentViewSortWire,
  HerdrRpcs,
  WorktreeInfoWire,
} from "../src/protocol/HerdrRpcs.js"
import { close } from "../src/operations/entity.js"
import { EntityOrder, makePane, makeTab, makeWorkspace } from "../src/protocol/schemas.js"
import type { Pane, PaneId, PaneSnapshot, TabId, WorkspaceId } from "../src/protocol/schemas.js"

/**
 * Regression tests for defects found in review of the branded-entities branch.
 * Each of these passed the pre-existing suite, which is why the bugs shipped —
 * so each test here must fail if its fix is reverted.
 */

const pane = makePane({
  id: "w1:t1:p1" as PaneId,
  tabId: "w1:t1" as TabId,
  workspaceId: "w1" as WorkspaceId,
})

describe("agent.prompt reply shape", () => {
  // Read the schema off the Rpc definition itself, so this fails if
  // `agent.prompt` is ever re-pointed at OkResult — decoding
  // AgentPromptedResult directly would pass regardless of the wiring.
  const promptRpc = HerdrRpcs.requests.get("agent.prompt")!

  test("agent.prompt declares the reply herdr actually sends", () => {
    const wire = {
      type: "agent_prompted",
      agent: {
        pane_id: "w1:t1:p1",
        tab_id: "w1:t1",
        workspace_id: "w1",
        terminal_id: "term-1",
        revision: 1,
        focused: true,
        agent_status: "idle",
      },
    }
    const decoded = Schema.decodeUnknownSync(promptRpc.successSchema as typeof AgentPromptedResult)(wire)
    expect(decoded.type).toBe("agent_prompted")
    expect(decoded.agent.pane_id).toBe("w1:t1:p1")
  })

  test("agent.prompt does not accept a bare ok reply", () => {
    expect(() =>
      Schema.decodeUnknownSync(promptRpc.successSchema as typeof AgentPromptedResult)({ type: "ok" })
    ).toThrow()
  })
})

describe("agent.view.set sort payload", () => {
  test("accepts a plain object literal on the encode path", () => {
    // As a Schema.Class this required `instanceof` and threw
    // "Expected AgentViewSortWire" for any real caller's `{field, order}`.
    const sort = [{ field: "status", order: "asc" as const }]
    const encoded = Schema.encodeUnknownSync(Schema.Array(AgentViewSortWire))(sort)
    expect(encoded).toEqual([{ field: "status", order: "asc" }])
  })

  test("accepts a sort key without an order", () => {
    expect(Schema.encodeUnknownSync(Schema.Array(AgentViewSortWire))([{ field: "name" }]))
      .toEqual([{ field: "name" }])
  })
})

describe("worktree wire optionality", () => {
  test("decodes a worktree with branch/open_workspace_id keys absent", () => {
    // herdr omits both keys for a detached, unopened worktree. Modeling them as
    // required-but-nullable failed decode on the key being missing.
    const wire = {
      path: "/tmp/wt",
      label: "wt",
      is_bare: false,
      is_detached: true,
      is_linked_worktree: true,
      is_prunable: false,
    }
    const decoded = Schema.decodeUnknownSync(WorktreeInfoWire)(wire)
    expect(decoded.path).toBe("/tmp/wt")
    expect(decoded.branch ?? null).toBeNull()
  })

  test("still decodes the keys when herdr does send them", () => {
    const decoded = Schema.decodeUnknownSync(WorktreeInfoWire)({
      path: "/tmp/wt",
      label: "wt",
      branch: "main",
      is_bare: false,
      is_detached: false,
      is_linked_worktree: true,
      is_prunable: false,
      open_workspace_id: "w1",
    })
    expect(decoded.branch).toBe("main")
    expect(decoded.open_workspace_id).toBe("w1")
  })
})

describe("EntityOrder / Equal / Hash coherence", () => {
  test("a same-id different-kind pair is distinct under Equal, Hash, and Order", () => {
    // Order compared by id alone while Equal/Hash mixed in kind, so these
    // ordered as equal (0) but hashed as two distinct elements.
    const asWorkspace = makeWorkspace({ id: "w1" as WorkspaceId })
    const asTab = makeTab({ id: "w1" as unknown as TabId, workspaceId: "w1" as WorkspaceId })

    expect(Equal.equals(asWorkspace, asTab)).toBe(false)
    expect(HashSet.size(HashSet.fromIterable([asWorkspace, asTab]))).toBe(2)
    // The load-bearing assertion: Order must not call them equal either.
    // Direction follows the kind tiebreak ("tab" < "workspace"), which is
    // arbitrary but must be consistent and non-zero.
    expect(EntityOrder(asWorkspace, asTab)).not.toBe(0)
    expect(EntityOrder(asTab, asWorkspace)).toBe(EntityOrder(asWorkspace, asTab) === 1 ? -1 : 1)
  })

  test("identical kind and id still order as equal", () => {
    expect(EntityOrder(pane, makePane({
      id: "w1:t1:p1" as PaneId,
      tabId: "w1:t1" as TabId,
      workspaceId: "w1" as WorkspaceId,
    }))).toBe(0)
  })

  test("same kind sorts by id", () => {
    const ids = [
      makeWorkspace({ id: "w3" as WorkspaceId }),
      makeWorkspace({ id: "w1" as WorkspaceId }),
      makeWorkspace({ id: "w2" as WorkspaceId }),
    ].sort(EntityOrder).map((w) => w.id as string)
    expect(ids).toEqual(["w1", "w2", "w3"])
  })
})

describe("detagged entity dispatch", () => {
  test("a spread entity fails loudly instead of silently returning undefined", async () => {
    // TypeScript accepts `{ ...pane }` as a Pane (it tracks the symbol-keyed
    // property even though the spread drops it at runtime), so this value does
    // reach dispatch. Without a default arm the switch fell through and the
    // combinator returned `undefined` — a silent no-op.
    const spread = { ...pane } as Pane
    const outcome = await Effect.runPromise(Effect.exit(close(spread) as Effect.Effect<void>))
    expect(outcome._tag).toBe("Failure")
  })

  test("a properly constructed entity still dispatches to an Effect", () => {
    expect(Effect.isEffect(close(pane))).toBe(true)
  })
})

describe("paneNeighbor absent-key handling", () => {
  test("Option.fromNullOr(undefined) is Some — the trap the fix avoids", () => {
    // Documents *why* paneNeighbor cannot use fromNullOr: neighbor_pane_id is
    // schema-optional, so an absent key decodes to undefined.
    expect(Option.isSome(Option.fromNullOr(undefined))).toBe(true)
    expect(Option.isNone(Option.fromNullishOr(undefined))).toBe(true)
  })
})

describe("currentPaneById round-trips", () => {
  test("decodes pane.current's reply without a second pane.get", async () => {
    // `pane.current` already carries a full pane record. Re-resolving via
    // `pane.get` cost an extra call and let the pane change between the two.
    const calls: Array<string> = []
    const paneRecord = {
      pane_id: "w1:t1:p1",
      tab_id: "w1:t1",
      workspace_id: "w1",
      terminal_id: "term-1",
      focused: true,
      agent_status: "idle" as const,
      revision: 3,
    }

    const layer = Layer.succeed(HerdrConnection, {
      rpc: {
        "pane.current": () => {
          calls.push("pane.current")
          return Effect.succeed({ type: "pane_current", pane: paneRecord })
        },
        "pane.get": () => {
          calls.push("pane.get")
          return Effect.succeed({ type: "pane_info", pane: paneRecord })
        },
      },
      subscribeEvents: () => Effect.die("subscribeEvents not stubbed"),
    } as unknown as typeof HerdrConnection.Service)

    const snapshot = await Effect.runPromise(
      currentPaneById("w1:t1:p1").pipe(
        Effect.provide(HerdrSessionLayer.layer),
        Effect.provide(layer),
      ) as Effect.Effect<PaneSnapshot>,
    )

    expect(calls).toEqual(["pane.current"])
    expect(snapshot.id as string).toBe("w1:t1:p1")
    expect(snapshot.revision).toBe(3)
  })
})
