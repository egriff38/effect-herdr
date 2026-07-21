/**
 * Combinators for creating, mutating, and reading terminal panes.
 *
 * Every combinator here operates on `Pane` identity (id/tabId/workspaceId),
 * not `PaneSnapshot` — none of them need a pane's mutable state, only its
 * stable id. Callers who need current state call `snapshotPane` from this
 * module, or the live-updating accessors in `focus.ts`.
 *
 * @since 0.1.0
 */

import { DateTime, Duration, Effect, Function, Predicate, Stream } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import { HerdrProtocolError, WaitError } from "../protocol/errors.js"
import type { Pane, PaneId, PaneSnapshot, Workspace } from "../protocol/schemas.js"
import type { PaneInfoWire } from "../protocol/HerdrRpcs.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

// Decodes herdr's pane wire shape into a `PaneSnapshot`; `capturedAt` is stamped via Effect's Clock, not the wire.
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
 * Lists every pane in `workspace`, as snapshots.
 *
 * **Example** (listing panes)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, listPanes } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   const panes = yield* listPanes(workspace.value)
 *   yield* Effect.log(panes.map((p) => p.id))
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
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
 * Reads a pane's current state from herdr. Round-trips on every call — the
 * returned `PaneSnapshot` is fresh as of this call, never cached.
 *
 * **Example** (snapshotting a pane)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, snapshotPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const fresh = yield* snapshotPane(pane.value)
 *   yield* Effect.log(fresh.cwd)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
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
 * Options for `splitPane`. herdr requires an explicit split `direction` —
 * there is no server-side default — so the SDK defaults to `"right"` when
 * omitted. `focus` defaults to `false` server-side.
 *
 * @category models
 * @since 0.1.0
 */
export interface SplitOptions {
  readonly direction?: "right" | "down"
  readonly focus?: boolean
}

const isPaneArg = (u: unknown): u is Pane =>
  Predicate.hasProperty(u, "id") && Predicate.hasProperty(u, "tabId") && Predicate.hasProperty(u, "workspaceId")

/**
 * Splits `pane`, creating a new sibling pane. Returns the *new* pane's
 * identity (not a `PaneSnapshot`) — call `snapshotPane` afterwards for its
 * state. Dual-shaped: data-first (`splitPane(pane, options)`) and
 * data-last (`pane.pipe(splitPane(options))`).
 *
 * **Example** (splitting to the right)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, splitPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const newPane = yield* splitPane(pane.value, { direction: "right" })
 *   yield* Effect.log(newPane.id)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
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
 * Focuses `pane`. Not dual-shaped — focus is a global mutation, not a
 * relation between two values, so there's no meaningful data-last form.
 * Discards herdr's reply; call `snapshotPane` afterwards for fresh state.
 *
 * **Example** (focusing a pane)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, focusPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* focusPane(pane.value)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const focusPane = (
  pane: Pane,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["pane.focus"]({ pane_id: pane.id })
  })

/**
 * Types text into `pane`. Wraps `pane.send_text`, herdr's only text-input
 * method — herdr does not append a trailing Enter itself. Doesn't block on
 * the shell finishing the command, only on the text having been typed into
 * the pty (use `waitForOutput` to wait for a result).
 *
 * Two overload pairs, both dual-shaped (data-first and data-last via
 * `pane.pipe(...)`):
 *   - batch: `runInPane(pane, text)` takes a plain `string`, appends `"\n"`,
 *     and dispatches a single `pane.send_text` call.
 *   - streaming: `runInPane(pane, chunks)` takes a `Stream<string, E, R>`
 *     and dispatches one `pane.send_text` per chunk, verbatim, with no
 *     newline appended — useful for piping LLM tokens, where the caller
 *     decides exactly when to submit by including `"\n"` in a chunk.
 *
 * **Example** (batch)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, runInPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* runInPane(pane.value, "echo hello from effect-herdr")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
const dispatchRunInPane = (
  pane: Pane,
  input: string | Stream.Stream<string, unknown, unknown>,
): Effect.Effect<void, HerdrProtocolError | RpcClientError | unknown, HerdrSession | unknown> =>
  Stream.isStream(input)
    ? Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* Stream.runForEach(input, (chunk) => session.rpc["pane.send_text"]({ pane_id: pane.id, text: chunk }))
    })
    : Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["pane.send_text"]({ pane_id: pane.id, text: input + "\n" })
    })

export const runInPane: {
  (pane: Pane, text: string): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (text: string): (pane: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  <E, R>(
    pane: Pane,
    chunks: Stream.Stream<string, E, R>,
  ): Effect.Effect<void, HerdrProtocolError | RpcClientError | E, HerdrSession | R>
  <E, R>(
    chunks: Stream.Stream<string, E, R>,
  ): (pane: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError | E, HerdrSession | R>
} = Function.dual(
  (args) => isPaneArg(args[0]),
  dispatchRunInPane,
)

/**
 * Options for `waitForOutput`. `regex` selects a regex match over the
 * default substring match; `timeout` maps to herdr's own
 * `pane.wait_for_output` timeout — herdr blocks server-side and replies
 * exactly once with a match or a `timeout` error.
 *
 * @category models
 * @since 0.1.0
 */
export interface WaitOptions {
  readonly regex?: boolean
  readonly timeout?: Duration.Input
}

/**
 * Blocks until `match` appears in `pane`'s output, then emits the matched
 * line as a single chunk. Dual-shaped: data-first
 * (`waitForOutput(pane, match, options)`) and data-last
 * (`pane.pipe(waitForOutput(match, options))`).
 *
 * Wraps `pane.wait_for_output`, a blocking request/reply on herdr's wire —
 * herdr itself holds the connection open until match-or-timeout and
 * replies exactly once. The `Stream` return type is a service-layer
 * ergonomic (composes with `Stream.take`/`Stream.timeoutFail`), not a
 * wire-level stream. Reads with `source: "recent"` — herdr's scrollback
 * since the caller's last read — so a `runInPane` immediately before this
 * call reliably surfaces that command's echoed output. herdr's own
 * `timeout_ms` is the sole timeout mechanism; a timeout reply is mapped to
 * `WaitError({ reason: "timeout" })`.
 *
 * **Example** (waiting for a prompt)
 *
 * ```ts
 * import { Effect, Option, Stream } from "effect"
 * import { HerdrSession, currentPane, runInPane, waitForOutput } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* runInPane(pane.value, "echo ready")
 *   const line = yield* waitForOutput(pane.value, "ready").pipe(Stream.runHead)
 *   yield* Effect.log(line)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
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

/**
 * Closes `pane`. herdr collapses the parent tab/workspace automatically if
 * this was the last pane. Resolves to `void` on success.
 *
 * **Example** (closing a pane)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, closePane, splitPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const newPane = yield* splitPane(pane.value)
 *   yield* closePane(newPane)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const closePane = (pane: Pane): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["pane.close"]({ pane_id: pane.id })
  })
