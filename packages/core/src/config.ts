/**
 * Configuration for effect-herdr, held as Context.References so callers can
 * override any of them internally (@187):
 *
 *   program.pipe(
 *     Effect.provideServiceEffect(HerdrSocketPathConfig, resolveNamed("foo")),
 *     Effect.provide(HerdrSessionLive),
 *   )
 */


/**
 * The unix socket path effect-herdr connects to. Default resolution walks
 * `HERDR_SOCKET_PATH` env then `~/.config/herdr/herdr.sock` — the same
 * two-tier fallback bare `herdr` itself uses (D3).
 */
export declare class HerdrSocketPathConfig /* extends Context.Reference<HerdrSocketPathConfig, string>()(
  "effect-herdr/HerdrSocketPathConfig",
  { defaultValue: () => resolveDefaultSocketPath() },
) */ {
  readonly _tag: "HerdrSocketPathConfig"
}

/**
 * Whether the SDK should re-attempt a broken connection (via a
 * user-supplied schedule) or fail loud. Default: never reconnect.
 * The v1 SDK does not silently reconnect (D3).
 */
export declare class HerdrReconnectPolicy /* extends Context.Reference<HerdrReconnectPolicy, "never" | { schedule: Schedule<any, any> }>()(...) */ {
  readonly _tag: "HerdrReconnectPolicy"
}
