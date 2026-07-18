/**
 * Configuration for effect-herdr, held as Context.References so callers can
 * override any of them internally (@187):
 *
 *   program.pipe(
 *     Effect.provideServiceEffect(HerdrSocketPathConfig, resolveNamed("foo")),
 *     Effect.provide(HerdrSession.Live),
 *   )
 */

import { Context, Effect } from "effect"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Two-tier default resolution (D3):
 *   1. HERDR_SOCKET_PATH env var, if set.
 *   2. `~/.config/herdr/herdr.sock` — the default session's socket, matching
 *      what bare `herdr` itself resolves to.
 *
 * This does NOT check whether the resolved path actually has a live server —
 * that check happens at `HerdrConnection.make`/`.Live` acquire time, not here.
 * This function only computes *which* path to try.
 */
export const resolveDefaultSocketPath = (): string => {
  const fromEnv = process.env["HERDR_SOCKET_PATH"]
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv
  }
  return join(homedir(), ".config", "herdr", "herdr.sock")
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
 * path — e.g. `Effect.provideServiceEffect(HerdrSocketPathConfig, resolveNamedSessionSocketPath("effect-herdr-test-xyz"))`.
 *
 * This does filesystem path arithmetic only — it does not enumerate
 * `herdr session list`, and it does not check liveness. Per D3, the
 * sound-defaults path never does filesystem discovery; this helper is
 * explicit opt-in for named-session callers (case B).
 */
export const resolveNamedSessionSocketPath = (sessionName: string): Effect.Effect<string> =>
  Effect.sync(() => join(homedir(), ".config", "herdr", "sessions", sessionName, "herdr.sock"))

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

/** @internal exported for HerdrConnection's own existsSync-based fast check. */
export const socketFileExists = (path: string): boolean => existsSync(path)
