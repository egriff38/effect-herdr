/**
 * effect-herdr — typed Effect-TS SDK for the herdr terminal multiplexer.
 *
 * Pseudo-code sketch of the v1 API surface. Every method body is `Effect.die`
 * or a `TODO` stub. Nothing here is implemented — the purpose is to nail down
 * the *shape* of the public surface so hunk-review comments can pin it down
 * before real code touches it.
 *
 * Naming/layout conventions are documented in `docs/design.md` (D1, D2, D3)
 * and `CONTEXT.md` (Session/Server/Connection split, C/B/A consumer cases).
 *
 * Structure:
 *   1. Value objects   — Pane, Tab, Workspace (opaque ids + resolved metadata)
 *   2. Errors          — the shape connection/protocol/transport failures take
 *   3. HerdrRpcs       — the typed RpcGroup (Layer 1, protocol). One entry per
 *                        real socket method, sketched not exhaustive.
 *   4. HerdrConnection — the Context.Service that hands out RpcClients over one
 *                        long-lived socket, plus its `make` scoped constructor,
 *                        Layer variants, and sound-defaults `Live`.
 *   5. HerdrSession    — the Context.Service ergonomic layer (Layer 2), plus
 *                        its Layer variants and sound-defaults `Live`.
 *   6. currentPane etc — the D1 env-introspection accessors, exposed as
 *                        top-level effects that yield the service.
 */

import type { Effect, Layer, Option, Scope, Stream } from "effect"
// Real imports from effect-smol will be:
//   import { Context, Effect, Layer, Option, Scope, Stream, Data } from "effect"
//   import { Rpc, RpcClient, RpcGroup, RpcSchema } from "effect/unstable/rpc"
//   import * as Socket from "effect/unstable/socket/Socket"
//   import * as Schema from "effect/Schema"
// but keeping this file dependency-light so the sketch stays a sketch.

// =============================================================================
// 1. Value objects
// =============================================================================

/**
 * Opaque, branded id types. Public ids in herdr are strings like "w1:p2" — but
 * they can compact after a pane/tab close, so treat them as identity handles,
 * not persistent keys.
 */
export type WorkspaceId = string & { readonly _brand: "WorkspaceId" }
export type TabId = string & { readonly _brand: "TabId" }
export type PaneId = string & { readonly _brand: "PaneId" }

/**
 * Resolved Pane. Fields intentionally sparse in this sketch — the full shape
 * gets driven by `scripts/herdr-schema.json` when we curate which fields are
 * user-facing (deferred grilling item).
 */
export interface Pane {
  readonly id: PaneId
  readonly tabId: TabId
  readonly workspaceId: WorkspaceId
  readonly cwd: string
  readonly agent: Option.Option<string> // e.g. "claude", "codex", "omp"
  readonly agentStatus: "idle" | "working" | "blocked" | "done" | "unknown"
}

export interface Tab {
  readonly id: TabId
  readonly workspaceId: WorkspaceId
  readonly label: string
}

export interface Workspace {
  readonly id: WorkspaceId
  readonly label: string
  readonly cwd: string
}

// =============================================================================
// 2. Errors
// =============================================================================

/**
 * Layer-build-time failure — the socket file isn't there or won't accept a
 * connection. Distinct from `HerdrProtocolError` because the caller's
 * remediation is different: bring up a server vs. debug an in-flight call.
 */
export declare class HerdrConnectError extends /* Data.TaggedError */ Error {
  readonly _tag: "HerdrConnectError"
  readonly kind: "socket_file_missing" | "connection_refused" | "transport_open_failed"
  readonly socketPath: string
}

/**
 * Application-layer failure surfaced by herdr in response to a well-formed
 * call. Mapped from herdr's `ErrorBody.code`; exact variant list is a
 * deferred grilling item.
 */
export declare class HerdrProtocolError extends /* Data.TaggedError */ Error {
  readonly _tag: "HerdrProtocolError"
  readonly code: string // e.g. "pane_not_found", "workspace_not_found"
  readonly message: string
}

// Transport-level errors (SocketError, RpcClientError) flow through Effect's
// typed error channel from the raw client — the SDK does not wrap them. If a
// caller sees `SocketReadError` on an in-flight call, that's exactly what
// happened and the callsite can pattern-match on it.

// =============================================================================
// 3. HerdrRpcs — the protocol layer (Layer 1)
// =============================================================================

