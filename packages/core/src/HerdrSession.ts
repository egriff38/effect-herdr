/**
 * The ergonomic service layer for interacting with a herdr session.
 *
 * Deliberately small: `rpc` (the typed client, from `HerdrConnection`) and
 * `currentIds` (the workspace/tab/pane trio herdr injects into a pane's
 * environment, resolved once at layer-build). Domain verbs — `currentPane`,
 * `runInPane`, `waitForOutput`, etc. — live in `operations/` as combinators
 * over this service, not as methods on it.
 *
 * @since 0.1.0
 */

import { Context, Effect, Layer, Option } from "effect"
import type { FileSystem } from "effect/FileSystem"
import { HerdrConnection, Live as HerdrConnectionLive } from "./HerdrConnection.js"
import type { HerdrConnectionShape } from "./HerdrConnection.js"
import type { HerdrConnectError } from "./protocol/errors.js"
import type { PaneId, TabId, WorkspaceId } from "./protocol/schemas.js"

/**
 * The workspace/tab/pane trio herdr injects into a pane's environment
 * (`HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`).
 *
 * @category models
 * @since 0.1.0
 */
export interface CurrentIds {
  readonly workspaceId: WorkspaceId
  readonly tabId: TabId
  readonly paneId: PaneId
}

// Reads the env-injected trio once at layer-build; Option.none() if any of
// the three vars is missing (e.g. not running inside a herdr pane).
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

/**
 * The capabilities a `HerdrSession` provides: the typed `rpc` client and
 * the current pane's `workspaceId`/`tabId`/`paneId`, if running inside a
 * herdr pane.
 *
 * @category models
 * @since 0.1.0
 */
export interface HerdrSessionShape {
  readonly rpc: HerdrConnectionShape["rpc"]
  readonly currentIds: Option.Option<CurrentIds>
}

/**
 * `Context.Service` tag for the ergonomic session layer. Provide `layer`
 * or `Live` to satisfy it.
 *
 * **Example** (reading the current pane id)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const session = yield* HerdrSession
 *   if (Option.isSome(session.currentIds)) {
 *     yield* Effect.log(session.currentIds.value.paneId)
 *   }
 * })
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export class HerdrSession extends Context.Service<HerdrSession, HerdrSessionShape>()(
  "effect-herdr/HerdrSession",
) {}

/**
 * Builds a `HerdrSession` `Layer` from an existing `HerdrConnection`.
 * Composable with a test double (`Layer.succeed(HerdrConnection, fakeConn)`)
 * or a real connection layer (`HerdrConnection.layer`/`.Live`).
 *
 * **Example** (layering on top of a connection)
 *
 * ```ts
 * import { Layer } from "effect"
 * import { HerdrConnection, HerdrSession } from "effect-herdr"
 *
 * const sessionLayer = HerdrSession.layer.pipe(
 *   Layer.provide(HerdrConnection.layer({ socketPath: "/tmp/herdr.sock" })),
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const layer: Layer.Layer<HerdrSession, never, HerdrConnection> = Layer.effect(
  HerdrSession,
  Effect.gen(function*() {
    const connection = yield* HerdrConnection
    return { rpc: connection.rpc, currentIds: resolveCurrentIds() }
  }),
)

/**
 * Sound-defaults `Layer` for `HerdrSession`. Bundles `HerdrConnection.Live`,
 * so it also requires `FileSystem`.
 *
 * **Example** (the primary entry point)
 *
 * ```ts
 * import { BunFileSystem } from "@effect/platform-bun"
 * import { Effect } from "effect"
 * import { HerdrSession, currentPane } from "effect-herdr"
 *
 * const program = currentPane.pipe(
 *   Effect.andThen((pane) => Effect.log(pane)),
 *   Effect.provide(HerdrSession.Live),
 *   Effect.provide(BunFileSystem.layer),
 * )
 *
 * Effect.runPromise(program)
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const Live: Layer.Layer<HerdrSession, HerdrConnectError, FileSystem> = Layer.provide(layer, HerdrConnectionLive)
