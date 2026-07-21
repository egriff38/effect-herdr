/**
 * Translates between Effect's RPC wire envelope and herdr's actual socket
 * protocol.
 *
 * herdr's socket is not a persistent multiplexed connection for ordinary
 * request/reply methods: it closes the underlying connection immediately
 * after answering exactly one request. Only `events.subscribe` keeps its
 * connection open (handled separately, in `HerdrEventsSocket.ts`). This
 * module hides the reconnect-per-call cost behind an `RpcClient.Protocol`
 * that looks and behaves like an ordinary long-lived client — callers using
 * `conn.rpc["workspace.list"]()` never see the dial-per-call detail.
 *
 * Wire shapes:
 *   Request:  {"id":"<id>","method":"<dotted.method>","params":{...}}
 *   Success:  {"id":"<id>","result":{"type":"...", ...fields}}
 *   Error:    {"id":"<id>","error":{"code":"...","message":"..."}}
 *
 * Every `HerdrRpcs` tag is the herdr `method` string verbatim (e.g.
 * `"workspace.list"`), and herdr's `{code, message}` error body is remapped
 * to `HerdrProtocolError`'s `{code, rawMessage}` shape (with an added
 * `_tag` discriminator) before it reaches the `RpcClient`'s schema decoder.
 *
 * `supportsAck: false` and no ping/pong — herdr's protocol has neither
 * concept. `supportsTransferables: false` — herdr is JSON-only.
 *
 * @since 0.1.0
 */

import * as NodeSocket from "@effect/platform-bun/BunSocket"
import { Deferred, Effect } from "effect"
import { RpcClient } from "effect/unstable/rpc"
import { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import type { FromClientEncoded, FromServerEncoded } from "effect/unstable/rpc/RpcMessage"
import * as Socket from "effect/unstable/socket/Socket"

interface HerdrWireError {
  readonly code: string
  readonly message: string
}

interface HerdrWireLine {
  readonly id: string
  readonly result?: unknown
  readonly error?: HerdrWireError
}

const isHerdrWireLine = (u: unknown): u is HerdrWireLine =>
  typeof u === "object" && u !== null && "id" in u && typeof (u as { id: unknown }).id === "string"

// herdr's Rust-side deserializer rejects an explicit `null` for optional
// bool/string fields (and drops the request id from the error reply when it
// does) — strip null-valued keys so optional fields go missing instead.
const stripNullValues = (payload: unknown): unknown => {
  if (payload === null || payload === undefined) return {}
  if (typeof payload !== "object" || Array.isArray(payload)) return payload
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value !== null) stripped[key] = value
  }
  return stripped
}

const encodeRequestLine = (message: FromClientEncoded): string | undefined => {
  if (message._tag !== "Request") {
    // herdr has no Ack/Interrupt/Eof/Ping wire concept for request/reply
    // methods — those only matter for events.subscribe, handled separately.
    return undefined
  }
  return JSON.stringify({
    id: String(message.id),
    method: message.tag,
    params: stripNullValues(message.payload),
  }) + "\n"
}

const decodeReplyLine = (line: string): FromServerEncoded | undefined => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined

  const parsed: unknown = JSON.parse(trimmed)
  if (!isHerdrWireLine(parsed)) return undefined

  if (parsed.error !== undefined) {
    return {
      _tag: "Exit",
      requestId: parsed.id,
      exit: {
        _tag: "Failure",
        cause: [{
          _tag: "Fail",
          error: { _tag: "HerdrProtocolError", code: parsed.error.code, rawMessage: parsed.error.message },
        }],
      },
    }
  }

  return {
    _tag: "Exit",
    requestId: parsed.id,
    exit: {
      _tag: "Success",
      value: parsed.result,
    },
  }
}

/**
 * Dial a fresh connection to `socketPath`, send one request line, read
 * exactly one reply line, and return it decoded. The connection closes when
 * this Effect's scope closes (immediately after the caller observes the
 * value, since `Effect.scoped` wraps the whole dial-send-read sequence).
 */
const dialOnce = (
  socketPath: string,
  requestLine: string,
): Effect.Effect<FromServerEncoded, RpcClientError> =>
  Effect.scoped(
    Effect.gen(function*() {
      const socket = yield* NodeSocket.makeNet({ path: socketPath })
      const write = yield* socket.writer
      const reply = yield* Deferred.make<string, Socket.SocketError>()

      let buffered = ""
      yield* socket.runString((chunk) => {
        buffered += chunk
        const newlineIndex = buffered.indexOf("\n")
        if (newlineIndex !== -1) {
          return Deferred.succeed(reply, buffered.slice(0, newlineIndex + 1))
        }
        return Effect.void
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Deferred.fail(reply, error),
          onSuccess: () => Effect.void,
        }),
        Effect.forkScoped,
      )

      yield* write(requestLine)

      const replyLine = yield* Deferred.await(reply)

      const decoded = decodeReplyLine(replyLine)
      if (decoded === undefined) {
        return yield* new Socket.SocketError({
          reason: new Socket.SocketReadError({ cause: new Error(`Malformed herdr wire line: ${replyLine}`) }),
        })
      }
      return decoded
    }),
  ).pipe(
    Effect.mapError((error) => new RpcClientError({ reason: error.reason })),
  )

/**
 * Builds an `RpcClient.Protocol` backed by herdr's per-call-dial socket
 * transport — every `send` dials a fresh connection, writes the request,
 * reads exactly one reply, and delivers it via `writeResponse`. There is no
 * shared connection to read from continuously, so `run` only registers the
 * delivery callback. Consumed by `HerdrConnection.make`, not called directly
 * by SDK users.
 *
 * @category constructors
 * @since 0.1.0
 */
export const makeHerdrProtocol = (
  socketPath: string,
): Effect.Effect<RpcClient.Protocol["Service"]> =>
  RpcClient.Protocol.make(
    Effect.fnUntraced(function*(writeResponse, clientIds) {
      return {
        send: (_clientId, request) =>
          Effect.suspend(() => {
            const encoded = encodeRequestLine(request)
            if (encoded === undefined) return Effect.void

            return dialOnce(socketPath, encoded).pipe(
              Effect.flatMap((response) =>
                Effect.forEach(clientIds, (clientId) => writeResponse(clientId, response), { discard: true }),
              ),
            )
          }),
        supportsAck: false,
        supportsTransferables: false,
      }
    }),
  )
