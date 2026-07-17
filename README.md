# effect-herdr

Typed [Effect-TS](https://effect.website) SDK for [herdr](https://herdr.dev), the terminal-native agent multiplexer.

**Status:** scaffold only. The design is being grilled in a separate session before implementation lands. See the vault note `3100-Permanent (AI)/Effect-Herdr Plugin SDK - Typed Full-Duplex Proposal.md` for the current proposal.

## Layout

```
packages/
  core/      # the SDK: RpcGroup protocol + HerdrSession Context.Service
  e2e/       # end-to-end tests against a private herdr server per test
scripts/
  herdr-schema.json   # captured `herdr api schema --json` output (protocol 16)
```

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- [herdr](https://herdr.dev) 0.7.4+ on `PATH` (verified: `herdr --version`)
- The E2E harness shells out to the real `herdr` binary to spawn isolated named-session servers — the SDK-under-test is never in the bootstrap path

## Development

```bash
bun install
bun run typecheck
bun run test          # includes the bootstrap self-test in packages/e2e
bun run schema:refresh  # re-capture the herdr socket schema after upgrading herdr
```

## Design principles (per `effect-ts-wrapper-design` skill)

1. Ground in herdr's real contract (`herdr api schema --json` — 85 methods, protocol 16, JSON Schema documented).
2. Ground in Effect's real primitives (`Rpc`/`RpcGroup`/`RpcClient`/`RpcServer`/`Socket`/`Context.Service` from `effect-smol`).
3. Enumerate all four RPC shapes — plain request/reply, streaming (`events.subscribe`, `pane.wait_for_output`), fire-and-forget (`pane.send_text`), connection-scoped (socket death, protocol defects).
4. Two layers: `HerdrRpcs` (typed protocol) + `HerdrSession` (`Context.Service` ergonomic layer with domain value objects).
5. Three-way capability check when tempted to satisfy an existing Effect contract (e.g. `ChildProcessSpawner` against a PTY) — fake / convention-adapter / honest new interface.
