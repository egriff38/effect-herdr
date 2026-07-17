# effect-herdr

Typed Effect-TS SDK for [herdr](https://herdr.dev), the terminal-native agent multiplexer.

## Language

### Herdr's own model — three distinct things easy to conflate

**Session**:
A named on-disk configuration under `~/.config/herdr/[sessions/<name>/]`. Persists across restarts. May or may not have a running server. Two flavors — see below.
_Avoid_: "instance", conflating with server or connection

**Default session**:
The unnamed singleton session at `~/.config/herdr/` (session_dir = config root, not a subdirectory). Bare `herdr` always resolves to this one. Reported by `herdr session list` as `"default": true`. Socket path: `~/.config/herdr/herdr.sock`.
_Avoid_: "primary", "main", "root session"

**Named session**:
Any session created via `herdr --session <name>` or `herdr session attach <name>`. Lives at `~/.config/herdr/sessions/<name>/` with its own private socket. Reported by `session list` as `"default": false`.
_Avoid_: "custom session", "extra session"

**Server**:
A running herdr daemon attached to one session. Alive while the daemon is running; dies on crash, `session stop`, or reboot. Reported by `session list` as `"running": true` and by `herdr status server`. A session can have zero or one attached servers at a time.
_Avoid_: "instance", "daemon" (fine as a mental model, but not the term of art)

**Connection**:
A live open unix-socket connection from a client to a running server. The SDK opens these; a server can have many. Alive from `Socket` acquire until release; dies with either endpoint.
_Avoid_: "socket" (that's the transport primitive, not the connection)

### Herdr's own hierarchy inside a session

**Pane / Tab / Workspace**:
Herdr's own tree — a Pane is one PTY, a Tab groups Panes, a Workspace groups Tabs. Every id is public and opaque (see `packages/core` types); ids can compact after close, so freshness matters.
_Avoid_: "window" (ambiguous with the terminal emulator's window)

### Consumer cases the SDK is designed for

**Case C consumer** (primary):
An agent running *inside* a herdr-managed pane (`HERDR_ENV=1`) that scripts sibling panes through herdr's socket. Drives all v1 ergonomic choices.
_Avoid_: "inner agent", "in-pane user"

**Case B consumer**:
External automation opening the socket from *outside* any herdr-managed pane (e.g. the E2E harness, a CI runner). Uses the raw protocol layer directly; no service-layer needs.
_Avoid_: "external client", "headless caller"

**Case A consumer** (deferred to v2):
A herdr plugin — code herdr launches under its own manifest, expected to answer reverse-RPC action/event/pane invocations. Requires the symmetric-duplex `PluginRpcs` half not shipped in v1.
_Avoid_: "plugin author", "extension"

### SDK's own layers

**Protocol layer**:
The typed `RpcGroup` (`HerdrRpcs`) that mirrors herdr's socket API 1:1. Exposed as-is; case B lives here.
_Avoid_: "wire layer", "transport layer" (transport is the socket itself)

**Service layer**:
The ergonomic `Context.Service` (`HerdrSession`) built on top of the protocol layer, exposing domain verbs like `splitPane(pane)`. Case C's whole story.
_Avoid_: "SDK layer", "wrapper"
