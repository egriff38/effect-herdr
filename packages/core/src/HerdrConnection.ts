/**
 * The connection primitive (D3, corrected per D4 — see docs/design.md).
 *
 * Three tiers exposed:
 *   - `make(opts)`  — scoped Effect. The advanced form (case B — e.g. the
 *                     E2E harness — brackets lifetime explicitly).
 *   - `layer(opts)` — bring-your-own-config Layer.
 *   - `Live`        — sound-defaults Layer, resolves via `HerdrSocketPathConfig`.
 *
 * Hard-coded to `HerdrRpcs` (@143) — not generic. v2 will add a `serve`
 * method for `RpcServer<PluginRpcs>` running over the same connection
 * primitive; that is additive, not a rewrite of this file.
 *
 * D4 correction: herdr's socket closes after exactly one request/reply for
 * ordinary methods (verified empirically — see HerdrWireProtocol.ts's header
 * comment for the full account). `make`/`layer`/`Live` no longer hold open a
 * single persistent socket for the connection's lifetime; each RPC call
 * dials its own fresh connection internally (see `makeHerdrProtocol`).
 * `rpc` still reads as one long-lived client from the caller's perspective —
 * the reconnect-per-call cost is hidden behind this module, not exposed.
 */

import { Context, Effect, Exit, Layer, Scope } from "effect"
import type { FileSystem } from "effect/FileSystem"
import { RpcClient, RpcClientError, RpcGroup } from "effect/unstable/rpc"
import type * as Stream from "effect/Stream"
import { HerdrSocketPathConfig, socketFileExists } from "./config.js"
import * as HerdrEventsSocket from "./HerdrEventsSocket.js"
import type { HerdrEventPush, HerdrSubscribeAckError, HerdrSubscribePushError } from "./HerdrEventsSocket.js"
import { makeHerdrProtocol } from "./HerdrWireProtocol.js"
import { ConnectionRefused, SocketFileMissing, TransportOpenFailed } from "./protocol/errors.js"
import { HerdrRpcs } from "./protocol/HerdrRpcs.js"

export interface HerdrConnectionShape {
  readonly rpc: RpcClient.RpcClient<RpcGroup.Rpcs<typeof HerdrRpcs>, RpcClientError.RpcClientError>
  /**
   * Subscribe to herdr's `events.subscribe` push stream, filtered
   * server-side to `types` (dotted form, e.g. `"pane.focused"`). Scoped:
   * the underlying persistent socket (`HerdrEventsSocket.subscribe`) stays
   * open, and the returned Stream keeps emitting, for as long as the
   * calling `Scope` does.
   *
   * Deliberately NOT a connection-wide `disconnects` signal (that design
   * was dropped — see issue #10's revision history) and not memoized per
   * `HerdrConnection` — every call opens its OWN independent subscribe
   * connection, matching herdr's per-subscription wire model (verified
   * live: one `events.subscribe` request per connection, not a
   * multiplexed fan-out of one shared subscription).
   */
  readonly subscribeEvents: (
    types: ReadonlyArray<string>,
  ) => Effect.Effect<Stream.Stream<HerdrEventPush, HerdrSubscribePushError>, HerdrSubscribeAckError, Scope.Scope>
}

/**
 * `Context.Service` tag. Two capabilities: the typed `rpc` client (D4 —
 * per-call dial, transparent to callers) and `subscribeEvents` (issue #10/
 * slice 9 — herdr's one persistent-connection exception, `events.subscribe`).
 *
 * No default implementation — a program that never provides `make`/`layer`/
 * `Live` fails at runtime with a "service not found" defect, which is the
 * correct behavior for a resource this load-bearing.
 */
export class HerdrConnection extends Context.Service<HerdrConnection, HerdrConnectionShape>()(
  "effect-herdr/HerdrConnection",
) {}

/**
 * Verify the connection actually works by round-tripping `ping`. herdr's
 * socket has no handshake beyond TCP/unix-domain connect, so the only
 * reliable "is this a live herdr server" check is a real RPC call.
 */
