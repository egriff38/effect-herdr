/**
 * Combinators for self-reporting a pane's or workspace's own agent state
 * into herdr — the reverse direction from every other combinator in this
 * SDK, which reads/commands OTHER panes rather than reporting the
 * caller's own state. Confirmed reachable equally from case B (external
 * harness, no herdr pane of its own) and case C (an agent running inside
 * a herdr-managed pane): `source` is an opaque caller string with no
 * ownership validation tying a report to the calling process's own pane.
 *
 * Different identity axis from `agent.ts`: these combinators address a
 * `PaneId`/`WorkspaceId` directly, never an `AgentTarget` — a custom
 * harness self-reporting has no assigned agent name to resolve by.
 *
 * `seq` (herdr's per-`(pane_id, source)` ordering counter — a stale or
 * duplicate value is silently ignored server-side, confirmed empirically)
 * is never a public parameter here. This module tracks it internally,
 * per `(targetId, source)`, incrementing before every dispatch — a
 * caller using this SDK's request-per-call transport has no way to
 * *cause* out-of-order delivery in the first place, so exposing `seq`
 * publicly would only be a footgun.
 *
 * @since 0.1.0
 */

import { Effect } from "effect"
import { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { Agent, AgentStatus, Pane, Workspace } from "../protocol/schemas.js"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"

// Internal per-(targetId, source) monotonic seq counter — never exposed publicly (see module doc).
const seqCounters = new Map<string, number>()

const nextSeq = (targetId: string, source: string): number => {
  const key = `${targetId}:${source}`
  const next = (seqCounters.get(key) ?? 0) + 1
  seqCounters.set(key, next)
  return next
}

/**
 * The self-reportable subset of `AgentStatus` — `"done"` is
 * detection-derived and never legitimately self-reported.
 *
 * @category models
 * @since 0.1.0
 */
export type ReportableAgentState = Exclude<AgentStatus, "done">

/**
 * Options for `startAgentSession`.
 *
 * @category models
 * @since 0.1.0
 */
export interface StartAgentSessionOptions {
  readonly agentSessionId?: string
  readonly agentSessionPath?: string
  readonly sessionStartSource?: string
}

/**
 * Reports a pane's agent-session identity — state-independent bookkeeping
 * that doesn't affect waits/notifications/rollups, typically called once
 * at the start of a fresh agent generation, before the first
 * `reportAgentState` call. Not dual-shaped — `pane` plus a report payload
 * is a create-style call, mirrors `createWorkspace`'s non-dual
 * precedent, not a rename-style relation.
 *
 * **Example** (starting a session)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, startAgentSession } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* startAgentSession(pane.value, { source: "my-harness", agent: "claude" })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const startAgentSession = (
  pane: Pane,
  options: { readonly source: string; readonly agent: Agent } & StartAgentSessionOptions,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["pane.report_agent_session"]({
      pane_id: pane.id,
      source: options.source,
      agent: options.agent,
      agent_session_id: options.agentSessionId,
      agent_session_path: options.agentSessionPath,
      session_start_source: options.sessionStartSource,
      seq: nextSeq(pane.id, options.source),
    })
  })

/**
 * Options for `reportAgentState`.
 *
 * @category models
 * @since 0.1.0
 */
export interface ReportAgentStateOptions {
  readonly message?: string
  readonly agentSessionId?: string
  readonly agentSessionPath?: string
}

/**
 * Reports a pane's agent lifecycle state — the only self-reporting call
 * that drives herdr's waits/notifications/rollups. Not dual-shaped, same
 * reasoning as `startAgentSession`.
 *
 * **Example** (reporting working state)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, reportAgentState } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* reportAgentState(pane.value, { source: "my-harness", agent: "claude", state: "working" })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const reportAgentState = (
  pane: Pane,
  options: {
    readonly source: string
    readonly agent: Agent
    readonly state: ReportableAgentState
  } & ReportAgentStateOptions,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["pane.report_agent"]({
      pane_id: pane.id,
      source: options.source,
      agent: options.agent,
      state: options.state,
      message: options.message,
      agent_session_id: options.agentSessionId,
      agent_session_path: options.agentSessionPath,
      seq: nextSeq(pane.id, options.source),
    })
  })

/**
 * Options for `reportPaneMetadata`. Token-map constraints (from herdr's
 * docs): max 16 keys per report, max 32 distinct `source` values retained
 * per pane lifetime — **not released by clearing or expiry** — a
 * long-running harness cycling `source` values (e.g. per-request UUIDs)
 * will silently exhaust this cap. `ttl` is milliseconds, 1–86,400,000.
 *
 * @category models
 * @since 0.1.0
 */
export interface ReportPaneMetadataOptions {
  readonly agent?: string
  readonly appliesToSource?: string
  readonly displayAgent?: string
  readonly title?: string
  readonly stateLabels?: Readonly<Record<string, string>>
  readonly tokens?: Readonly<Record<string, string | null>>
  readonly ttl?: number
  readonly clearDisplayAgent?: boolean
  readonly clearTitle?: boolean
  readonly clearStateLabels?: boolean
}

/**
 * Reports display-only pane metadata — title, labels, tokens. Never
 * drives semantic agent state (that's `reportAgentState`'s `state`
 * field). Not dual-shaped, same reasoning as `startAgentSession`.
 *
 * **Example** (reporting a title)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, reportPaneMetadata } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* reportPaneMetadata(pane.value, { source: "my-harness", title: "Building feature X" })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const reportPaneMetadata = (
  pane: Pane,
  options: { readonly source: string } & ReportPaneMetadataOptions,
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["pane.report_metadata"]({
      pane_id: pane.id,
      source: options.source,
      agent: options.agent,
      applies_to_source: options.appliesToSource,
      display_agent: options.displayAgent,
      title: options.title,
      state_labels: options.stateLabels,
      tokens: options.tokens,
      ttl_ms: options.ttl,
      clear_display_agent: options.clearDisplayAgent,
      clear_title: options.clearTitle,
      clear_state_labels: options.clearStateLabels,
      seq: nextSeq(pane.id, options.source),
    })
  })

/**
 * Reports display-only workspace metadata — tokens only, same token-map
 * contract as `reportPaneMetadata`. Not dual-shaped.
 *
 * **Example** (reporting workspace tokens)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentWorkspace, reportWorkspaceMetadata } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const workspace = yield* currentWorkspace
 *   if (Option.isNone(workspace)) return
 *   yield* reportWorkspaceMetadata(workspace.value, { source: "my-harness", tokens: { cost_usd: "0.42" } })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const reportWorkspaceMetadata = (
  workspace: Workspace,
  options: {
    readonly source: string
    readonly tokens: Readonly<Record<string, string | null>>
    readonly ttl?: number
  },
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["workspace.report_metadata"]({
      workspace_id: workspace.id,
      source: options.source,
      tokens: options.tokens,
      ttl_ms: options.ttl,
      seq: nextSeq(workspace.id, options.source),
    })
  })

/**
 * Deregisters `agent` from `pane` entirely — a subsequent `agent.get` on
 * that pane 404s with `agent_not_found`. Confirmed empirically against a
 * live herdr server; a stronger effect than `clearAgentAuthority`. Not
 * dual-shaped, same reasoning as `startAgentSession`.
 *
 * **Example** (releasing an agent)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, releaseAgent } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* releaseAgent(pane.value, { source: "my-harness", agent: "claude" })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const releaseAgent = (
  pane: Pane,
  options: { readonly source: string; readonly agent: Agent },
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["pane.release_agent"]({
      pane_id: pane.id,
      source: options.source,
      agent: options.agent,
      seq: nextSeq(pane.id, options.source),
    })
  })

/**
 * Drops `options.source`'s live-status claim on `pane`'s agent state,
 * resetting `agent_status` back to `unknown`. Confirmed empirically:
 * scoped strictly to the calling `source` — clearing a *different*
 * source's authority is a no-op (`ok`, but state is unchanged). Not
 * dual-shaped, same reasoning as `startAgentSession`.
 *
 * **Example** (clearing this source's authority)
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HerdrSession, currentPane, clearAgentAuthority } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* currentPane
 *   if (Option.isNone(pane)) return
 *   yield* clearAgentAuthority(pane.value, { source: "my-harness" })
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const clearAgentAuthority = (
  pane: Pane,
  options?: { readonly source?: string },
): Effect.Effect<void, HerdrProtocolError | RpcClientError, HerdrSession> =>
  Effect.gen(function*() {
    const session = yield* HerdrSession
    yield* session.rpc["pane.clear_agent_authority"]({
      pane_id: pane.id,
      source: options?.source,
      seq: options?.source ? nextSeq(pane.id, options.source) : undefined,
    })
  })
