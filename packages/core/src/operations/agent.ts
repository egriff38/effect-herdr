/**
 * Combinators for inspecting and controlling herdr's tracked agents.
 *
 * Every combinator here operates on `AgentTarget` identity — an opaque
 * string that herdr resolves server-side to either a `PaneId` or a
 * caller-assigned name, confirmed empirically this can't be disambiguated
 * client-side. This is a different identity axis from `agentReporting.ts`
 * (self-reporting a pane's own agent state, addressed by `PaneId`/
 * `WorkspaceId` directly, not `AgentTarget`).
 *
 * @since 0.1.0
 */

import { DateTime, Effect, Function, Predicate } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import { HerdrProtocolError, WaitError } from "../protocol/errors.js"
import type { AgentInfoWire, AgentViewSortWire } from "../protocol/HerdrRpcs.js"
import type {
  Agent,
  AgentSnapshot,
  AgentStatus,
  AgentTarget,
  AgentTargetId,
  PaneId,
  TabId,
  WorkspaceId,
} from "../protocol/schemas.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

/**
 * `setAgentView`'s `filter` option shape — an untyped passthrough for
 * herdr's filter DSL (see the wire-level `AgentViewFilter`'s doc comment
 * in `HerdrRpcs.ts` for why).
 *
 * @category models
 * @since 0.1.0
 */
export type AgentViewFilterEncoded = Readonly<Record<string, unknown>>

// Decodes herdr's agent wire shape into an `AgentSnapshot`; `capturedAt` is stamped via Effect's Clock, not the wire.
const decodeAgentSnapshot = (wire: AgentInfoWire): Effect.Effect<AgentSnapshot> =>
  Effect.map(DateTime.now, (capturedAt) => ({
    target: wire.pane_id as AgentTargetId,
    paneId: wire.pane_id as PaneId,
    tabId: wire.tab_id as TabId,
    workspaceId: wire.workspace_id as WorkspaceId,
    revision: wire.revision,
    focused: wire.focused,
    agentStatus: wire.agent_status,
    agent: (wire.agent ?? undefined) as Agent | undefined,
    agentSessionId: wire.agent_session?.value ?? undefined,
    cwd: wire.cwd ?? undefined,
    displayAgent: wire.display_agent ?? undefined,
    name: wire.name ?? undefined,
    title: wire.title ?? undefined,
    stateLabels: wire.state_labels ?? {},
    tokens: wire.tokens ?? {},
    capturedAt,
  }))

const isAgentTargetArg = (u: unknown): u is AgentTarget => Predicate.hasProperty(u, "target")

