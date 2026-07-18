/**
 * The ergonomic service layer (@211-a).
 *
 * Deliberately small: `rpc` (typed client, from HerdrConnection) and
 * `currentIds` (env-injected trio, resolved once at layer-build). Every
 * domain verb lives in `operations.ts` as a top-level `dual`-shaped
 * combinator — nothing on the service itself carries logic. A test double
 * is `Layer.succeed(HerdrSession, { rpc: RpcTest.make(...), currentIds: Option.none() })`.
 */

import type { PaneId, TabId, WorkspaceId } from "./protocol/schemas.js"

export interface CurrentIds {
  readonly workspaceId: WorkspaceId
  readonly tabId: TabId
  readonly paneId: PaneId
}

export declare class HerdrSession /* extends Context.Service<HerdrSession, {
  readonly rpc: HerdrRpcClient
  readonly currentIds: Option.Option<CurrentIds>
}>()("effect-herdr/HerdrSession") {} */ {
  readonly _tag: "HerdrSession"
}

/**
 * Bring-your-own-connection Layer. Composes with a test double
 * `Layer.succeed(HerdrConnection, fakeConn)`, or with the real
 * `HerdrConnection.layer` / `.Live`.
 */
export declare const layer: unknown /* Layer.Layer<HerdrSession, never, HerdrConnection> */

/**
 * Sound-defaults Layer. Bundles `HerdrConnection.Live`. Primary case-C
 * entry point:
 *
 *   currentPane.pipe(
 *     Effect.andThen((p) => Effect.log(p.id)),
 *     Effect.provide(HerdrSession.Live),
 *     Effect.runPromise,
 *   )
 */
export declare const Live: unknown /* Layer.Layer<HerdrSession, HerdrConnectError> */
