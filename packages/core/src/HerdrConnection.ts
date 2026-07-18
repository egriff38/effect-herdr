/**
 * The connection primitive (D3).
 *
 * Three tiers exposed:
 *   - `HerdrConnection.make(opts)`  — scoped Effect. The advanced form.
 *   - `HerdrConnection.layer(opts)` — bring-your-own-config Layer.
 *   - `HerdrConnection.Live`        — sound-defaults Layer, resolves via config.
 *   - `HerdrConnection.byName`      — LayerMap<sessionName, ...> for multi-session callers (@180).
 *
 * The connection hard-codes to `HerdrRpcs` (@143). v2 will add a `serve`
 * method for `RpcServer<PluginRpcs>` running over the same connection.
 */

import type { Effect, Layer, LayerMap, Scope, Stream } from "effect"
import type { HerdrConnectError } from "./protocol/errors.js"
import type { HerdrRpcs } from "./protocol/HerdrRpcs.js"

// Runtime type stand-in for RpcClient<HerdrRpcs> until real Rpc types land.
type HerdrRpcClient = unknown /* RpcClient.RpcClient<typeof HerdrRpcs> */

/**
 * Small service surface (@211-a). Callers who want ergonomic operations
 * import from `operations.ts`; this service exposes primitives only.
 */
export declare class HerdrConnection /* extends Context.Service<HerdrConnection, {
  readonly rpc: HerdrRpcClient
  readonly disconnects: Stream.Stream<HerdrConnectError, never>
}>()("effect-herdr/HerdrConnection") {} */ {
  readonly _tag: "HerdrConnection"
}

/**
 * Scoped constructor. Advanced callers (case B — E2E harness) bracket
 * lifetime themselves. Fails at acquire time if the socket file is
 * missing or refuses connection.
 */
export declare const make: (
  options: { readonly socketPath: string },
) => Effect.Effect<
  { readonly rpc: HerdrRpcClient; readonly disconnects: Stream.Stream<HerdrConnectError, never> },
  HerdrConnectError,
  Scope.Scope
>

/**
 * Bring-your-own-config Layer. `Layer.scoped` internally.
 */
export declare const layer: (
  options: { readonly socketPath: string },
) => Layer.Layer<HerdrConnection, HerdrConnectError>

/**
 * Sound-defaults Layer (D3). Reads `HerdrSocketPathConfig` (@187), falls
 * back through env → default socket path.
 *
 * Implementation-shape reminder: this is `Layer.unwrap(Effect.map(resolve, layer))`.
 */
export declare const Live: Layer.Layer<HerdrConnection, HerdrConnectError>

/**
 * LayerMap for talking to multiple named sessions in one program (@180).
 * Each key gets its own cached connection with idle-TTL; entries close
 * when unused past the TTL. Advanced usage only — case C's default is one
 * session, one connection.
 */
export declare const byName: Effect.Effect<
  LayerMap.LayerMap<string /* session name */, HerdrConnection, HerdrConnectError>,
  never,
  Scope.Scope
>
