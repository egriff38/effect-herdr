/**
 * Persistent-connection adapter for herdr's `events.subscribe` — the one
 * herdr RPC method that keeps its socket connection open, unlike every
 * ordinary request/reply method (see `HerdrWireProtocol.ts` for that
 * per-call-dial model). This module owns the persistent-connection
 * handling `events.subscribe` needs on its own.
 *
 * Wire sequence:
 *   1. Dial one socket, write `{"id":"<id>","method":"events.subscribe","params":{"subscriptions":[{"type":"<dotted.type>"},...]}}`.
 *   2. herdr's first reply line, on the same connection, echoes the
 *      request's `id`: `{"id":"<id>","result":{"type":"subscription_started"}}`.
 *      That's the ack. An error-shaped ack maps to `HerdrProtocolError`.
 *   3. Every later line is a push, with no `id` field at all:
 *      `{"event":"pane_focused","data":{"pane_id":"w1:p2","workspace_id":"w1","type":"pane_focused"}}`.
 *      Each is decoded into a `HerdrEventPush` and emitted on the returned Stream.
 *
 * Subscription request-side type strings are dotted (`"pane.focused"`);
 * push-side `event`/`data.type` are underscore form (`"pane_focused"`) —
 * the two do not match string-for-string, so callers filtering pushes must
 * account for this themselves.
 *
 * The socket stays open for as long as the returned Stream's `Scope` does;
 * closing that scope tears down the connection and ends the Stream.
 *
 * @since 0.1.0
 */

import { Cause, Data, Deferred, Effect, Queue, Scope, Stream } from "effect"
import * as NodeSocket from "@effect/platform-bun/BunSocket"
import * as Socket from "effect/unstable/socket/Socket"
import { HerdrProtocolError } from "./protocol/errors.js"

/**
 * One `events.subscribe` push — no `id` field, unlike an RPC reply.
 *
 * @category models
 * @since 0.1.0
 */
export interface HerdrEventPush {
  readonly event: string
  readonly data: Record<string, unknown>
}

/**
 * The subscribe connection produced a line that is neither the expected ack
 * nor a well-formed push. SDK-side only — never crosses the wire itself,
 * unlike `HerdrProtocolError` (which decodes a real `{code, message}` body
 * herdr sent).
 *
 * @category errors
 * @since 0.1.0
 */
export class HerdrMalformedSubscribeLine extends Data.TaggedError("HerdrMalformedSubscribeLine")<{
  readonly line: string
}> {
  override get message(): string {
    return `Malformed herdr events.subscribe wire line: ${this.line}`
  }
}

interface AckLine {
  readonly id: string
  readonly result?: { readonly type?: unknown }
  readonly error?: { readonly code: string; readonly message: string }
}

const isAckLine = (u: unknown): u is AckLine =>
  typeof u === "object" && u !== null && "id" in u && typeof u.id === "string"

const isPushLine = (u: unknown): u is HerdrEventPush =>
  typeof u === "object" && u !== null
  && "event" in u && typeof u.event === "string"
  && "data" in u && typeof u.data === "object" && u.data !== null

/**
 * Failure modes possible before the ack resolves — i.e. before `subscribe`'s
 * Effect returns a Stream.
 *
 * @category errors
 * @since 0.1.0
 */
export type HerdrSubscribeAckError =
  | Socket.SocketError
  | HerdrProtocolError
  | HerdrMalformedSubscribeLine

/**
 * Failure modes possible on the returned push Stream itself, after the ack
 * has already resolved.
 *
 * @category errors
 * @since 0.1.0
 */
export type HerdrSubscribePushError = Socket.SocketError | HerdrMalformedSubscribeLine

