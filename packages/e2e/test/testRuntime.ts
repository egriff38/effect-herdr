/**
 * Shared E2E test runtime — provides the platform-primitive services every
 * test needs (`ChildProcessSpawner`, `FileSystem`, `Crypto`, ...) exactly
 * once, at the test-entrypoint boundary, per the "no bare node/bun stdlib
 * imports in library or test source" convention. Every test file runs its
 * program through `runTest`/`runTestExit` instead of calling
 * `Effect.runPromise`/`Effect.runPromiseExit` directly.
 */

import { BunServices } from "@effect/platform-bun"
import { Effect, type Scope } from "effect"

const layer = BunServices.layer

export const runTest = <A, E>(
  effect: Effect.Effect<A, E, BunServices.BunServices | Scope.Scope>,
): Promise<A> => Effect.runPromise(Effect.scoped(Effect.provide(effect, layer)))

export const runTestExit = <A, E>(
  effect: Effect.Effect<A, E, BunServices.BunServices | Scope.Scope>,
) => Effect.runPromiseExit(Effect.scoped(Effect.provide(effect, layer)))
