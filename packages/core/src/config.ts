/**
 * Configuration for effect-herdr, held as `Context.Reference`s so any
 * caller can override a default without threading extra parameters through
 * every combinator.
 *
 * @since 0.1.0
 */

import { Context, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"

/**
 * Resolves the default herdr socket path: the `HERDR_SOCKET_PATH` env var
 * if set, otherwise `~/.config/herdr/herdr.sock` (the same default bare
 * `herdr` itself resolves to). Only computes the path — does not check
 * whether a server is actually listening there.
 *
 * **Example** (resolving the default socket path)
 *
 * ```ts
 * import { Config } from "effect-herdr"
 *
 * const socketPath = Config.resolveDefaultSocketPath()
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const resolveDefaultSocketPath = (): string => {
  const fromEnv = process.env["HERDR_SOCKET_PATH"]
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv
  }
  const home = process.env["HOME"] ?? "/root"
  return `${home}/.config/herdr/herdr.sock`
}

/**
 * The unix socket path effect-herdr connects to. A `Context.Reference`, so
 * any program can override it with `Effect.provideService`/
 * `Effect.provideServiceEffect` without changing call sites.
 *
 * **Example** (overriding the socket path)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Config, HerdrSession } from "effect-herdr"
 *
 * const program = Effect.provideService(
 *   HerdrSession.Live,
 *   Config.HerdrSocketPathConfig,
 *   "/tmp/my-herdr.sock",
 * )
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export class HerdrSocketPathConfig extends Context.Reference<string>(
  "effect-herdr/HerdrSocketPathConfig",
  { defaultValue: resolveDefaultSocketPath },
) {}

/**
 * Resolves the socket path for a named herdr session (not the default
 * session). Does path arithmetic only — it neither lists live sessions nor
 * checks liveness.
 *
 * **Example** (connecting to a named session)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Config, HerdrSession } from "effect-herdr"
 *
 * const program = Effect.provideServiceEffect(
 *   HerdrSession.Live,
 *   Config.HerdrSocketPathConfig,
 *   Config.resolveNamedSessionSocketPath("my-session"),
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const resolveNamedSessionSocketPath = (sessionName: string): Effect.Effect<string> =>
  Effect.sync(() => `${process.env["HOME"] ?? "/root"}/.config/herdr/sessions/${sessionName}/herdr.sock`)

/**
 * Whether the SDK should re-attempt a broken connection or fail loud.
 * Default (and only currently supported value): `"never"` — the SDK does
 * not silently reconnect.
 *
 * @category models
 * @since 0.1.0
 */
export type HerdrReconnectPolicyValue = "never"

/**
 * `Context.Reference` for {@link HerdrReconnectPolicyValue}. Override it to
 * opt a program into a different reconnect behavior once the SDK supports
 * one.
 *
 * @category models
 * @since 0.1.0
 */
export class HerdrReconnectPolicy extends Context.Reference<HerdrReconnectPolicyValue>(
  "effect-herdr/HerdrReconnectPolicy",
  { defaultValue: (): HerdrReconnectPolicyValue => "never" },
) {}

/**
 * Whether a herdr socket file exists at `path`. Backed by the `FileSystem`
 * service, so callers must provide a platform layer (`BunFileSystem.layer`,
 * `NodeFileSystem.layer`, ...) — effect-herdr bundles none of its own.
 *
 * **Example** (checking a socket before connecting)
 *
 * ```ts
 * import { BunFileSystem } from "@effect/platform-bun"
 * import { Effect } from "effect"
 * import { Config } from "effect-herdr"
 *
 * const program = Config.socketFileExists("/tmp/herdr.sock").pipe(
 *   Effect.provide(BunFileSystem.layer),
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const socketFileExists = (path: string) =>
  Effect.flatMap(FileSystem, (fs) => fs.exists(path))