/**
 * The full typed protocol contract. Sketch — the real one enumerates all 85
 * methods from `scripts/herdr-schema.json`; that curation is a deferred
 * grilling item. Shown here: one of each of the four RPC shapes so the
 * sketch demonstrates the range.
 *
 *   - request/reply:      pane.get, pane.list, workspace.list
 *   - streaming:          events.subscribe, pane.wait_for_output
 *   - fire-and-forget:    pane.send_text, pane.send_keys (called with { discard: true })
 *   - connection-scoped:  ping/pong, disconnects (out-of-band, not per-request)
 */
export declare const HerdrRpcs: unknown /* RpcGroup.RpcGroup<
  | Rpc.Rpc<"pane.get", PaneIdPayload, PaneSchema, HerdrProtocolError>
  | Rpc.Rpc<"pane.list", WorkspaceIdPayload, Schema.Array<PaneSchema>, HerdrProtocolError>
  | Rpc.Rpc<"pane.split", PaneSplitPayload, PaneSchema, HerdrProtocolError>
  | Rpc.Rpc<"pane.send_text", PaneSendTextPayload, Schema.Void, HerdrProtocolError>
  | Rpc.Rpc<"pane.wait_for_output", WaitPayload, RpcSchema.Stream<OutputChunk, WaitError>, HerdrProtocolError>
  | Rpc.Rpc<"events.subscribe", EventsSubscribePayload, RpcSchema.Stream<HerdrEvent, never>, HerdrProtocolError>
  | Rpc.Rpc<"workspace.list", Schema.Void, Schema.Array<WorkspaceSchema>, HerdrProtocolError>
  // ... 78 more ...
> */

// =============================================================================
// 4. HerdrConnection — the connection primitive
// =============================================================================

export interface HerdrConnectionShape {
  /**
   * Hand out a typed RpcClient for a given RpcGroup, multiplexed over the
   * shared underlying socket. Scoped: the returned client lives only for the
   * duration of the caller's scope, which in typical usage is the same as
   * the connection's scope.
   *
   * v1 has exactly one group (`HerdrRpcs`); v2 adds `PluginRpcs`.
   */
  readonly client: <G>(group: G) => Effect.Effect<
    unknown /* RpcClient<G> */,
    never,
    Scope.Scope
  >

  /**
   * Connection-scoped events. Not correlated to any request id. Firing here
   * means "the connection died / a protocol-level defect happened" — an
   * in-flight `session.splitPane(pane)` will get its own SocketError, not
   * this stream.
   */
  readonly disconnects: Stream.Stream<HerdrConnectError, never>
}

export declare const HerdrConnection: {
  /** Context.Service tag. */
  readonly Service: unknown /* Context.Tag<HerdrConnection, HerdrConnectionShape> */

  /**
   * Scoped constructor. The advanced form. Case B (the E2E harness) uses
   * this directly inside its own `Effect.scoped` block.
   */
  readonly make: (options: {
    readonly socketPath: string
  }) => Effect.Effect<HerdrConnectionShape, HerdrConnectError, Scope.Scope>

  /**
   * Bring-your-own-config Layer form. `Layer.scoped` internally.
   */
  readonly layer: (options: {
    readonly socketPath: string
  }) => Layer.Layer<never /* HerdrConnection */, HerdrConnectError>

  // TODO(hunk): should this live here (`HerdrConnection.layerNamed`) or on
  // HerdrConnectionLive as a variant (`HerdrConnectionLive.named`)? The
  // design doc says the latter, but it's more discoverable here. Preference?
  readonly layerNamed: (sessionName: string) => Layer.Layer<
    never /* HerdrConnection */,
    HerdrConnectError | /* SessionNotFoundError */ Error
  >
}

/**
 * Sound-defaults Layer. Two-tier resolution per D3:
 *
 *   1. `HERDR_SOCKET_PATH` from env if set (case C — you're inside herdr).
 *   2. Else `~/.config/herdr/herdr.sock` (the default session, matching bare `herdr`).
 *
 * Fails at Layer-build time with `HerdrConnectError` if the resolved path
 * has no live server.
 */
export declare const HerdrConnectionLive: Layer.Layer<
  never /* HerdrConnection */,
  HerdrConnectError
>

// =============================================================================
// 5. HerdrSession — the ergonomic service layer (Layer 2)
// =============================================================================

export interface HerdrSessionShape {
  // --- environment introspection (D1) ---
  //
  // Note: `currentPane` etc. are ALSO exposed as top-level effects (section 6)
  // for callsites that don't want to `yield* HerdrSession` first. They're the
  // same effect, just accessed two ways.

