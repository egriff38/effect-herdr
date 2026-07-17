# effect-herdr — design decisions

This doc captures decisions settled *before* the implementation grilling begins. Each entry names what was decided, the shape of the alternatives that were considered, and the reasoning that broke the tie. It exists so the grilling session can start from a clear anchor rather than re-derive from memory.

The full proposal (motivation, protocol layer, service layer, PTY honesty) lives in the vault at `3100-Permanent (AI)/Effect-Herdr Plugin SDK - Typed Full-Duplex Proposal.md`.

---

## D1. Environment introspection: `currentPane` / `currentTab` / `currentWorkspace`

**Decided.** Herdr injects five env vars into every managed pane (`HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`). The SDK exposes three matching accessors on `HerdrSession`:

```ts
readonly currentPane:      Effect.Effect<Option.Option<Pane>,      HerdrProtocolError, HerdrSession>
readonly currentTab:       Effect.Effect<Option.Option<Tab>,       HerdrProtocolError, HerdrSession>
readonly currentWorkspace: Effect.Effect<Option.Option<Workspace>, HerdrProtocolError, HerdrSession>
```

**Shape:** `Effect<Option<T>, HerdrProtocolError>`, three-way split of failure modes:

| Situation | Result |
|---|---|
| Not running inside a herdr-managed pane (`HERDR_ENV` unset / `HERDR_PANE_ID` missing) | `Option.none` |
| Inside herdr, `pane.get` succeeds | `Option.some(pane)` |
| Inside herdr, `pane.get` fails (stale ID after pane close, socket dead, protocol error) | `HerdrProtocolError` |

**Why `Option` on the outer axis, `HerdrProtocolError` on the error channel:**
- `Option.none` reserves a single, unambiguous meaning: "this program isn't in herdr." Composes with `Option.getOrElse` for the natural fallback pattern ("report to pane if available, else stdout").
- A defect / die-shape would be wrong: it's legitimate for an Effect program to run both inside and outside herdr (e.g. a build script that opportunistically reports progress to a sibling pane).
- A typed error channel (instead of `never`) is required because the round-trip to `pane.get` really can fail. Collapsing those failures into `Option.none` would hide real bugs.

**Why resolve via `pane.get` rather than return env IDs raw:** the SDK has exactly one `Pane` / `Tab` / `Workspace` value-object shape, no bifurcation between "kinda-Pane from env" and "full Pane from RPC." Every downstream consumer reads the same fields regardless of how the reference was obtained. Costs one round-trip per accessor — worth it.

**Stale-ID handling — fail loud.** `HERDR_PANE_ID` is injected once at pane launch and never updated. If the pane is closed (or the id compacts, per herdr's own docs) between injection and lookup, `pane.get` returns `pane_not_found`. The SDK surfaces this as `HerdrProtocolError` rather than translating it back to `Option.none` — a plugin that specifically wants "closed pane" to mean "not in herdr" can `Effect.catchTag("PaneNotFound", () => Effect.succeed(Option.none()))` explicitly. Pre-collapsing here loses information a caller might reasonably want.

**All three accessors, not just `currentPane`.** Herdr injects all three IDs and they cost the same to resolve; adding `currentPane` alone would grow the API lopsided.

Open sub-question for the grilling: whether the three accessors are three fields on `HerdrSession`, or a single `current: Effect<Option<{pane, tab, workspace}>, ...>` returning a bundle. Bundle is cheaper on the wire (one call could plausibly return all three, if we add a `context.snapshot`-style RPC — none exists today, so this would need protocol work). Three separate accessors is what the current RPC surface actually supports.

---

## Deferred to grilling

- Full `HerdrRpcs` / `PluginRpcs` group shapes (85 methods, protocol 16, captured in `scripts/herdr-schema.json` — needs curation, not every method is user-facing)
- `Pane` / `Tab` / `Workspace` value-object schemas (what fields, opaque vs. transparent id types)
- `HerdrProtocolError` variants and how they map to herdr's own `ErrorBody.code` strings
- Whether `wait_for_output` and `events.subscribe` share one streaming primitive or two
- PTY / `runInPane` shape from the proposal doc (option 1 vs. option 2 vs. tagged-adapter middle ground)
- Layer-swappable `ChildProcessSpawner` compatibility — build later, only if a real caller needs it
