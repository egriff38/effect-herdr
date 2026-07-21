# effect-herdr — TODO

Known gaps. None of these block the current API from working correctly for
its covered surface — they're the next things worth building.

## 1. Full herdr RPC coverage

herdr's socket protocol has 85 methods (`scripts/herdr-schema.json`, protocol
v16). This SDK currently wires up 14:

```
ping, workspace.list, workspace.get, tab.get, pane.list, pane.get,
pane.split, pane.focus, pane.close, pane.send_text, pane.read,
pane.wait_for_output, session.snapshot, events.subscribe
```

Everything else is reachable only by dropping to the raw protocol layer
(`session.rpc["method.name"](...)` once you've hand-added it to `HerdrRpcs`) —
there's no ergonomic combinator. Notably missing:

- **Workspace/tab/pane lifecycle**: `workspace.create/close/focus/rename/move`,
  `tab.create/close/focus/rename/move/list`, `pane.move/swap/rename/resize/zoom`.
- **Layout**: `pane.layout`, `layout.apply/export/set_split_ratio`, `pane.edges`,
  `pane.neighbor`, `pane.focus_direction`.
- **Agent introspection**: `agent.list/get/read/explain/send/start/rename/focus`,
  `pane.report_agent/report_agent_session/release_agent/clear_agent_authority`.
- **Worktrees**: `worktree.create/list/open/remove`.
- **Plugins**: the entire `plugin.*` namespace (out of scope per issue #1's
  "v2 case A" deferral — plugins are a v2 concept, not a v1 gap).
- **Misc**: `pane.graphics.*`, `client.window_title.*`, `notification.show`,
  `popup.close`, `server.*`, `integration.*`.

Adding a method is mechanical: a wire-schema class in `protocol/HerdrRpcs.ts`
(reuse an existing result shape where the wire actually reuses one — check
against `scripts/herdr-schema.json` before assuming a new shape is needed),
an `Rpc.make(...)` entry, and — if it deserves an ergonomic combinator, not
just raw-`rpc` access — a function in the matching `operations/*.ts` file.

## 2. PTY input beyond typed text

`runInPane` sends printable text via `pane.send_text` — there is no way to
send arrow keys, `Ctrl-C`, `Tab`-completion, or any other control sequence.
herdr's wire already has the primitives for this:

- **`pane.send_keys`** — `{ pane_id, keys: string[] }`, a list of named keys
  (arrow keys, function keys, modifiers) rather than literal characters.
- **`pane.send_input`** — `{ pane_id, text?, keys? }`, a combined form.

Neither is wired into `HerdrRpcs` yet. The natural shape once they land:
something like `sendKeys(pane, ["Up", "Up", "Enter"])`, distinct from
`runInPane`'s "type this text" semantics — a real design question is whether
that's a new combinator or a third `runInPane` overload taking a structured
key-sequence type instead of a string/`Stream<string>`; the latter risks
overloading one function with too many unrelated shapes.

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