/**
 * Opens a persistent connection to `socketPath` and subscribes to
 * `subscriptionTypes` (dotted form, e.g. `"pane.focused"`), returning a
 * Stream of every push that arrives afterward. The socket — and the
 * Stream's emissions — stay alive for as long as the calling `Scope` does;
 * closing it tears the connection down and ends the Stream.
 *
 * Fails at acquire time, before the Stream is even returned, if the dial
 * fails, herdr rejects the subscribe request, or the first reply line is
 * malformed. Once subscribed, a later malformed push line or socket read
 * failure surfaces on the Stream's own error channel instead. Consumed by
 * `HerdrConnection.make`'s `events.subscribe`, not called directly by SDK
 * users.
 *
 * @category constructors
 * @since 0.1.0
 */
export const subscribe = (
  socketPath: string,
  subscriptionTypes: ReadonlyArray<string>,
): Effect.Effect<
  Stream.Stream<HerdrEventPush, HerdrSubscribePushError>,
  HerdrSubscribeAckError,
  Scope.Scope
> =>
  Effect.gen(function*() {
    const socket = yield* NodeSocket.makeNet({ path: socketPath })
    const write = yield* socket.writer

    const ack = yield* Deferred.make<AckLine, Socket.SocketError>()
    const pushes = yield* Queue.unbounded<HerdrEventPush, HerdrSubscribePushError | Cause.Done>()

    // Guarantee the queue ends when the scope closes, even under
    // interruption — `Effect.forkScoped`'s read-loop skips both branches
    // below on interruption, which would otherwise leave `Stream.fromQueue`
    // consumers hanging on `Queue.take`. `Queue.end` is idempotent, so a
    // later graceful termination calling `Queue.end`/`Queue.fail` is safe.
    yield* Effect.addFinalizer(() => Queue.end(pushes))

    let buffered = ""
    let ackObserved = false

    // Buffer chunks until a full line is available, same technique as
    // HerdrWireProtocol.ts's `dialOnce`, but kept running indefinitely
    // instead of resolving once. The first split-off line completes `ack`;
    // every line after that is decoded as a push and offered onto
    // `pushes`. A single chunk can contain more than one line (or none),
    // so every line found is collected into `effects` and run together,
    // preserving arrival order.
    yield* socket.runString((chunk) => {
      buffered += chunk
      const effects: Array<Effect.Effect<unknown>> = []
      for (;;) {
        const newlineIndex = buffered.indexOf("\n")
        if (newlineIndex === -1) break
        const line = buffered.slice(0, newlineIndex)
        buffered = buffered.slice(newlineIndex + 1)
        if (line.trim().length === 0) continue

        if (!ackObserved) {
          ackObserved = true
          const parsed: unknown = JSON.parse(line)
          effects.push(
            isAckLine(parsed)
              ? Deferred.succeed(ack, parsed)
              : Deferred.fail(
                ack,
                new Socket.SocketError({
                  reason: new Socket.SocketReadError({ cause: new Error(`Malformed herdr ack line: ${line}`) }),
                }),
              ),
          )
          continue
        }

        const parsed: unknown = JSON.parse(line)
        effects.push(
          isPushLine(parsed)
            ? Queue.offer(pushes, parsed)
            : Queue.fail(pushes, new HerdrMalformedSubscribeLine({ line })),
        )
      }
      return effects.length === 0 ? Effect.void : Effect.all(effects, { discard: true })
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.andThen(
            ackObserved ? Effect.void : Deferred.fail(ack, error),
            Queue.fail(pushes, error),
          ),
        onSuccess: () =>
          Effect.andThen(
            ackObserved
              ? Effect.void
              : Deferred.fail(ack, new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) })),
            Queue.end(pushes),
          ),
      }),
      Effect.forkScoped,
    )

    yield* write(
      JSON.stringify({
        id: "events-subscribe",
        method: "events.subscribe",
        params: { subscriptions: subscriptionTypes.map((type) => ({ type })) },
      }) + "\n",
    )

    const ackLine = yield* Deferred.await(ack)

    if (ackLine.error !== undefined) {
      return yield* new HerdrProtocolError({ code: ackLine.error.code, rawMessage: ackLine.error.message })
    }
    if (ackLine.result?.type !== "subscription_started") {
      return yield* new HerdrMalformedSubscribeLine({ line: JSON.stringify(ackLine) })
    }

    return Stream.fromQueue(pushes)
  })
