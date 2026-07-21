/**
 * Configuration for effect-herdr, held as `Context.Reference`s so callers can
 * override any of them (@187):
 *
 *   program.pipe(
 *     Effect.provideServiceEffect(HerdrSocketPathConfig, resolveNamedSessionSocketPath("foo")),
 *     Effect.provide(HerdrSession.Live),
 *   )
 */

import { Context, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"

/**
 * Two-tier default resolution (D3):
 *   1. `HERDR_SOCKET_PATH` env var, if set.
 *   2. `~/.config/herdr/herdr.sock` — the default session's socket, matching
 *      what bare `herdr` itself resolves to.
 *
 * This does NOT check whether the resolved path actually has a live server —
 * that check happens at `HerdrConnection.make`/`.Live` acquire time, not
 * here. This function only computes *which* path to try.
 *
 * `HOME` is read directly rather than through a platform `Path`/`homedir`
 * primitive: herdr's socket is a unix-domain socket, so its path is always
 * POSIX-shaped, independent of the host's own path-separator conventions.
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
 * The unix socket path effect-herdr connects to. Default resolution walks
 * `HERDR_SOCKET_PATH` env then `~/.config/herdr/herdr.sock` — the same
 * two-tier fallback bare `herdr` itself uses (D3).
 */
export class HerdrSocketPathConfig extends Context.Reference<string>(
  "effect-herdr/HerdrSocketPathConfig",
  { defaultValue: resolveDefaultSocketPath },
) {}

/**
 * Resolve a NAMED session's socket path (not the default-session path).
 * Used by callers who want a specific session rather than the sound-defaults
 * path — e.g. `Effect.provideServiceEffect(HerdrSocketPathConfig, resolveNamedSessionSocketPath("my-session"))`.
 *
 * This does path arithmetic only — it does not enumerate `herdr session
 * list`, and it does not check liveness. Per D3, the sound-defaults path
 * never does filesystem discovery; this helper is explicit opt-in for
 * named-session callers (case B).
 */
export const resolveNamedSessionSocketPath = (sessionName: string): Effect.Effect<string> =>
  Effect.sync(() => `${process.env["HOME"] ?? "/root"}/.config/herdr/sessions/${sessionName}/herdr.sock`)

/**
 * Whether the SDK should re-attempt a broken connection (via a
 * user-supplied schedule) or fail loud. Default: never reconnect.
 * The v1 SDK does not silently reconnect (D3) — this reference exists so a
 * future v1.x can add opt-in reconnect without changing HerdrConnection's
 * public shape.
 */
export type HerdrReconnectPolicyValue = "never"

export class HerdrReconnectPolicy extends Context.Reference<HerdrReconnectPolicyValue>(
  "effect-herdr/HerdrReconnectPolicy",
  { defaultValue: (): HerdrReconnectPolicyValue => "never" },
) {}

/**
 * Whether a herdr socket file exists at `path`. Backed by the `FileSystem`
 * service — callers provide whichever platform layer matches their runtime
 * (`BunFileSystem.layer`, `NodeFileSystem.layer`, ...). effect-herdr bundles
 * none of its own; `HerdrConnection.Live`/`.layer`/`.make` all require
 * `FileSystem` in their own signatures as a result.
 *
 * @internal exported for `HerdrConnection.make`'s own liveness pre-check.
 */
export const socketFileExists = (path: string) =>
  Effect.flatMap(FileSystem, (fs) => fs.exists(path))
