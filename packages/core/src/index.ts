/**
 * effect-herdr — typed Effect-TS SDK for the herdr terminal multiplexer.
 *
 * See `docs/design.md` for the accumulated design decisions (D1–D3),
 * `CONTEXT.md` for the domain vocabulary (Session / Server / Connection /
 * case C/B/A / protocol vs. service layer), and the per-file JSDoc for the
 * shape of each module.
 *
 * Reference call-site — the primary target ergonomic for case C:
 *
 *   import { currentPane, runInPane, HerdrSession } from "effect-herdr"
 *   import { Effect, Option } from "effect"
 *
 *   const program = Effect.gen(function* () {
 *     const pane = yield* currentPane
 *     if (Option.isNone(pane)) return yield* Effect.log("not in herdr")
 *     yield* runInPane(pane.value, "echo hello from effect-herdr")
 *   })
 *
 *   program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 */

// Configuration references (@187)
export * as Config from "./config.js"

// Protocol layer (@120) — the typed RpcGroup and its schemas
export * as HerdrRpcs from "./protocol/HerdrRpcs.js"
export * from "./protocol/errors.js"
export * from "./protocol/schemas.js"

// Connection primitive (D3)
export * as HerdrConnection from "./HerdrConnection.js"

// Service layer (D2, @211-a)
export * as HerdrSession from "./HerdrSession.js"

// Domain-shaped combinators — the primary API surface (case C)
// Split into operations/{pane,focus,current}.ts per hunk review @#3
export * from "./operations/index.js"
