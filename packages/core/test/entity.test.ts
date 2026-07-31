import { describe, expect, test } from "bun:test"
import { Equal, Hash } from "effect"
import {
  EntityOrder,
  EntityTypeId,
  isEntity,
  isPane,
  isTab,
  isWorkspace,
  makePane,
  makeTab,
  makeWorkspace,
} from "../src/protocol/schemas.js"
import type { PaneId, TabId, WorkspaceId } from "../src/protocol/schemas.js"

/**
 * Unit tests for the branded identity types: the `EntityTypeId` tag that makes
 * `Pane`/`Tab`/`Workspace` discriminable despite being structurally nested,
 * plus the `Equal`/`Hash`/`Order` data traits.
 */

const paneOf = (id: string) =>
  makePane({ id: id as PaneId, tabId: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId })

describe("entity tags", () => {
  test("each constructor tags its own kind", () => {
    expect(paneOf("w1:t1:p1")[EntityTypeId]).toBe("pane")
    expect(makeTab({ id: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId })[EntityTypeId]).toBe("tab")
    expect(makeWorkspace({ id: "w1" as WorkspaceId })[EntityTypeId]).toBe("workspace")
  })

  test("refinements discriminate the structurally nested kinds", () => {
    const pane = paneOf("w1:t1:p1")
    const tab = makeTab({ id: "w1:t1" as TabId, workspaceId: "w1" as WorkspaceId })
    const workspace = makeWorkspace({ id: "w1" as WorkspaceId })

    // The whole point of the tag: a Pane has every field a Tab has, which has
    // every field a Workspace has, so field-presence checks would say yes to
    // all three here. The tag must say no.
    expect([isPane(pane), isTab(pane), isWorkspace(pane)]).toEqual([true, false, false])
    expect([isPane(tab), isTab(tab), isWorkspace(tab)]).toEqual([false, true, false])
    expect([isPane(workspace), isTab(workspace), isWorkspace(workspace)]).toEqual([false, false, true])
  })

  test("refinements reject untagged look-alikes and non-objects", () => {
    // A bare literal with all the right fields is not an entity.
    const lookAlike = { id: "w1:t1:p1", tabId: "w1:t1", workspaceId: "w1" }
    expect(isEntity(lookAlike)).toBe(false)
    expect(isPane(lookAlike)).toBe(false)

    for (const notAnEntity of [null, undefined, "w1", 42, [], {}]) {
      expect(isEntity(notAnEntity)).toBe(false)
    }
  })

  test("refinements reject an options object, so Function.dual discriminators stay correct", () => {
    // Every dual combinator discriminates data-first vs data-last on the first
    // argument being an entity; an options bag must never look like one.
    expect(isPane({ direction: "right" })).toBe(false)
    expect(isWorkspace({ label: "scratch" })).toBe(false)
  })

  test("spreading an entity drops the tag, so a spread cannot pose as one", () => {
    // The tag lives on the prototype precisely so `{ ...pane }` loses it
    // rather than copying it without the Equal/Hash methods.
    const spread = { ...paneOf("w1:t1:p1") }
    expect(isPane(spread)).toBe(false)
  })
})

describe("entity data traits", () => {
  test("same kind and id are equal with equal hashes", () => {
    const a = paneOf("w1:t1:p1")
    const b = paneOf("w1:t1:p1")

    expect(Equal.equals(a, b)).toBe(true)
    expect(Hash.hash(a)).toBe(Hash.hash(b))
  })

  test("different ids are not equal", () => {
    expect(Equal.equals(paneOf("w1:t1:p1"), paneOf("w1:t1:p2"))).toBe(false)
  })

  test("same id but different kind is not equal", () => {
    // "w1" as both a workspace and (hypothetically) a tab id must not collide —
    // this is the failure mode an id-only Equal would have.
    const asWorkspace = makeWorkspace({ id: "w1" as WorkspaceId })
    const asTab = makeTab({ id: "w1" as unknown as TabId, workspaceId: "w1" as WorkspaceId })

    expect(Equal.equals(asWorkspace, asTab)).toBe(false)
  })

  test("equality survives extra snapshot fields, since identity is kind plus id", () => {
    const identity = paneOf("w1:t1:p1")
    const snapshotish = makePane({
      id: "w1:t1:p1" as PaneId,
      tabId: "w1:t1" as TabId,
      workspaceId: "w1" as WorkspaceId,
      revision: 7,
    })

    expect(Equal.equals(identity, snapshotish)).toBe(true)
    expect(snapshotish.revision).toBe(7)
  })

  test("EntityOrder sorts by id", () => {
    const sorted = [paneOf("w1:t1:p3"), paneOf("w1:t1:p1"), paneOf("w1:t1:p2")]
      .sort(EntityOrder)
      .map((pane) => pane.id as string)

    expect(sorted).toEqual(["w1:t1:p1", "w1:t1:p2", "w1:t1:p3"])
  })
})
