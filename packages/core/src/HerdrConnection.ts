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

import { Context, Effect, Layer, Scope } from "effect"
import { RpcClient, RpcClientError, RpcGroup } from "effect/unstable/rpc"
import { HerdrSocketPathConfig, socketFileExists } from "./config.js"
import { makeHerdrProtocol } from "./HerdrWireProtocol.js"
import { ConnectionRefused, SocketFileMissing, TransportOpenFailed } from "./protocol/errors.js"
import { HerdrRpcs } from "./protocol/HerdrRpcs.js"

export interface HerdrConnectionShape {
  readonly rpc: RpcClient.RpcClient<RpcGroup.Rpcs<typeof HerdrRpcs>, RpcClientError.RpcClientError>
}

/**
 * `Context.Service` tag. Deliberately minimal — just the typed client.
 * `disconnects` (connection-scoped events) is a slice-9 addition (issue #10);
 * it does not exist as a placeholder field here because a field that is
 * always `Stream.empty` would misrepresent a real capability as already
 * implemented. Slice 9 adds it as new surface, not a filled-in stub.
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
 */
export const make = (
  options: { readonly socketPath: string },
): Effect.Effect<HerdrConnectionShape, SocketFileMissing | ConnectionRefused | TransportOpenFailed, Scope.Scope> =>
  Effect.gen(function*() {
    const { socketPath } = options

    if (!socketFileExists(socketPath)) {
      return yield* new SocketFileMissing({ socketPath })
    }

    const protocol = yield* makeHerdrProtocol(socketPath)
    const rpc = yield* RpcClient.make(HerdrRpcs).pipe(
      Effect.provideService(RpcClient.Protocol, protocol),
    )

    yield* verifyLive(rpc, socketPath)

    return { rpc }
  })

/**
 * Bring-your-own-config Layer form. Any `Scope` requirement from `make` is
 * absorbed into the layer's own scope by `Layer.effect`.
 */
export const layer = (
  options: { readonly socketPath: string },
): Layer.Layer<HerdrConnection, SocketFileMissing | ConnectionRefused | TransportOpenFailed> =>
  Layer.effect(HerdrConnection, make(options))

/**
 * Sound-defaults Layer (D3). Reads `HerdrSocketPathConfig` — env
 * `HERDR_SOCKET_PATH` then `~/.config/herdr/herdr.sock`. Fails at
 * Layer-build time if the resolved path has no live server.
 */
export const Live: Layer.Layer<HerdrConnection, SocketFileMissing | ConnectionRefused | TransportOpenFailed> = Layer
  .unwrap(
    Effect.gen(function*() {
      const socketPath = yield* HerdrSocketPathConfig
      return layer({ socketPath })
    }),
  )
