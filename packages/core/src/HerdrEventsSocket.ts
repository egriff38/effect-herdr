/**
 * Persistent-socket adapter for herdr's `events.subscribe` — the one method
 * herdr's own docs flag as the exception to the per-call-dial model
 * `HerdrWireProtocol.ts` uses for every other RPC (see that file's header
 * comment for the full account of why ordinary methods close their
 * connection after one reply, and why `events.subscribe` doesn't).
 *
 * Wire sequence (empirically verified live against a real herdr server):
 *   1. Dial ONE socket, write `{"id":"<id>","method":"events.subscribe","params":{"subscriptions":[{"type":"<dotted.type>"},...]}}`.
 *   2. herdr's first reply line, on the SAME connection, carries the
 *      request's `id` back: `{"id":"<id>","result":{"type":"subscription_started"}}`.
 *      That's the ack — verify it, then stop treating subsequent lines as
 *      request replies. An error-shaped ack (`{"id":"<id>","error":{...}}`)
 *      maps to `HerdrProtocolError`, matching `HerdrWireProtocol.ts`'s own
 *      `decodeReplyLine` convention for herdr's `{code, message}` error body.
 *   3. Every later line is a PUSH, with no `id` field at all:
 *      `{"event":"pane_focused","data":{"pane_id":"w1:p2","workspace_id":"w1","type":"pane_focused"}}`.
 *      Decode each into a `HerdrEventPush` and emit it on the returned Stream.
 *
 * Subscription request-side type strings are DOTTED (`"pane.focused"`);
 * push-side `event`/`data.type` are UNDERSCORE form (`"pane_focused"`) —
 * verified NOT to match string-for-string. Callers filtering pushes must
 * account for this themselves (`operations/focus.ts`'s `focusedPaneRef`
 * does).
 *
 * Implementation follows `HerdrWireProtocol.ts`'s `dialOnce` buffer-until-
 * newline technique (accumulate chunks, split on `\n`), but the socket here
 * is NOT wrapped in an immediately-closing `Effect.scoped` — it stays open
 * for as long as the returned Stream's `Scope` does (this function itself
 * requires `Scope.Scope`, per the same convention `HerdrConnection.make`
 * uses). The ack is consumed via a `Deferred`, exactly like `dialOnce`;
 * every line after that is offered onto an unbounded `Queue` that the
 * returned `Stream.fromQueue` pulls from, so the acquire step (dial + ack)
 * and the ongoing push stream share the exact same read loop and buffer.
 */

import { Cause, Data, Deferred, Effect, Queue, Scope, Stream } from "effect"
import * as NodeSocket from "@effect/platform-bun/BunSocket"
import * as Socket from "effect/unstable/socket/Socket"
import { HerdrProtocolError } from "./protocol/errors.js"

/** One `events.subscribe` push — no `id` field, unlike an RPC reply. */
export interface HerdrEventPush {
  readonly event: string
  readonly data: Record<string, unknown>
}

/**
 * The subscribe connection produced a line that is neither the expected ack
 * nor a well-formed push. SDK-side only — never crosses the wire itself,
 * unlike `HerdrProtocolError` (which decodes a real `{code, message}` body
 * herdr sent).
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

/** Failure modes possible before the ack resolves — i.e. before `subscribe`'s Effect returns a Stream. */
export type HerdrSubscribeAckError =
  | Socket.SocketError
  | HerdrProtocolError
  | HerdrMalformedSubscribeLine

/** Failure modes possible on the returned push Stream itself, after the ack has already resolved. */
export type HerdrSubscribePushError = Socket.SocketError | HerdrMalformedSubscribeLine

/**
 * Dial a persistent connection to `socketPath`, subscribe to
 * `subscriptionTypes` (dotted form, e.g. `"pane.focused"`), and return a
 * Stream of every push that arrives afterward. The socket stays open, and
 * the returned Stream keeps emitting, for as long as the calling `Scope`
 * stays open — closing it tears down the socket (via `NodeSocket.makeNet`'s
 * own scoped-finalizer behavior, triggered here by forking the read loop
 * with `Effect.forkScoped`) and ends the Stream.
 *
 * Fails at acquire time (before the Stream is even returned) if the dial
 * itself fails, herdr answers the subscribe request with an error, or the
 * first reply line is malformed — mirroring `HerdrConnection.make`'s own
 * "fail loud before returning" convention. Once subscribed, a later
 * malformed push line or socket read failure surfaces on the Stream's own
 * error channel instead, since by then the Stream has already been handed
 * to the caller.
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

    // Guarantee the queue ends when the scope closes, EVEN under
    // interruption. Interrupting `Effect.forkScoped`'s read-loop skips
    // both `onSuccess` and `onFailure` branches below (they run only on
    // graceful completion/failure), which would leave `Stream.fromQueue`
    // consumers hanging on `Queue.take` — exactly what breaks the
    // "closing the scope tears down the subscription" acceptance
    // criterion. `Queue.end` is idempotent, so a subsequent graceful
    // termination path calling `Queue.end`/`Queue.fail` is safe.
    yield* Effect.addFinalizer(() => Queue.end(pushes))

    let buffered = ""
    let ackObserved = false

    // Same buffer-until-newline technique as HerdrWireProtocol.ts's
    // dialOnce, extended to keep running (and keep splitting off lines)
    // indefinitely rather than resolving a single Deferred and stopping.
    // The first split-off line completes `ack`; every line after that is
    // decoded as a push and offered onto `pushes`. A single chunk can
    // contain more than one line (or none), so every line found during one
    // handler invocation is collected into `effects` and run together,
    // preserving arrival order (`Effect.all`'s default sequential mode).
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
