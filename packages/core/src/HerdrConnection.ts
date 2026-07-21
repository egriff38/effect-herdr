/**
 * A scoped connection to a running herdr server.
 *
 * Exposes a typed RPC client (`rpc`) and a way to subscribe to
 * server-pushed events (`subscribeEvents`). Three constructors are
 * provided: `make` (a scoped `Effect` for callers who manage lifetime
 * explicitly), `layer` (bring-your-own socket path), and `Live` (resolves
 * the socket path from `HerdrSocketPathConfig`). Every RPC call dials its
 * own fresh connection internally — `rpc` still reads as a single
 * long-lived client from the caller's perspective.
 *
 * @since 0.1.0
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

/**
 * The capabilities a `HerdrConnection` provides: a typed `rpc` client and
 * `subscribeEvents` for the server's event-push stream.
 *
 * @category models
 * @since 0.1.0
 */
export interface HerdrConnectionShape {
  readonly rpc: RpcClient.RpcClient<RpcGroup.Rpcs<typeof HerdrRpcs>, RpcClientError.RpcClientError>
  /**
   * Subscribes to herdr's `events.subscribe` push stream, filtered
   * server-side to `types` (dotted form, e.g. `"pane.focused"`). Each call
   * opens its own independent subscription connection. The returned
   * `Stream` keeps emitting until either the connection's own scope or
   * the caller-supplied `Scope` closes, whichever comes first.
   */
  readonly subscribeEvents: (
    types: ReadonlyArray<string>,
  ) => Effect.Effect<Stream.Stream<HerdrEventPush, HerdrSubscribePushError>, HerdrSubscribeAckError, Scope.Scope>
}

/**
 * `Context.Service` tag for the herdr connection. Provides `rpc` (a typed
 * client, dialed per call) and `subscribeEvents` (a persistent push-stream
 * subscription). No default implementation — provide `make`, `layer`, or
 * `Live`.
 *
 * **Example** (providing a connection)
 *
 * ```ts
 * import { BunFileSystem } from "@effect/platform-bun"
 * import { Effect } from "effect"
 * import { HerdrConnection } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const connection = yield* HerdrConnection
 *   yield* connection.rpc["workspace.list"]()
 * })
 *
 * program.pipe(
 *   Effect.provide(HerdrConnection.Live),
 *   Effect.provide(BunFileSystem.layer),
 *   Effect.runPromise,
 * )
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export class HerdrConnection extends Context.Service<HerdrConnection, HerdrConnectionShape>()(
  "effect-herdr/HerdrConnection",
) {}

// Round-trips `ping` since herdr's socket has no handshake beyond connect.
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
 * Scoped constructor for a herdr connection. Checks the socket file
 * exists, builds the RPC transport, and round-trips `ping` to confirm the
 * server is live — all before returning, so failures surface at
 * acquisition time rather than on first use.
 *
 * **Example** (explicit lifetime management)
 *
 * ```ts
 * import { BunFileSystem } from "@effect/platform-bun"
 * import { Effect } from "effect"
 * import { HerdrConnection } from "effect-herdr"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function*() {
 *     const connection = yield* HerdrConnection.make({ socketPath: "/tmp/herdr.sock" })
 *     yield* connection.rpc["workspace.list"]()
 *   }),
 * )
 *
 * program.pipe(Effect.provide(BunFileSystem.layer), Effect.runPromise)
 * ```
 *
 * @category constructors
 * @since 0.1.0
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
 * Builds a `Layer` for a `HerdrConnection` from an explicit socket path.
 *
 * **Example** (bring-your-own socket path)
 *
 * ```ts
 * import { BunFileSystem } from "@effect/platform-bun"
 * import { Layer } from "effect"
 * import { HerdrConnection } from "effect-herdr"
 *
 * const connectionLayer = HerdrConnection.layer({ socketPath: "/tmp/herdr.sock" }).pipe(
 *   Layer.provide(BunFileSystem.layer),
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const layer = (
  options: { readonly socketPath: string },
): Layer.Layer<HerdrConnection, SocketFileMissing | ConnectionRefused | TransportOpenFailed, FileSystem> =>
  Layer.effect(HerdrConnection, make(options))

/**
 * Sound-defaults `Layer` for a `HerdrConnection`. Resolves the socket path
 * from `HerdrSocketPathConfig` and fails at layer-build time if no live
 * server is found there.
 *
 * **Example** (connecting with defaults)
 *
 * ```ts
 * import { BunFileSystem } from "@effect/platform-bun"
 * import { Layer } from "effect"
 * import { HerdrConnection } from "effect-herdr"
 *
 * const runtime = HerdrConnection.Live.pipe(Layer.provide(BunFileSystem.layer))
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const Live: Layer.Layer<HerdrConnection, SocketFileMissing | ConnectionRefused | TransportOpenFailed, FileSystem> = Layer
  .unwrap(
    Effect.gen(function*() {
      const socketPath = yield* HerdrSocketPathConfig
      return layer({ socketPath })
    }),
  )
