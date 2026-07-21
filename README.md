# effect-herdr

A typed [Effect](https://effect.website) SDK for [herdr](https://herdr.dev),
the terminal-native agent multiplexer. Script sibling panes, split
workspaces, and react to focus changes — all as composable, typed `Effect`s.

<!--
  DEMO GIF PLACEHOLDER — drop a real capture at docs/demo.gif and swap the
  path below. `examples/parrot.ts` (run with `bun run examples/parrot.ts`
  from inside a herdr pane) is a good capture target: it splits the current
  pane, curls parrot.live for 5s, and closes the split — all in ~6s.
  Suggested recipe: `vhs` (https://github.com/charmbracelet/vhs) or
  `asciinema rec` + `agg` (https://github.com/asciinema/agg); keep it under
  ~10s and ~800px wide so it renders well inline on GitHub.
-->

## Install

```bash
bun add effect-herdr effect
```

## Quickstart

Run this from inside a herdr-managed pane (`HERDR_ENV=1`):

```ts
import { BunFileSystem } from "@effect/platform-bun"
import { Effect, Option } from "effect"
import { currentPane, runInPane, splitPane, HerdrSession } from "effect-herdr"

const program = Effect.gen(function* () {
  const pane = yield* currentPane
  if (Option.isNone(pane)) return yield* Effect.log("not running inside herdr")

  const sibling = yield* splitPane(pane.value, { direction: "right" })
  yield* runInPane(sibling, "echo hello from effect-herdr")
})

program.pipe(
  Effect.provide(HerdrSession.Live),
  Effect.provide(BunFileSystem.layer),
  Effect.runPromise,
)
```

`HerdrSession.Live` resolves the socket path the same way the `herdr` CLI
itself does (env var, then `~/.config/herdr/herdr.sock`) and fails loud at
startup if nothing is listening there — no silent no-ops. `BunFileSystem`
is the one platform layer this quickstart needs; see
[Platform runtime](#platform-runtime) below for why.

A full runnable version of this — split, run a command, wait, close — is
[`examples/parrot.ts`](./examples/parrot.ts):

```bash
bun run examples/parrot.ts   # run from inside a herdr pane
```

## What's here

- **`HerdrSession`** — the ergonomic entry point. One `Layer`, sound defaults.
- **Pane control** — `splitPane`, `focusPane`, `closePane`, `runInPane`
  (batch string or streaming `Stream<string>` input), `waitForOutput`
  (blocks on a substring/regex match, returned as a `Stream`).
- **Focus tracking** — `activePane`/`activeTab` (per-container, always
  resolves), `focusedPane`/`focusedTab`/`focusedWorkspace` (global,
  `Option`-wrapped), `focusedPaneRef` (a live `SubscriptionRef` that updates
  as focus changes anywhere in herdr).
- **Identity vs. state** — `Pane`/`Tab`/`Workspace` are stable references you
  can hold onto; `PaneSnapshot`/`TabSnapshot`/`WorkspaceSnapshot` are
  point-in-time reads with their own `capturedAt`.
- **Raw protocol escape hatch** — every ergonomic combinator is built on
  `HerdrConnection`'s typed `rpc` client. Drop to
  `session.rpc["workspace.list"]()` whenever the service layer doesn't cover
  your case; there's no hidden state that makes mixing the two incoherent.

Not every herdr RPC method has an ergonomic wrapper yet — see
[`TODO.md`](./TODO.md) for the coverage gap and other known limitations
(PTY control-key input, real-time pane-output tailing).

## Platform runtime

effect-herdr uses Effect's platform primitives (`FileSystem`,
`ChildProcessSpawner`, `Crypto`, `Socket`) instead of Node/Bun stdlib calls
directly, so it works the same way under Bun or Node. Provide whichever
platform layer matches your runtime once, at your program's entrypoint —
e.g. `@effect/platform-bun`'s `BunServices.layer`.

## Development

```bash
bun install
bun run typecheck
bun run test            # unit + E2E (spins private herdr servers per test)
bun run schema:refresh  # re-capture scripts/herdr-schema.json after upgrading herdr
```

The E2E suite shells out to a real `herdr` binary to spawn isolated
named-session servers — the SDK-under-test is never in that bootstrap path.
Requires [herdr](https://herdr.dev) on `PATH`.