/**
 * Lists every agent herdr currently tracks, across every workspace.
 *
 * **Example** (listing agents)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listAgents } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agents = yield* listAgents
 *   yield* Effect.log(agents.map((a) => a.name))
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const listAgents: Effect.Effect<
  ReadonlyArray<AgentSnapshot>,
  HerdrProtocolError | RpcClientError,
  HerdrSession
> = Effect.gen(function*() {
  const session = yield* HerdrSession
  const result = yield* session.rpc["agent.list"]()
  return yield* Effect.all(result.agents.map(decodeAgentSnapshot))
})

/**
 * Reads an agent's current state from herdr. Round-trips on every call —
 * the returned `AgentSnapshot` is fresh as of this call, never cached.
 *
 * **Example** (snapshotting an agent by name)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, snapshotAgent } from "effect-herdr"
 * import type { AgentTargetId } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agent = yield* snapshotAgent({ target: "my-agent" as AgentTargetId })
 *   return agent.agentStatus
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const snapshotAgent = (
  agent: AgentTarget,
): Effect.Effect<AgentSnapshot, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["agent.get"]({ target: agent.target })
    return yield* decodeAgentSnapshot(result.agent)
  })

/**
 * Renames `agent`'s display name. `name: undefined` (or omitted) clears
 * it. Returns the mutated agent's fresh `AgentSnapshot` — unlike
 * `renamePane`, `agent.rename`'s reply is a real state echo worth
 * surfacing, not a bare ack. Dual-shaped: data-first
 * (`renameAgent(agent, name)`) and data-last
 * (`agent.pipe(renameAgent(name))`).
 *
 * **Example** (renaming an agent)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listAgents, renameAgent } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agents = yield* listAgents
 *   const first = agents[0]
 *   if (!first) return
 *   yield* renameAgent(first, "worker-1")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const renameAgent: {
  (agent: AgentTarget, name?: string): Effect.Effect<AgentSnapshot, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    name?: string,
  ): (agent: AgentTarget) => Effect.Effect<AgentSnapshot, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isAgentTargetArg(args[0]),
  (agent: AgentTarget, name?: string) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const result = yield* session.rpc["agent.rename"]({ target: agent.target, name })
      return yield* decodeAgentSnapshot(result.agent)
    }),
)

/**
 * Focuses `agent`'s pane. Returns the focused agent's fresh
 * `AgentSnapshot` — unlike `focusPane`, `agent.focus`'s reply is a real
 * state echo worth surfacing, not a bare ack. Not dual-shaped — focus is
 * a global mutation, mirrors `focusPane`'s own non-dual precedent.
 *
 * **Example** (focusing an agent)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listAgents, focusAgent } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agents = yield* listAgents
 *   const first = agents[0]
 *   if (!first) return
 *   yield* focusAgent(first)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const focusAgent = (
  agent: AgentTarget,
): Effect.Effect<AgentSnapshot, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["agent.focus"]({ target: agent.target })
    return yield* decodeAgentSnapshot(result.agent)
  })

/**
 * Options for `startAgent`.
 *
 * @category models
 * @since 0.1.0
 */
export interface StartAgentOptions {
  readonly args?: ReadonlyArray<string>
  readonly timeout?: number
}

/**
 * Starts a known interactive agent `kind` (e.g. `"claude"`) named `name`
 * inside `pane`. Not dual-shaped — no receiver identity to pipe against,
 * mirrors `createWorkspace`/`createTab`. Returns the started agent's
 * fresh `AgentSnapshot`.
 *
 * **Example** (starting an agent in the current pane)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, startAgent } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   const agent = yield* startAgent({ name: "worker", kind: "claude", paneId: pane.value.id })
 *   yield* Effect.log(agent.agentStatus)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const startAgent = (
  options: { readonly name: string; readonly kind: string; readonly paneId: PaneId } & StartAgentOptions,
): Effect.Effect<AgentSnapshot, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["agent.start"]({
      name: options.name,
      kind: options.kind,
      pane_id: options.paneId,
      args: options.args as Array<string> | undefined,
      timeout_ms: options.timeout,
    })
    return yield* decodeAgentSnapshot(result.agent)
  })

/**
 * Options for `readAgent`.
 *
 * @category models
 * @since 0.1.0
 */
export interface ReadAgentOptions {
  readonly source?: "visible" | "recent" | "recent_unwrapped" | "detection"
  readonly lines?: number
  readonly format?: "text" | "ansi"
  readonly stripAnsi?: boolean
}

