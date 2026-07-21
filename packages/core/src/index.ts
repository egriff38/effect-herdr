/**
 * effect-herdr — a typed Effect SDK for herdr, the terminal-native agent
 * multiplexer.
 *
 * The primary entry point is `HerdrSession` plus the combinators in
 * `operations/` — `currentPane`/`currentTab`/`currentWorkspace`,
 * `splitPane`/`focusPane`/`closePane`/`runInPane`/`waitForOutput`, and the
 * `active*`/`focused*` focus-lookup families. `HerdrConnection` and
 * `HerdrRpcs` are the lower-level protocol layer underneath, available
 * directly for callers who need raw RPC access.
 *
 * ```ts
 * import { currentPane, runInPane, HerdrSession } from "effect-herdr"
 * import { Effect, Option } from "effect"
 *
 * const program = Effect.gen(function* () {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return yield* Effect.log("not in herdr")
 *   yield* runInPane(pane.value, "echo hello from effect-herdr")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @since 0.1.0
 */

// Configuration references
export * as Config from "./config.js"

// Protocol layer — the typed RpcGroup and its schemas
export * as HerdrRpcs from "./protocol/HerdrRpcs.js"
export * from "./protocol/errors.js"
export * from "./protocol/schemas.js"

// Connection primitive
export * as HerdrConnection from "./HerdrConnection.js"

// Service layer
export * as HerdrSession from "./HerdrSession.js"

export { listWorkspaces } from "./listWorkspaces.js"

// Domain-shaped combinators — the primary API surface
export * from "./operations/index.js"
