# effect-herdr — TODO

Known gaps. None of these block the current API from working correctly for
its covered surface — they're the next things worth building.

## 1. Full herdr RPC coverage

herdr's socket protocol has 85 methods (`scripts/herdr-schema.json`,
protocol v17). This SDK now wires up 62:

```
ping, workspace.list/get/create/close/rename/focus/move,
tab.get/create/close/rename/focus/move/list,
pane.list/get/split/focus/close/send_text/read/wait_for_output/
  rename/send_keys/move/swap/resize/zoom/focus_direction/neighbor/edges/
  current/layout/process_info,
session.snapshot, events.subscribe, events.wait,
worktree.list/create/open/remove,
notification.show, integration.install/uninstall,
agent.list/get/read/explain/rename/focus/start/send_keys/prompt/wait/
  view.set/view.clear,
pane.report_agent/report_agent_session/report_metadata/release_agent/
  clear_agent_authority, workspace.report_metadata
```

Everything else is reachable only by dropping to the raw protocol layer
(`session.rpc["method.name"](...)` once you've hand-added it to `HerdrRpcs`) —
there's no ergonomic combinator. Remaining gaps, per the wayfinder map
(issue #13 and its children, all resolved/closed):

- **`pane.send_input`** — the combined text+keys form. Deliberately left
  unwired per issue #16's resolution: no documented ordering semantics for
  combined `text`+`keys` in one call, and the existing `runInPane`+`sendKeys`
  two-round-trip composition already covers the practical cases. Revisit
  only if a caller needs single-round-trip atomicity — needs live-server
  verification, not a schema-only decision.
- **Layout serialization**: `layout.apply/export/set_split_ratio` — whole-tab
  layout snapshot/replay. Deferred per issue #13's map ("Not yet specified")
  — no concrete caller yet to pin the shape down. Distinct from the already-
  wired `pane.layout` (a flat, read-only geometry snapshot, not a portable/
  replayable description).
- **`pane.graphics.set/clear/info`** — inline image protocol into a pane.
  Deferred per issue #21's resolution — plausible case-C fit, but no
  concrete caller yet to pin down the `placement`/format shape.
- **`AgentViewFilter`'s filter DSL** (`all`/`any`/`not`/`eq`/`exists`/`in`,
  used by `agent.view.set`) is wired as an untyped passthrough
  (`Record<string, unknown>`), not a properly modeled recursive schema —
  this effect version (`4.0.0-beta.74`) has no `Schema.suspend`/recursive-
  schema combinator to model the self-referential `all`/`any`/`not`
  variants type-safely. Revisit if/when the effect dependency updates.
- **Plugins**: the entire `plugin.*` namespace (out of scope per issue #1's
  "v2 case A" deferral — plugins are a v2 concept, not a v1 gap).
- **Ruled out of scope** (per issue #21's resolution): `client.window_title.*`,
  `server.*`, `popup.close` — host-app/terminal-chrome territory, no
  plausible case-B/C caller.
- **No snapshot combinators yet** for the newer identity types:
  `snapshotWorkspace`/`snapshotTab` (flagged in issue #14's resolution) —
  `createWorkspace`/`createTab`/`createWorktree`/`openWorktree` all return
  bare identity with nothing to re-fetch fresh state from yet.

Adding a method is mechanical: a wire-schema class in `protocol/HerdrRpcs.ts`
(reuse an existing result shape where the wire actually reuses one — check
against `scripts/herdr-schema.json` before assuming a new shape is needed),
an `Rpc.make(...)` entry, and — if it deserves an ergonomic combinator, not
just raw-`rpc` access — a function in the matching `operations/*.ts` file.

## 2. `events.wait` only matches pane agent status

`waitForEvent` wraps `events.wait`, whose schema (`scripts/herdr-schema.json`,
protocol v17) advertises an `EventMatch` union covering every lifecycle event —
`workspace_closed`, `tab_closed`, `pane_closed`, `*_renamed`, `*_focused`, and
so on. **The server does not implement most of them.** Verified against herdr
0.7.5 (protocol 17): a `workspace_closed` match is rejected outright with

```
HerdrProtocolError { code: "unsupported_event_wait_match",
  rawMessage: "events.wait currently supports pane agent status matches" }
```

So `waitForEvent` is usable today only for pane agent-status matches, despite
its type admitting far more. The schema is aspirational here, not descriptive.

The workaround, and what `operations/claim.ts` does: subscribe to the push
stream (`HerdrConnection.subscribeEvents(["workspace.closed"])`) and filter
client-side. That path *does* deliver every close event, with the resource id
in the payload. Worth either narrowing `EventMatch` to what the server really
accepts, or keeping the wide type and documenting the runtime failure on the
combinator — currently a caller only finds out at runtime.

## 3. High-fidelity real-time pane content back to the controller

`waitForOutput` is single-shot: it blocks (on herdr's side) until one match,
then resolves. There's no way to keep receiving a pane's output as it's
produced — e.g. tailing a log file running inside a controlled pane and
piping each new line back into the controller program as it appears.

herdr's wire doesn't have a dedicated "stream this pane's output forever"
method, but two pieces already in this SDK compose toward it:

- **`events.subscribe`** already supports `pane.output_matched` as one of its
  subscribable event kinds (same mechanism `focusedPaneRef` uses for
  `pane.focused`) — a persistent connection that pushes a match event
  whenever a *subscribed* `pane.wait_for_output`-style pattern fires.
- **`pane.wait_for_output`** itself could be called in a loop (each call
  re-issued with `source: "recent"` immediately after the previous one
  resolves) to approximate continuous tailing, at the cost of a per-match
  round-trip rather than a true push stream.

The honest gap: neither of these is currently exposed as a combinator that
returns an unbounded `Stream<string>` the way a real "tail -f" primitive
would. Building `tailPane(pane, match): Stream<string, ..., HerdrSession>`
on top of `events.subscribe`'s `pane.output_matched` events (same
`Stream.callback`/`Queue` pattern `focusedPaneRef` and `HerdrEventsSocket`
already use) is the natural next step — verify herdr's `pane.output_matched`
event actually fires repeatedly for a genuinely long-running match (e.g. an
active `tail -f`) rather than once per `wait_for_output`-style call before
assuming the push-based approach works unbounded; this needs a live check
against a real herdr server, not just a schema read.