/**
 * Reads `agent`'s buffered terminal output — the same wire primitive
 * `pane.read` uses, resolved by agent target instead of pane id.
 * Dual-shaped: data-first (`readAgent(agent, options?)`) and data-last
 * (`agent.pipe(readAgent(options?))`).
 *
 * **Example** (reading an agent's recent output)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listAgents, readAgent } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agents = yield* listAgents
 *   const first = agents[0]
 *   if (!first) return
 *   const text = yield* readAgent(first)
 *   yield* Effect.log(text)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const readAgent: {
  (
    agent: AgentTarget,
    options?: ReadAgentOptions,
  ): Effect.Effect<string, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    options?: ReadAgentOptions,
  ): (agent: AgentTarget) => Effect.Effect<string, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isAgentTargetArg(args[0]),
  (agent: AgentTarget, options?: ReadAgentOptions) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const result = yield* session.rpc["agent.read"]({
        target: agent.target,
        source: options?.source ?? "recent",
        lines: options?.lines,
        format: options?.format,
        strip_ansi: options?.stripAnsi,
      })
      return result.read.text
    }),
)

/**
 * Sends raw named key presses (e.g. `"Up"`, `"Ctrl+c"`) to `agent`'s
 * pane — the same wire primitive `sendKeys` uses on `pane.ts`, resolved
 * by agent target instead of pane identity. Kept as its own combinator
 * rather than reusing `sendKeys`: `AgentTarget` resolves by name, which
 * has no `Pane` value to call `sendKeys` on without a `snapshotAgent`
 * round-trip first. Dual-shaped: data-first
 * (`sendAgentKeys(agent, keys)`) and data-last
 * (`agent.pipe(sendAgentKeys(keys))`).
 *
 * **Example** (sending Enter to an agent)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listAgents, sendAgentKeys } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agents = yield* listAgents
 *   const first = agents[0]
 *   if (!first) return
 *   yield* sendAgentKeys(first, ["Enter"])
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const sendAgentKeys: {
  (
    agent: AgentTarget,
    keys: ReadonlyArray<string>,
  ): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    keys: ReadonlyArray<string>,
  ): (agent: AgentTarget) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isAgentTargetArg(args[0]),
  (agent: AgentTarget, keys: ReadonlyArray<string>) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["agent.send_keys"]({ target: agent.target, keys: keys as Array<string> })
    }),
)

/**
 * Options for `promptAgent`. `wait`, if given, blocks the reply until the
 * agent reaches one of `wait.until`'s statuses or `wait.timeout` elapses.
 *
 * @category models
 * @since 0.1.0
 */
export interface PromptAgentOptions {
  readonly wait?: { readonly until?: ReadonlyArray<AgentStatus>; readonly timeout?: number }
}

/**
 * Submits `text` to `agent`'s active generation — a structured prompt
 * call, distinct from `sendAgentKeys`'s raw key input. Dual-shaped:
 * data-first (`promptAgent(agent, text, options?)`) and data-last
 * (`agent.pipe(promptAgent(text, options?))`).
 *
 * **Example** (prompting an agent and waiting for idle)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listAgents, promptAgent } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agents = yield* listAgents
 *   const first = agents[0]
 *   if (!first) return
 *   yield* promptAgent(first, "summarize the last 5 lines", { wait: { until: ["idle"] } })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const promptAgent: {
  (
    agent: AgentTarget,
    text: string,
    options?: PromptAgentOptions,
  ): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
  (
    text: string,
    options?: PromptAgentOptions,
  ): (agent: AgentTarget) => Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isAgentTargetArg(args[0]),
  (agent: AgentTarget, text: string, options?: PromptAgentOptions) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      yield* session.rpc["agent.prompt"]({
        target: agent.target,
        text,
        wait: options?.wait && {
          until: options.wait.until as Array<AgentStatus> | undefined,
          timeout_ms: options.wait.timeout,
        },
      })
    }),
)

/**
 * Debug-only explanation of herdr's agent-detection state for `agent`.
 * The reply shape is deliberately untyped (herdr's own schema marks
 * `explain` as opaque debug output) — decoded as `unknown`. Single-arg
 * read, not dual-shaped.
 *
 * **Example** (explaining detection state)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listAgents, explainAgent } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agents = yield* listAgents
 *   const first = agents[0]
 *   if (!first) return
 *   const explain = yield* explainAgent(first)
 *   yield* Effect.log(explain)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category accessors
 * @since 0.1.0
 */
export const explainAgent = (
  agent: AgentTarget,
): Effect.Effect<unknown, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["agent.explain"]({ target: agent.target })
    return result.explain
  })

