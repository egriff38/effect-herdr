/**
 * Pane manipulation combinators.
 *
 * These operate on `Pane` identity (not `PaneSnapshot`) — none of them
 * need the mutable state of the pane, only its stable id. Callers who
 * need current state read it via `focus.ts` combinators or `snapshotPane`
 * from this module.
 */

import { DateTime, Effect, Function, Predicate } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { Pane, PaneId, PaneSnapshot, Workspace } from "../protocol/schemas.js"
import type { PaneInfoWire } from "../protocol/HerdrRpcs.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * Decode herdr's raw `PaneInfoWire` (from `pane.get` / `pane.list`) into
 * the SDK's `PaneSnapshot`. `capturedAt` is stamped at decode time via
 * Effect's Clock (through `DateTime.now`), not the wire — herdr does not
 * send a capture timestamp.
 */
const decodePaneSnapshot = (wire: PaneInfoWire): Effect.Effect<PaneSnapshot> =>
  Effect.map(DateTime.now, (capturedAt) => ({
    id: wire.pane_id as PaneId,
    tabId: wire.tab_id as PaneSnapshot["tabId"],
    workspaceId: wire.workspace_id as PaneSnapshot["workspaceId"],
    revision: wire.revision,
    cwd: wire.cwd ?? "",
    agent: wire.agent ?? undefined,
    agentStatus: wire.agent_status,
    focused: wire.focused,
    capturedAt,
  }))

/**
 * List panes in a workspace. Returns snapshots (herdr's `pane.list` RPC
 * returns full records, so giving back only identity would be lossy).
 */
export const listPanes = (
  workspace: Workspace,
): Effect.Effect<ReadonlyArray<PaneSnapshot>, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["pane.list"]({ workspace_id: workspace.id })
    return yield* Effect.all(result.panes.map(decodePaneSnapshot))
  })

/**
 * Look up a pane's current state. Round-trips to herdr; the returned
 * `PaneSnapshot` is fresh as of this call.
 */
export const snapshotPane = (
  pane: { readonly id: PaneId },
): Effect.Effect<PaneSnapshot, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["pane.get"]({ pane_id: pane.id })
    return yield* decodePaneSnapshot(result.pane)
  })

/**
 * Options for `splitPane`. `direction` has no wire-level default — herdr's
 * `PaneSplitParams` requires it (confirmed via `scripts/herdr-schema.json`:
 * `direction` is the only required field, `focus` defaults to `false`
 * server-side). The SDK defaults to `"right"` when omitted so callers don't
 * have to pick every time.
 */
export interface SplitOptions {
  readonly direction?: "right" | "down"
  readonly focus?: boolean
}

const isPaneArg = (u: unknown): u is Pane =>
  Predicate.hasProperty(u, "id") && Predicate.hasProperty(u, "tabId") && Predicate.hasProperty(u, "workspaceId")

/**
 * Split `pane`, creating a new sibling pane. Dual-shaped: data-first
 * (`splitPane(pane, options)`) and data-last (`pane.pipe(splitPane(options))`).
 *
 * Returns the *new* pane's identity, not a `PaneSnapshot` — matches the
 * "combinators-that-mutate return identity" convention (`snapshotPane`
 * afterwards if you need state). Underneath: `pane.split`, whose result is
 * the same `pane_info` shape `pane.get` returns (verified live) — decoded
 * to identity only, since a full snapshot decode isn't needed here.
 */
export const splitPane: {
  (pane: Pane, options?: SplitOptions): Effect.Effect<Pane, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    options?: SplitOptions,
  ): (pane: Pane) => Effect.Effect<Pane, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPaneArg(args[0]),
  (pane: Pane, options?: SplitOptions) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const result = yield* session.rpc["pane.split"]({
        target_pane_id: pane.id,
        direction: options?.direction ?? "right",
        focus: options?.focus,
      })
      return {
        id: result.pane.pane_id as PaneId,
        tabId: result.pane.tab_id as Pane["tabId"],
        workspaceId: result.pane.workspace_id as Pane["workspaceId"],
      }
    }),
)

/**
 * Focus `pane`. Plain single-argument function, no `dual` (focus is a
 * global, non-relational mutation — there's no meaningful data-last shape).
 * Discards the echoed `pane_info` reply; callers who want fresh state call
 * `snapshotPane` afterwards.
 */
export const focusPane = (
  pane: Pane,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["pane.focus"]({ pane_id: pane.id })
  })

/**
 * Batch input: type `text` into `pane` and submit it. Dual-shaped: data-first
 * (`runInPane(pane, text)`) and data-last (`pane.pipe(runInPane(text))`),
 * matching `splitPane`'s pattern.
 *
 * Underneath: `pane.send_text`, herdr's ONLY text-input method (verified
 * live during implementation — there is no separate `pane.run`). herdr does
 * not append a trailing Enter itself, so this combinator appends `"\n"` to
 * the caller's string before dispatching — that's what makes this "batch"
 * (submit-and-move-on) rather than slice 7's streaming per-chunk sends,
 * which must NOT add a newline.
 *
 * CORRECTION vs. issue #6's own spec text: the issue describes dispatching
 * with `{ discard: true }` — Effect's `RpcClient` does support that option
 * (fires the request, never observes the reply), but it was verified live
 * that herdr always answers `pane.send_text` synchronously, including with
 * a real `HerdrProtocolError` (e.g. `pane_not_found`) when the target pane
 * doesn't exist. `{ discard: true }` discards errors along with successes —
 * confirmed via a local RpcTest probe that a failing handler's error never
 * reaches a `discard: true` caller, `Effect.runPromiseExit` reports Success.
 * Using it here would silently swallow exactly the failures this
 * combinator's own signature promises (`HerdrProtocolError` in the error
 * channel), so this implementation awaits the ack normally instead. The
 * "fire-and-forget" ergonomic the issue actually wants — not blocking on
 * the pane's shell finishing the command — falls out for free: `pane.send_text`
 * only acks that the text was typed into the pty, not that the shell
 * finished running it (that's slice 6's `waitForOutput`, a separate call).
 */
export const runInPane: {
  (pane: Pane, text: string): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (text: string): (pane: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPaneArg(args[0]),
  (pane: Pane, text: string) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["pane.send_text"]({ pane_id: pane.id, text: text + "\n" })
    }),
)