  readonly currentPane: Effect.Effect<Option.Option<Pane>, HerdrProtocolError>
  readonly currentTab: Effect.Effect<Option.Option<Tab>, HerdrProtocolError>
  readonly currentWorkspace: Effect.Effect<Option.Option<Workspace>, HerdrProtocolError>

  // --- pane operations ---

  readonly listPanes: (workspace: Workspace) => Effect.Effect<ReadonlyArray<Pane>, HerdrProtocolError>

  readonly splitPane: (
    pane: Pane,
    options?: {
      readonly direction?: "right" | "down"
      readonly focus?: boolean
    },
  ) => Effect.Effect<Pane, HerdrProtocolError>

  /**
   * Types text (+ Enter) into a pane's live shell. Fire-and-forget by
   * convention — the underlying `pane.send_text` RPC is called with
   * `{ discard: true }`. The pane's shell will still print its response
   * back into the merged stream, which callers can observe via
   * `waitForOutput` or a future `readOutput` stream.
   *
   * See vault note "Effect-Herdr Plugin SDK - Typed Full-Duplex Proposal.md"
   * §3 for why this doesn't pretend to be `ChildProcessSpawner`.
   */
  readonly runInPane: (pane: Pane, text: string) => Effect.Effect<void, HerdrProtocolError>

  /**
   * Streams matched output chunks from a pane. Real streaming RPC —
   * `pane.wait_for_output` on herdr's side, `RpcSchema.Stream` on ours.
   */
  readonly waitForOutput: (
    pane: Pane,
    match: string,
    options?: {
      readonly regex?: boolean
      readonly timeout?: unknown /* Duration.DurationInput */
    },
  ) => Stream.Stream<
    /* OutputChunk */ string,
    HerdrProtocolError | /* WaitOutputError */ Error
  >

  // --- workspace / tab shape TBD from grilling ---

  // TODO(hunk): should there be a `workspaces: Effect<ReadonlyArray<Workspace>>`
  // top-level accessor here, or is it only reachable via the raw client?
  // Trying to hold the line on "the service exposes what an in-pane agent
  // actually needs, not the whole 85-method surface."
}

export declare const HerdrSession: {
  readonly Service: unknown /* Context.Tag<HerdrSession, HerdrSessionShape> */
}

/**
 * Bring-your-own-connection Layer form. Compose with `HerdrConnection.layer`
 * or a test double `Layer.succeed(HerdrConnection, fakeConn)`.
 */
export declare const HerdrSessionLayer: Layer.Layer<
  never /* HerdrSession */,
  never,
  never /* HerdrConnection */
>

/**
 * Sound-defaults ergonomic Layer. Bundles `HerdrConnectionLive`, so a
 * caller who just wants "give me herdr" writes exactly:
 *
 *   Effect.provide(program, HerdrSessionLive)
 *
 * and nothing else. This is the intended primary entrypoint for case C.
 */
export declare const HerdrSessionLive: Layer.Layer<
  never /* HerdrSession */,
  HerdrConnectError
>

// =============================================================================
// 6. Top-level ergonomic accessors (D1)
// =============================================================================

/**
 * These are re-exports of the same effects that live on `HerdrSession` — a
 * caller can either `yield* currentPane` directly, or `yield* HerdrSession`
 * and call `session.currentPane` on the service. Same effect, two access
 * paths; nothing hidden.
 */
export declare const currentPane: Effect.Effect<
  Option.Option<Pane>,
  HerdrProtocolError,
  unknown /* HerdrSession */
>

export declare const currentTab: Effect.Effect<
  Option.Option<Tab>,
  HerdrProtocolError,
  unknown /* HerdrSession */
>

export declare const currentWorkspace: Effect.Effect<
  Option.Option<Workspace>,
  HerdrProtocolError,
  unknown /* HerdrSession */
>

// =============================================================================
// Reference call-site — the shape the whole design is optimized for
// =============================================================================

// (Comment-only. Kept here so hunk reviewers see the target ergonomics next
// to the types that make them possible.)
//
//   import { currentPane, HerdrSessionLive, runInPane } from "effect-herdr"
//   import { Effect, Option } from "effect"
//
//   const program = Effect.gen(function* () {
//     const pane = yield* currentPane
//     if (Option.isNone(pane)) {
//       return yield* Effect.log("not in herdr")
//     }
//     yield* runInPane(pane.value, "echo hello from effect-herdr")
//   })
//
//   program.pipe(Effect.provide(HerdrSessionLive), Effect.runPromise)
