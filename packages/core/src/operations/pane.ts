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

import { DateTime, Duration, Effect, Function, Option, Stream } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import { HerdrProtocolError, WaitError } from "../protocol/errors.js"
import type {
  Pane,
  PaneEdges,
  PaneId,
  PaneLayoutPane,
  PaneLayoutSnapshot,
  PaneLayoutSplit,
  PaneProcessInfo,
  PaneProcessInfoProcess,
  PaneSnapshot,
  TabId,
  Workspace,
  WorkspaceId,
} from "../protocol/schemas.js"
import { isPane, makePane } from "../protocol/schemas.js"
import type { PaneInfoWire, PaneLayoutSnapshotFullWire, PaneProcessInfoProcessWire } from "../protocol/HerdrRpcs.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * Decodes herdr's pane wire shape into a `PaneSnapshot`; `capturedAt` is
 * stamped via Effect's Clock, not the wire.
 *
 * Internal, not re-exported from the package barrel: shared with `current.ts`
 * so a caller holding a `pane.current` reply can decode it in place instead of
 * issuing a second round-trip for state it already has.
 */
export const decodePaneSnapshot = (wire: PaneInfoWire): Effect.Effect<PaneSnapshot> =>
  Effect.map(DateTime.now, (capturedAt) =>
    makePane({
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
  (args) => isPane(args[0]),
  (pane: Pane, options?: SplitOptions) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const result = yield* session.rpc["pane.split"]({
        target_pane_id: pane.id,
        direction: options?.direction ?? "right",
        focus: options?.focus,
      })
      return makePane({
        id: result.pane.pane_id as PaneId,
        tabId: result.pane.tab_id as Pane["tabId"],
        workspaceId: result.pane.workspace_id as Pane["workspaceId"],
      })
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
  (args) => isPane(args[0]),
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
  (args) => isPane(args[0]),
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

const decodePaneLayoutSnapshot = (wire: PaneLayoutSnapshotFullWire): PaneLayoutSnapshot => ({
  workspaceId: wire.workspace_id as WorkspaceId,
  tabId: wire.tab_id as TabId,
  zoomed: wire.zoomed,
  area: wire.area,
  focusedPaneId: wire.focused_pane_id as PaneId,
  panes: wire.panes.map((p): PaneLayoutPane => ({
    paneId: p.pane_id as PaneId,
    focused: p.focused,
    rect: p.rect,
  })),
  splits: wire.splits.map((s): PaneLayoutSplit => ({
    id: s.id,
    direction: s.direction,
    ratio: s.ratio,
    rect: s.rect,
  })),
})

/**
 * Renames `pane`'s display label. `label: undefined` (or omitted) clears
 * it — herdr's wire accepts `null` for "no label", which this maps from
 * `undefined`. Dual-shaped: data-first (`renamePane(pane, label)`) and
 * data-last (`pane.pipe(renamePane(label))`).
 *
 * **Example** (renaming a pane)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, renamePane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* renamePane(pane.value, "scratch")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const renamePane: {
  (pane: Pane, label?: string): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (label?: string): (pane: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPane(args[0]),
  (pane: Pane, label?: string) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["pane.rename"]({ pane_id: pane.id, label })
    }),
)

/**
 * Sends raw named key presses (e.g. `"Up"`, `"Ctrl+c"`, `"Escape"`) to
 * `pane` — distinct from `runInPane`'s literal-character text input.
 * `keys` is an open string array; herdr documents ad-hoc key-name
 * aliasing rather than a fixed enum. Dual-shaped: data-first
 * (`sendKeys(pane, keys)`) and data-last (`pane.pipe(sendKeys(keys))`).
 *
 * **Example** (sending an arrow key then Enter)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, sendKeys } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* sendKeys(pane.value, ["Up", "Enter"])
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const sendKeys: {
  (pane: Pane, keys: ReadonlyArray<string>): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    keys: ReadonlyArray<string>,
  ): (pane: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPane(args[0]),
  (pane: Pane, keys: ReadonlyArray<string>) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["pane.send_keys"]({ pane_id: pane.id, keys: keys as Array<string> })
    }),
)

/**
 * Options for `movePane`'s destination — an existing tab's split, a
 * brand-new tab, or a brand-new workspace. Mirrors the wire's
 * `PaneMoveDestination` discriminated union exactly.
 *
 * @category models
 * @since 0.1.0
 */
export type PaneMoveDestination =
  | { readonly type: "tab"; readonly tabId: TabId; readonly split: "right" | "down"; readonly targetPaneId?: PaneId; readonly ratio?: number }
  | { readonly type: "new_tab"; readonly workspaceId?: WorkspaceId; readonly label?: string }
  | { readonly type: "new_workspace"; readonly label?: string; readonly tabLabel?: string }

/**
 * Moves `pane` to `destination` — an existing tab's split, a brand-new
 * tab, or a brand-new workspace. Returns the moved pane's fresh identity
 * (its `tabId`/`workspaceId` may have changed); herdr's reply also
 * carries `changed`/`reason`/layout geometry, discarded here. Dual-shaped:
 * data-first (`movePane(pane, destination, options?)`) and data-last
 * (`pane.pipe(movePane(destination, options?))`).
 *
 * **Example** (moving a pane into a new tab)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, movePane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const moved = yield* movePane(pane.value, { type: "new_tab" })
 *   yield* Effect.log(moved.tabId)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const movePane: {
  (
    pane: Pane,
    destination: PaneMoveDestination,
    options?: { readonly focus?: boolean },
  ): Effect.Effect<Pane, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    destination: PaneMoveDestination,
    options?: { readonly focus?: boolean },
  ): (pane: Pane) => Effect.Effect<Pane, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPane(args[0]),
  (pane: Pane, destination: PaneMoveDestination, options?: { readonly focus?: boolean }) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const wireDestination = destination.type === "tab"
        ? {
          type: "tab" as const,
          tab_id: destination.tabId,
          split: destination.split,
          target_pane_id: destination.targetPaneId,
          ratio: destination.ratio,
        }
        : destination.type === "new_tab"
        ? { type: "new_tab" as const, workspace_id: destination.workspaceId, label: destination.label }
        : { type: "new_workspace" as const, label: destination.label, tab_label: destination.tabLabel }
      const result = yield* session.rpc["pane.move"]({
        pane_id: pane.id,
        destination: wireDestination,
        focus: options?.focus,
      })
      const moved = result.move_result.pane
      return makePane({
        id: moved.pane_id as PaneId,
        tabId: moved.tab_id as Pane["tabId"],
        workspaceId: moved.workspace_id as Pane["workspaceId"],
      })
    }),
)

/**
 * Swaps two panes' positions within a tab's layout. Only the explicit
 * `source`/`target` pair form is exposed — herdr's wire also accepts a
 * `pane_id`/`direction` targeting mode (swap with whichever neighbor lies
 * that way), dropped here as an ambiguous second way to say the same
 * thing; compose with `paneNeighbor` if direction-based swapping is
 * needed. Discards the reply. Dual-shaped: data-first
 * (`swapPane(source, target)`) and data-last
 * (`source.pipe(swapPane(target))`).
 *
 * **Example** (swapping two panes)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, splitPane, swapPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const sibling = yield* splitPane(pane.value)
 *   yield* swapPane(pane.value, sibling)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const swapPane: {
  (source: Pane, target: Pane): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (target: Pane): (source: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  2,
  (source: Pane, target: Pane) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["pane.swap"]({ source_pane_id: source.id, target_pane_id: target.id })
    }),
)

/**
 * Options for `resizePane`. `amount` is the fraction of the split to
 * shift by; herdr defaults it server-side if omitted.
 *
 * @category models
 * @since 0.1.0
 */
export interface ResizeOptions {
  readonly amount?: number
}

/**
 * Resizes `pane`'s split in `direction` by `options.amount`. Discards the
 * reply. Dual-shaped: data-first (`resizePane(pane, direction, options?)`)
 * and data-last (`pane.pipe(resizePane(direction, options?))`).
 *
 * **Example** (widening a pane)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, resizePane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* resizePane(pane.value, "right", { amount: 0.1 })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const resizePane: {
  (
    pane: Pane,
    direction: "left" | "right" | "up" | "down",
    options?: ResizeOptions,
  ): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    direction: "left" | "right" | "up" | "down",
    options?: ResizeOptions,
  ): (pane: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPane(args[0]),
  (pane: Pane, direction: "left" | "right" | "up" | "down", options?: ResizeOptions) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["pane.resize"]({ pane_id: pane.id, direction, amount: options?.amount })
    }),
)

/**
 * Toggles or sets `pane`'s zoom (full-tab) state. `mode` defaults to
 * `"toggle"` server-side if omitted. Discards the reply. Dual-shaped:
 * data-first (`zoomPane(pane, mode?)`) and data-last
 * (`pane.pipe(zoomPane(mode?))`).
 *
 * **Example** (zooming a pane)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, zoomPane } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* zoomPane(pane.value, "on")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const zoomPane: {
  (pane: Pane, mode?: "toggle" | "on" | "off"): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    mode?: "toggle" | "on" | "off",
  ): (pane: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPane(args[0]),
  (pane: Pane, mode?: "toggle" | "on" | "off") =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["pane.zoom"]({ pane_id: pane.id, mode })
    }),
)

/**
 * Focuses whichever pane lies `direction` of `pane` within its tab.
 * Discards the reply. Dual-shaped: data-first
 * (`focusPaneDirection(pane, direction)`) and data-last
 * (`pane.pipe(focusPaneDirection(direction))`).
 *
 * **Example** (focusing the pane above)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, focusPaneDirection } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* focusPaneDirection(pane.value, "up")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const focusPaneDirection: {
  (
    pane: Pane,
    direction: "left" | "right" | "up" | "down",
  ): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    direction: "left" | "right" | "up" | "down",
  ): (pane: Pane) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPane(args[0]),
  (pane: Pane, direction: "left" | "right" | "up" | "down") =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["pane.focus_direction"]({ pane_id: pane.id, direction })
    }),
)

/**
 * Finds whichever pane lies `direction` of `pane`, without focusing it.
 * `Option.none()` if there is no neighbor that way. Dual-shaped:
 * data-first (`paneNeighbor(pane, direction)`) and data-last
 * (`pane.pipe(paneNeighbor(direction))`).
 *
 * **Example** (finding the pane to the right)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, paneNeighbor } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const neighbor = yield* paneNeighbor(pane.value, "right")
 *   yield* Effect.log(neighbor)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const paneNeighbor: {
  (
    pane: Pane,
    direction: "left" | "right" | "up" | "down",
  ): Effect.Effect<Option.Option<PaneId>, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    direction: "left" | "right" | "up" | "down",
  ): (pane: Pane) => Effect.Effect<Option.Option<PaneId>, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isPane(args[0]),
  (pane: Pane, direction: "left" | "right" | "up" | "down") =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const result = yield* session.rpc["pane.neighbor"]({ pane_id: pane.id, direction })
      // `neighbor_pane_id` is schema-OPTIONAL, so herdr may omit the key
      // entirely — which decodes to `undefined`, and `Option.fromNullOr` maps
      // only `null` to `None`, turning "no neighbor" into `Some(undefined)`.
      // Check both absences explicitly.
      const neighborId = result.neighbor.neighbor_pane_id
      return neighborId === null || neighborId === undefined
        ? Option.none<PaneId>()
        : Option.some(neighborId as PaneId)
    }),
)

/**
 * Reports which of `pane`'s four sides has a neighboring pane within its
 * tab. Single-arg read, not dual-shaped — no relation to compose against.
 *
 * **Example** (checking edges)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, paneEdges } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const edges = yield* paneEdges(pane.value)
 *   yield* Effect.log(edges)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const paneEdges = (
  pane: Pane,
): Effect.Effect<PaneEdges, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["pane.edges"]({ pane_id: pane.id })
    return {
      left: result.edges.left,
      right: result.edges.right,
      up: result.edges.up,
      down: result.edges.down,
    }
  })

/**
 * Reads `pane`'s current tab-wide geometry — every pane's rect, every
 * split divider, and zoom state. Single-arg read, not dual-shaped.
 *
 * **Example** (reading layout)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, paneLayout } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const layout = yield* paneLayout(pane.value)
 *   yield* Effect.log(layout.panes.length)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const paneLayout = (
  pane: Pane,
): Effect.Effect<PaneLayoutSnapshot, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["pane.layout"]({ pane_id: pane.id })
    return decodePaneLayoutSnapshot(result.layout)
  })

const decodePaneProcessInfoProcess = (wire: PaneProcessInfoProcessWire): PaneProcessInfoProcess => ({
  pid: wire.pid,
  name: wire.name,
  argv: wire.argv ?? undefined,
  argv0: wire.argv0 ?? undefined,
  cmdline: wire.cmdline ?? undefined,
  cwd: wire.cwd ?? undefined,
})

/**
 * Reads `pane`'s shell/process state — shell PID, tty path, and the
 * foreground process group herdr found in the pty. Single-arg read, not
 * dual-shaped. A heavier, opt-in read compared to `snapshotPane` — not
 * folded into `PaneSnapshot`.
 *
 * **Example** (reading process info)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, paneProcessInfo } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const info = yield* paneProcessInfo(pane.value)
 *   yield* Effect.log(info.shellPid)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const paneProcessInfo = (
  pane: Pane,
): Effect.Effect<PaneProcessInfo, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["pane.process_info"]({ pane_id: pane.id })
    const info = result.process_info
    return {
      paneId: info.pane_id as PaneId,
      shellPid: info.shell_pid ?? undefined,
      tty: info.tty ?? undefined,
      foregroundProcessGroupId: info.foreground_process_group_id ?? undefined,
      foregroundProcesses: info.foreground_processes.map(decodePaneProcessInfoProcess),
    }
  })