const verifyLive = (
  rpc: HerdrConnectionShape["rpc"],
  socketPath: string,
): Effect.Effect<void, ConnectionRefused | TransportOpenFailed> => {
  const pinged = Effect.asVoid(rpc.ping())
  return Effect.mapError(pinged, (error) => {
    if ("reason" in error && error.reason._tag === "SocketOpenError") {
      return new ConnectionRefused({ socketPath, cause: error.reason })
    }
    return new TransportOpenFailed({ socketPath, cause: error })
  })
}

/**
 * Scoped constructor. Advanced callers (case B — E2E harness) bracket
 * lifetime themselves. Fails at acquire time — checks the socket file
 * exists, builds the per-call-dial protocol, and round-trips `ping` to
 * prove liveness — before returning, per D3's "fail loud at Layer-build
 * time" requirement. No upfront persistent socket is opened (D4): each RPC
 * call, including this `ping`, dials its own connection internally.
 *
 * `subscribeEvents` (issue #10/slice 9) closes over this call's own
 * `Scope.Scope` (captured once via `Effect.scope`, below) to satisfy the
 * "connection-scope teardown" requirement: every `subscribeEvents` call
 * forks a fresh CHILD scope of the connection's own scope for its
 * persistent socket + read loop (`Scope.fork` — closing the connection's
 * scope closes every such child automatically, per `Scope.fork`'s own
 * parent/child finalizer wiring), and additionally registers the
 * INDIVIDUAL caller's scope (via `Effect.scope` inside `subscribeEvents`
 * itself — the `Scope.Scope` its own signature requires) to close that
 * same child scope too. So either the connection's scope or the specific
 * caller's scope closing tears the subscription down — whichever comes
 * first.
 */
export const make = (
  options: { readonly socketPath: string },
): Effect.Effect<
  HerdrConnectionShape,
  SocketFileMissing | ConnectionRefused | TransportOpenFailed,
  Scope.Scope | FileSystem
> =>
  Effect.gen(function*() {
    const { socketPath } = options

    const exists = yield* socketFileExists(socketPath).pipe(
      Effect.mapError((cause) => new TransportOpenFailed({ socketPath, cause })),
    )
    if (!exists) {
      return yield* new SocketFileMissing({ socketPath })
    }

    const protocol = yield* makeHerdrProtocol(socketPath)
    const rpc = yield* RpcClient.make(HerdrRpcs).pipe(
      Effect.provideService(RpcClient.Protocol, protocol),
    )

    yield* verifyLive(rpc, socketPath)

    const connectionScope = yield* Effect.scope

    const subscribeEvents: HerdrConnectionShape["subscribeEvents"] = (types) =>
      Effect.gen(function*() {
        const childScope = yield* Scope.fork(connectionScope)
        const callerScope = yield* Effect.scope
        yield* Scope.addFinalizer(callerScope, Scope.close(childScope, Exit.void))
        return yield* HerdrEventsSocket.subscribe(socketPath, types).pipe(Scope.provide(childScope))
      })

    return { rpc, subscribeEvents }
  })

/**
 * Bring-your-own-config Layer form. Any `Scope` requirement from `make` is
 * absorbed into the layer's own scope by `Layer.effect`.
 */
export const layer = (
  options: { readonly socketPath: string },
): Layer.Layer<HerdrConnection, SocketFileMissing | ConnectionRefused | TransportOpenFailed, FileSystem> =>
  Layer.effect(HerdrConnection, make(options))

/**
 * Sound-defaults Layer (D3). Reads `HerdrSocketPathConfig` — env
 * `HERDR_SOCKET_PATH` then `~/.config/herdr/herdr.sock`. Fails at
 * Layer-build time if the resolved path has no live server.
 */
export const Live: Layer.Layer<HerdrConnection, SocketFileMissing | ConnectionRefused | TransportOpenFailed, FileSystem> = Layer
  .unwrap(
    Effect.gen(function*() {
      const socketPath = yield* HerdrSocketPathConfig
      return layer({ socketPath })
    }),
  )
