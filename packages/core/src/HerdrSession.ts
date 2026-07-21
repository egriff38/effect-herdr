/**
 * The ergonomic service layer (@211-a).
 *
 * Deliberately small: `rpc` (typed client, from HerdrConnection) and
 * `currentIds` (env-injected trio, resolved once at layer-build). Every
 * domain verb lives in `operations/` as a top-level `dual`-shaped
 * combinator — nothing on the service itself carries logic. A test double
 * is `Layer.succeed(HerdrSession, { rpc: fakeRpc, currentIds: Option.none() })`.
 */

import { Context, Effect, Layer, Option } from "effect"
import type { FileSystem } from "effect/FileSystem"
import { HerdrConnection, Live as HerdrConnectionLive } from "./HerdrConnection.js"
import type { HerdrConnectionShape } from "./HerdrConnection.js"
import type { HerdrConnectError } from "./protocol/errors.js"
import type { PaneId, TabId, WorkspaceId } from "./protocol/schemas.js"

export interface CurrentIds {
  readonly workspaceId: WorkspaceId
  readonly tabId: TabId
  readonly paneId: PaneId
}

/**
 * Reads herdr's env-injected trio (D1). All three present → `Option.some`;
 * any missing → `Option.none()` — this is the SDK's only env-boundary read
 * outside `operations/current.ts`, done once at layer-build, not lazily
 * per access.
 */
const resolveCurrentIds = (): Option.Option<CurrentIds> => {
  const workspaceId = process.env["HERDR_WORKSPACE_ID"]
  const tabId = process.env["HERDR_TAB_ID"]
  const paneId = process.env["HERDR_PANE_ID"]

  if (workspaceId === undefined || tabId === undefined || paneId === undefined) {
    return Option.none()
  }

  return Option.some({
    workspaceId: workspaceId as WorkspaceId,
    tabId: tabId as TabId,
    paneId: paneId as PaneId,
  })
}

export interface HerdrSessionShape {
  readonly rpc: HerdrConnectionShape["rpc"]
  readonly currentIds: Option.Option<CurrentIds>
}

export class HerdrSession extends Context.Service<HerdrSession, HerdrSessionShape>()(
  "effect-herdr/HerdrSession",
) {}

/**
 * Bring-your-own-connection Layer. Composes with a test double
 * `Layer.succeed(HerdrConnection, fakeConn)`, or with the real
 * `HerdrConnection.layer` / `.Live`.
 */
export const layer: Layer.Layer<HerdrSession, never, HerdrConnection> = Layer.effect(
  HerdrSession,
  Effect.gen(function*() {
    const connection = yield* HerdrConnection
    return { rpc: connection.rpc, currentIds: resolveCurrentIds() }
  }),
)

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
export const Live: Layer.Layer<HerdrSession, HerdrConnectError, FileSystem> = Layer.provide(layer, HerdrConnectionLive)
