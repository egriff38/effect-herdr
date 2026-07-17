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

## D2. Layering policy — both layers, always exposed

**Decided.** The SDK targets **agents running inside herdr panes** (case C — sibling-pane scripting from OMP/Claude Code/pi/etc.) as the primary ergonomic driver, but its layering is agnostic to consumer type. Both the raw protocol layer and the ergonomic service layer ship in v1 and remain independently usable.

**What "both layers, always exposed" means concretely:**

- `packages/core` exports **`HerdrRpcs`** (the typed `RpcGroup` protocol contract) *and* **`HerdrSession`** (the `Context.Service` ergonomic layer). Neither hides the other.
- Every `HerdrSession` method has a raw-layer escape hatch: callers who need something the service doesn't expose can drop to `client.call("pane.split", { ... })` in the same program. `HerdrSession` MUST NOT hold hidden state that would make raw-layer calls incoherent alongside service-layer calls.
- The socket-connection primitive is built as "**here is a duplex, run whatever `RpcClient` / `RpcServer` pair you want over it**" — not "here is a hard-coded client." This is the load-bearing constraint that keeps v2 (case A — herdr plugins with reverse RPC) additive rather than a rewrite.

**Consumer cases and how each is served:**

| Case | Description | v1 shape |
|---|---|---|
| **C** (primary) | Agents inside herdr panes scripting sibling panes | `HerdrSession` service methods; `currentPane` from D1 |
| **B** (naturally served) | External automation opening the socket from outside herdr (e.g. the E2E harness itself) | Raw `RpcClient<HerdrRpcs>` directly — no service layer needed |
| **A** (deferred to v2) | Herdr plugins that answer reverse-RPC action/event/pane invocations | `PluginRpcs` group + `HerdrPlugin.make({ handlers })` layered on the same connection primitive |

**What v1 defers and why:**

- `PluginRpcs` and the peer-duplex `HerdrPlugin.make` API from the vault proposal are cut from v1. The `herdr-plugin` community is small (top-of-list plugins under 150 stars) and the reverse-RPC surface adds real complexity — manifest integration, action handler registry, pane entrypoint routing — for an audience that can wait.
- Cutting them does not compromise the design: the v2 additive path is `RpcServer<PluginRpcs>` running over the same connection, using effect-smol's existing `Worker`/`WorkerRunner` symmetric-duplex precedent.

**What this rules out:**

- A "smart" `HerdrSession` that caches state, batches calls, or otherwise diverges from what the raw protocol says — anything that would make service-layer and raw-layer calls disagree.
- Hiding the `RpcClient` or the socket connection behind the service. Both are public. Both have documented types.

---

## D3. Connection primitive — three tiers, sound defaults resolve to a running server

**Decided.** Three separable concepts, three separately usable primitives:

```
HerdrConnection.make    ← the acquire (opens the socket). Scoped Effect.
       ↓
HerdrConnection         ← the connection itself, as a Context.Service.
       ↓                  Given a connection, hand out RpcClients / (v2) run RpcServers.
HerdrSessionLive        ← the ergonomic service Layer (splitPane, currentPane, …).
       ↓                  Requires HerdrConnection.
user program            ← `yield* session.splitPane(pane)` — no scope, no plumbing.
```

**Naming convention (matches effect-smol):**

| Symbol | Requirements | Purpose |
|---|---|---|
| `HerdrConnection.make(opts)` | `Scope` | Scoped constructor. Advanced callers (E2E harness) bracket lifetime themselves. |
| `HerdrConnection.layer(opts)` | — (Scope absorbed via `Layer.scoped`) | Bring-your-own-config Layer. |
| `HerdrConnectionLive` | — | Sound-defaults Layer — resolves the socket path automatically (see below). |
| `HerdrSessionLayer` | `HerdrConnection` | The service Layer with requirements exposed (compose with any `HerdrConnection` variant). |
| `HerdrSessionLive` | — | The sound-defaults ergonomic Layer. `= Layer.provide(HerdrSessionLayer, HerdrConnectionLive)`. |

The two `Live` variants exist so that call sites like the following actually work as written, with no connection-layer boilerplate:

```ts
currentPane.pipe(
  Effect.andThen((p) => Effect.log(p.id)),
  Effect.provide(HerdrSessionLive),
  Effect.runPromise,
)
```

**What `HerdrSessionLive` actually assumes**: a **running server** is reachable. Not a session — sessions exist as on-disk config regardless of whether a server is running. Not a connection — the Layer *makes* the connection, doesn't assume one. See `CONTEXT.md` for the Session / Server / Connection distinction.

**Sound-defaults socket-path resolution (two tiers):**

1. `HERDR_SOCKET_PATH` from env → use it. (Case C — you're inside a specific session; honor whichever one.)
2. Else → `~/.config/herdr/herdr.sock` — the **default session's** socket path, computed deterministically. This is exactly what bare `herdr` resolves to; the SDK matches herdr's own behavior rather than inventing discovery logic.

If the resolved socket file doesn't exist or fails to accept a connection, `HerdrConnectionLive` (and by extension `HerdrSessionLive`) fails at Layer-build time. Fail loud, at startup, not deep in a downstream call.

**Explicit variants for cases the defaults don't cover:**

- `HerdrConnection.layer({ socketPath: "/path/to.sock" })` — arbitrary socket path.
- `HerdrConnection.layer.named("effect-herdr-test-xyz")` — resolve a named session by scanning `herdr session list --json`. Used by the E2E harness to point at its private test session.

**No filesystem enumeration in the sound-defaults path.** `HerdrSessionLive` does path arithmetic against `HERDR_SOCKET_PATH` / `~/.config/herdr/herdr.sock`; it never calls `herdr session list` unless the caller explicitly used `.named()`. Enumeration is an opt-in shape, not a fallback.

**Error surfacing.** Failures bubble implicitly through Effect's typed error channel — the SDK does not proliferate custom error subclasses for every situation. The concrete errors a caller sees are the ones herdr itself reports (mapped from its `ErrorBody.code`) plus transport-level failures (`SocketError` and friends) — see `HerdrProtocolError` open question in the deferred list. `HerdrConnectionLive`'s Layer-build failure is a distinct `HerdrConnectError` (union of "socket file missing" and "socket refused connection"), because a caller has a real remediation choice there (bring the server up vs. debug transport).

**What v1 rules out (repeated for emphasis):**

- Reconnect on socket death. Surfaces on the connection's `disconnects` stream (v1 grilling not yet reached); callers who want reconnect write it themselves.
- Filesystem discovery in the default path. If a user has three named sessions and no default session running, `HerdrSessionLive` fails — they must be explicit with `.named()` or set `HERDR_SOCKET_PATH`.
- A generic `HerdrSessionLive.first-live()` — herdr itself doesn't pick a session that way, and neither should the SDK.

---

## Deferred to grilling

- Full `HerdrRpcs` / `PluginRpcs` group shapes (85 methods, protocol 16, captured in `scripts/herdr-schema.json` — needs curation, not every method is user-facing)
- `Pane` / `Tab` / `Workspace` value-object schemas (what fields, opaque vs. transparent id types)
- `HerdrProtocolError` variants and how they map to herdr's own `ErrorBody.code` strings
- Whether `wait_for_output` and `events.subscribe` share one streaming primitive or two
- PTY / `runInPane` shape from the proposal doc (option 1 vs. option 2 vs. tagged-adapter middle ground)
- Layer-swappable `ChildProcessSpawner` compatibility — build later, only if a real caller needs it
