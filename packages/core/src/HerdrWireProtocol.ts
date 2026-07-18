/**
 * Translates between Effect's RPC wire envelope and herdr's actual socket
 * protocol.
 *
 * CRITICAL, EMPIRICALLY VERIFIED CORRECTION (during implementation of issue
 * #1/#2): herdr's socket is NOT a persistent multiplexed connection for
 * ordinary request/reply methods. Verified three independent ways (raw `nc`,
 * a Python socket client, and this SDK's own E2E test) that herdr closes the
 * underlying connection immediately after answering exactly one request.
 * Herdr's own docs say it explicitly, easy to underweight on first read:
 *
 *   "Event subscriptions keep the connection open after the initial response."
 *
 * — which by omission means every OTHER method does NOT keep the connection
 * open. One request, one reply, one connection, then herdr closes it.
 *
 * This invalidates the "open once, reuse for many calls" model the original
 * design docs (D1-D3) assumed (that model is correct for HTTP-keep-alive or
 * WebSocket transports, which is why `RpcClient.makeProtocolSocket` assumes
 * it — but herdr's socket is neither of those).
 *
 * Fix (documented here as the load-bearing correction; see docs/design.md D4):
 * `send` dials a FRESH socket connection per RPC call, writes the request,
 * reads exactly one reply line, decodes it, and closes. The `RpcClient`
 * surface (`conn.rpc["workspace.list"]()`) stays ergonomically identical —
 * the reconnect-per-call cost is hidden behind this adapter, not exposed to
 * callers. `events.subscribe` is NOT covered by this adapter; it needs its
 * own persistent-connection handling and is deferred to slice 9 (issue #10),
 * which will dial a separate, genuinely long-lived connection dedicated to
 * the subscription stream.
 *
 * Wire shapes (unchanged from the original — still accurate):
 *   Request:  {"id":"<id>","method":"<dotted.method>","params":{...}}
 *   Success:  {"id":"<id>","result":{"type":"...", ...fields}}
 *   Error:    {"id":"<id>","error":{"code":"...","message":"..."}}
 *
 * Every `HerdrRpcs` tag IS the herdr `method` string verbatim (e.g.
 * `"workspace.list"`) — this only works because `Rpc.make` tags in
 * `HerdrRpcs.ts` are written as herdr's dotted method names, not
 * PascalCase RPC-library-style tags.
 *
 * `supportsAck: false` and no ping/pong — herdr's protocol has neither
 * concept. `supportsTransferables: false` — herdr is JSON-only.
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

/**
 * THIRD CORRECTION, empirically verified during implementation of issue #9:
 * Effect's Schema JSON codec encodes an omitted `Schema.optional(...)` field
 * as an EXPLICIT `null` in the JSON payload, not as a missing key. herdr's
 * Rust-side deserializer rejects `null` for a `bool`/`string` optional field
 * outright (`{"error":{"code":"invalid_request","message":"invalid type:
 * null, expected a boolean..."}}`) — verified live via raw socket against
 * `pane.split`'s optional `focus` field. Worse: herdr's error reply in this
 * case carries `"id":""` (empty string, not the real request id) because
 * the deserialization failure happens before herdr can even extract the
 * id — so the reply can never be matched back to the pending request by
 * `RpcClient`'s response-collector, and the call hangs forever (observed:
 * 20s+ test timeout, not a herdr-side delay). Fix: strip any top-level
 * `null`-valued key from the encoded payload before sending — herdr wants
 * a MISSING optional key, never an explicit `null`.
 */
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
    // methods — those only matter for events.subscribe (slice 9, issue #10).
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
        cause: [{ _tag: "Fail", error: parsed.error }],
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
 * Builds a `RpcClient.Protocol` where every `send` dials a fresh connection
 * per request, per the herdr one-request-per-connection correction above.
 * `run` registers the delivery callback but has no shared read loop to run,
 * since there is no shared connection — each `send` delivers its own reply
 * directly via `writeResponse`.
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
