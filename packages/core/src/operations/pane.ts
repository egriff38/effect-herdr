/**
 * Pane manipulation combinators.
 *
 * These operate on `Pane` identity (not `PaneSnapshot`) — none of them
 * need the mutable state of the pane, only its stable id. Callers who
 * need current state read it via `focus.ts` combinators or `snapshotPane`
 * from this module.
 */

import { DateTime, Duration, Effect, Function, Predicate, Stream } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import { HerdrProtocolError, WaitError } from "../protocol/errors.js"
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

/**
 * Options for `waitForOutput`. `regex` selects `OutputMatch`'s `"regex"`
 * variant over the default `"substring"`; `timeout` maps directly to the
 * wire's own `pane.wait_for_output` `timeout_ms` — herdr blocks
 * server-side and is the sole timeout mechanism (see the combinator's own
 * doc comment for why no separate SDK-side timer races it).
 */
export interface WaitOptions {
  readonly regex?: boolean
  readonly timeout?: Duration.Input
}

/**
 * Block until `match` appears in `pane`'s output, then emit it as a single
 * chunk. Dual-shaped: data-first (`waitForOutput(pane, match, options)`)
 * and data-last (`pane.pipe(waitForOutput(match, options))`), matching
 * `splitPane`/`runInPane`'s pattern.
 *
 * Underneath: `pane.wait_for_output`, which is a BLOCKING plain
 * request/reply on herdr's wire (verified live during implementation of
 * issue #7) — herdr itself holds the connection open until match-or-
 * timeout and replies exactly once. This combinator's `Stream` return type
 * is a service-layer ergonomic (matching the issue's `Stream.take(1)`-off
 * acceptance criterion), not a wire-level stream: `Stream.fromEffect` wraps
 * the one RPC call. Emits the matched line — `read.matched_line` — rather
 * than `read.read.text` (herdr's full read-buffer content since the pane's
 * last read): a live probe against `echo ready` confirmed `matched_line`
 * is exactly the shell line that satisfied the match (echoed command, no
 * surrounding buffer noise), which is what "one chunk emitted containing
 * ready" in the issue's E2E acceptance criterion expects.
 *
 * Uses `source: "recent"` — verified live to be the right default: it
 * returns the pane's scrollback since the caller's last read (so a
 * `runInPane` immediately before this call reliably surfaces that command's
 * echo/output), unlike `"visible"` (only the current viewport, which a
 * fast-scrolling shell can push the match out of) or `"detection"`
 * (agent-status heuristics, unrelated to raw text matching). No ergonomic
 * exposes a `source` override — callers needing `"visible"`/
 * `"recent_unwrapped"`/`"detection"` semantics can dispatch
 * `session.rpc["pane.wait_for_output"]` directly.
 *
 * herdr's own `timeout_ms` (from `options.timeout`, converted via
 * `Duration.toMillis`) is the sole timeout mechanism — no SDK-side
 * `Stream.timeoutFail` races it, since herdr already replies exactly once
 * with a `code: "timeout"` `HerdrProtocolError` (verified live) after
 * `timeout_ms` elapses; a second independent timer would only risk racing
 * herdr's own accurate one. That protocol error is mapped to
 * `WaitError({ reason: "timeout" })` here so callers get the SDK's own
 * tagged error rather than a raw wire error code.
 */
export const waitForOutput: {
  (
    pane: Pane,
    match: string,
    options?: WaitOptions,
  ): Stream.Stream<string, HerdrProtocolError | WaitError | RpcClientError, HerdrSession>
  (
    match: string,
    options?: WaitOptions,
  ): (pane: Pane) => Stream.Stream<string, HerdrProtocolError | WaitError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPaneArg(args[0]),
  (pane: Pane, match: string, options?: WaitOptions) =>
    Stream.fromEffect(
      Effect.gen(function*() {
        const session = yield* HerdrSession
        const result = yield* session.rpc["pane.wait_for_output"]({
          pane_id: pane.id,
          source: "recent",
          match: { type: options?.regex ? "regex" : "substring", value: match },
          timeout_ms: options?.timeout === undefined ? undefined : Duration.toMillis(options.timeout),
        }).pipe(
          Effect.catchTag("HerdrProtocolError", (error): Effect.Effect<never, HerdrProtocolError | WaitError> =>
            error.code === "timeout"
              ? Effect.fail(new WaitError({ reason: "timeout" }))
              : Effect.fail(error)),
        )
        return result.matched_line
      }),
    ),
)