/**
 * Options for `waitForAgentStatus`.
 *
 * @category models
 * @since 0.1.0
 */
export interface WaitForAgentStatusOptions {
  readonly until?: ReadonlyArray<AgentStatus>
  readonly timeout?: number
}

/**
 * Blocks until `agent` reaches one of `options.until`'s statuses (default
 * `idle`/`done`/`blocked` per herdr's own default), or `options.timeout`
 * elapses — a plain blocking request/reply, the same family as
 * `waitForOutput`/`waitForEvent`, not a subscription. On timeout, fails
 * with `WaitError({ reason: "timeout" })`. Dual-shaped: data-first
 * (`waitForAgentStatus(agent, options?)`) and data-last
 * (`agent.pipe(waitForAgentStatus(options?))`).
 *
 * **Example** (waiting for an agent to finish)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, listAgents, waitForAgentStatus } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const agents = yield* listAgents
 *   const first = agents[0]
 *   if (!first) return
 *   const snapshot = yield* waitForAgentStatus(first, { until: ["idle"] })
 *   yield* Effect.log(snapshot.agentStatus)
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const waitForAgentStatus: {
  (
    agent: AgentTarget,
    options?: WaitForAgentStatusOptions,
  ): Effect.Effect<AgentSnapshot, HerdrProtocolError | WaitError | RpcClientError, HerdrSession>
  (
    options?: WaitForAgentStatusOptions,
  ): (
    agent: AgentTarget,
  ) => Effect.Effect<AgentSnapshot, HerdrProtocolError | WaitError | RpcClientError, HerdrSession>
} = Function.dual(
  (args) => isAgentTargetArg(args[0]),
  (agent: AgentTarget, options?: WaitForAgentStatusOptions) =>
    Effect.gen(function*() {
      const session = yield* HerdrSession
      const result = yield* session.rpc["agent.wait"]({
        target: agent.target,
        until: options?.until as Array<AgentStatus> | undefined,
        timeout_ms: options?.timeout,
      }).pipe(
        Effect.catchTag("HerdrProtocolError", (error): Effect.Effect<never, HerdrProtocolError | WaitError> =>
          error.code === "timeout"
            ? Effect.fail(new WaitError({ reason: "timeout" }))
            : Effect.fail(error)),
      )
      return yield* decodeAgentSnapshot(result.agent)
    }),
)

/**
 * Options for `setAgentView`. `filter` is passed through untyped —
 * herdr's filter DSL (`all`/`any`/`not`/`eq`/`exists`/`in`) isn't fully
 * modeled by this SDK yet (see `agent.ts`'s module doc); build the filter
 * object by hand against herdr's documented shape.
 *
 * @category models
 * @since 0.1.0
 */
export interface SetAgentViewOptions {
  readonly filter?: AgentViewFilterEncoded
  readonly label?: string
  readonly sort?: ReadonlyArray<{ readonly field: string; readonly order?: "asc" | "desc" }>
}

/**
 * Configures a named agent-list view's filter/sort for `source`. Not
 * dual-shaped — `source` is the primary key, not a receiver identity.
 *
 * **Example** (setting a view)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, setAgentView } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   yield* setAgentView("my-harness", { label: "blocked agents" })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const setAgentView = (
  source: string,
  options?: SetAgentViewOptions,
): Effect.Effect<{ readonly active: boolean }, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    const result = yield* session.rpc["agent.view.set"]({
      source,
      filter: options?.filter,
      label: options?.label,
      sort: options?.sort as Array<AgentViewSortWire> | undefined,
    })
    return { active: result.active }
  })

/**
 * Clears a named agent-list view's configuration for `source` (or every
 * source if omitted). Not dual-shaped.
 *
 * **Example** (clearing a view)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, clearAgentView } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   yield* clearAgentView("my-harness")
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const clearAgentView = (
  source?: string,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["agent.view.clear"]({ source })
  })
