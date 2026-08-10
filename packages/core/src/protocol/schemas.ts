/**
 * Value objects for the herdr socket protocol.
 *
 * Split into IDENTITY types (`Pane`/`Tab`/`Workspace` — small, stable,
 * safe to hold onto long-term) and SNAPSHOT types (`PaneSnapshot`/
 * `TabSnapshot`/`WorkspaceSnapshot` — point-in-time captures of mutable
 * state such as `cwd`, `agent`, `agentStatus`, `focused`). Combinators in
 * `operations/` return identity after a mutation and snapshots after a
 * read — re-fetch a snapshot whenever you need fresh state.
 *
 * @since 0.1.0
 */
import { DateTime, Equal, Hash, Option, Order } from "effect"

/**
 * Opaque branded id for a workspace. Safe to pass around; herdr never
 * reuses a closed workspace's id.
 *
 * @category models
 * @since 0.1.0
 */
export type WorkspaceId = string & { readonly _brand: "WorkspaceId" }

/**
 * Opaque branded id for a tab. Safe to pass around; herdr never reuses a
 * closed tab's id.
 *
 * @category models
 * @since 0.1.0
 */
export type TabId = string & { readonly _brand: "TabId" }

/**
 * Opaque branded id for a pane. Safe to pass around; herdr never reuses a
 * closed pane's id.
 *
 * @category models
 * @since 0.1.0
 */
export type PaneId = string & { readonly _brand: "PaneId" }

// =============================================================================
// Known-agent open list
// =============================================================================

/**
 * Agent names herdr recognizes out of the box.
 *
 * @category models
 * @since 0.1.0
 */
export type KnownAgent =
  | "claude"
  | "codex"
  | "omp"
  | "pi"
  | "opencode"
  | "aider"
  | "amp"
  | "cursor-agent"
  | "copilot"
  | "devin"
  | "droid"
  | "kimi"
  | "qoder"
  | "kilo"
  | "hermes"
  | "mastracode"

/**
 * Any agent name herdr reports — {@link KnownAgent} plus an open tail for
 * agents not yet enumerated.
 *
 * @category models
 * @since 0.1.0
 */
export type Agent = KnownAgent | (string & {})

/**
 * The lifecycle state herdr tracks for a pane, tab, or workspace's agent.
 *
 * @category models
 * @since 0.1.0
 */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown"

// =============================================================================
// Identity types — stable references
// =============================================================================

/**
 * The symbol every herdr identity value carries, tagging it as a pane, tab,
 * or workspace.
 *
 * `Pane`, `Tab`, and `Workspace` are structurally nested — a `Pane` has
 * every field a `Tab` has, which has every field a `Workspace` has — so
 * field-presence checks cannot tell them apart. Polymorphic combinators
 * (`claim`, `focus`, `close`) discriminate on this tag instead.
 *
 * @category symbols
 * @since 0.1.0
 */
export const EntityTypeId: unique symbol = Symbol.for("effect-herdr/Entity")

/**
 * The type of {@link EntityTypeId}.
 *
 * @category symbols
 * @since 0.1.0
 */
export type EntityTypeId = typeof EntityTypeId

/**
 * Which kind of herdr resource an identity value refers to.
 *
 * @category models
 * @since 0.1.0
 */
export type EntityKind = "pane" | "tab" | "workspace"

/**
 * The trait shared by `Pane`, `Tab`, and `Workspace`: a discriminating tag
 * plus structural equality and ordering keyed on the resource's id.
 *
 * @category models
 * @since 0.1.0
 */
export interface Entity<K extends EntityKind = EntityKind> extends Equal.Equal {
  readonly [EntityTypeId]: K
  readonly id: string
}

const EntityProto = {
  [Equal.symbol](this: Entity, that: unknown): boolean {
    return isEntity(that) && that[EntityTypeId] === this[EntityTypeId] && that.id === this.id
  },
  [Hash.symbol](this: Entity): number {
    return Hash.combine(Hash.string(this.id))(Hash.string(this[EntityTypeId]))
  },
}

// The kind tag lives on the prototype, not as an own property, so a spread
// (`{ ...pane }`) drops it along with the Equal/Hash methods, rather than
// copying the tag alone into a half-entity that compares by reference.
//
// Note this is a RUNTIME distinction, not a compile-time one: TypeScript still
// considers `{ ...pane }` assignable to `Pane` (it tracks the symbol-keyed
// property through the spread even though JS does not copy it), so the spread
// typechecks and then fails `isPane` at runtime. Combinators that switch on the
// tag therefore need an explicit fallback rather than relying on exhaustiveness
// — see `assertEntity` in `operations/entity.ts`.
const entityProtoFor = <K extends EntityKind>(kind: K) =>
  Object.assign(Object.create(EntityProto), { [EntityTypeId]: kind }) as Entity<K>

const PaneProto = entityProtoFor("pane")
const TabProto = entityProtoFor("tab")
const WorkspaceProto = entityProtoFor("workspace")

/**
 * Whether a value is a herdr identity value (`Pane`, `Tab`, or `Workspace`).
 *
 * @category refinements
 * @since 0.1.0
 */
export const isEntity = (u: unknown): u is Entity =>
  typeof u === "object" && u !== null && EntityTypeId in u

/**
 * Orders identity values by id, then by kind.
 *
 * The kind tiebreak keeps this **coherent with `Equal`/`Hash`**, which both mix
 * in kind: without it a same-id `Workspace` and `Tab` would order as equal
 * (`0`) while comparing and hashing as distinct, so a sorted structure and a
 * `HashSet` would disagree about whether they are the same element. Ids sort
 * lexicographically, which for herdr's `w1:t1:p1` scheme is also a stable,
 * human-meaningful order.
 *
 * @category ordering
 * @since 0.1.0
 */
export const EntityOrder: Order.Order<Entity> = Order.combine(
  Order.mapInput(Order.String, (entity: Entity) => entity.id),
  Order.mapInput(Order.String, (entity: Entity) => entity[EntityTypeId]),
)

/**
 * A pane's stable identity: its own id plus the tab/workspace containing
 * it. Combinators that mutate a pane (`splitPane`, `focusPane`) accept and
 * return this — call `snapshotPane` for current state.
 *
 * Construct with {@link makePane}; the carried {@link EntityTypeId} tag is
 * what lets polymorphic combinators distinguish a pane from a tab.
 *
 * **Example** (building a `Pane` from known ids)
 *
 * ```ts
 * import { makePane } from "effect-herdr"
 * import type { PaneId, TabId, WorkspaceId } from "effect-herdr"
 *
 * const pane = makePane({
 *   id: "w1:t1:p1" as PaneId,
 *   tabId: "w1:t1" as TabId,
 *   workspaceId: "w1" as WorkspaceId,
 * })
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface Pane extends Entity<"pane"> {
  readonly id: PaneId
  readonly tabId: TabId
  readonly workspaceId: WorkspaceId
}

/**
 * The plain-object fields of a {@link Pane}, without the entity tag.
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneFields {
  readonly id: PaneId
  readonly tabId: TabId
  readonly workspaceId: WorkspaceId
}

/**
 * Builds a {@link Pane} identity value from its ids. Extra fields pass
 * through, so this also builds a {@link PaneSnapshot}.
 *
 * @category constructors
 * @since 0.1.0
 */
export const makePane = <A extends PaneFields>(fields: A): A & Pane =>
  Object.assign(Object.create(PaneProto), fields)

/**
 * A tab's stable identity: its own id plus the workspace containing it.
 *
 * Construct with {@link makeTab}.
 *
 * @category models
 * @since 0.1.0
 */
export interface Tab extends Entity<"tab"> {
  readonly id: TabId
  readonly workspaceId: WorkspaceId
}

/**
 * The plain-object fields of a {@link Tab}, without the entity tag.
 *
 * @category models
 * @since 0.1.0
 */
export interface TabFields {
  readonly id: TabId
  readonly workspaceId: WorkspaceId
}

/**
 * Builds a {@link Tab} identity value from its ids. Extra fields pass
 * through, so this also builds a {@link TabSnapshot}.
 *
 * @category constructors
 * @since 0.1.0
 */
export const makeTab = <A extends TabFields>(fields: A): A & Tab =>
  Object.assign(Object.create(TabProto), fields)

/**
 * A workspace's stable identity.
 *
 * Construct with {@link makeWorkspace}.
 *
 * @category models
 * @since 0.1.0
 */
export interface Workspace extends Entity<"workspace"> {
  readonly id: WorkspaceId
}

/**
 * The plain-object fields of a {@link Workspace}, without the entity tag.
 *
 * @category models
 * @since 0.1.0
 */
export interface WorkspaceFields {
  readonly id: WorkspaceId
}

/**
 * Builds a {@link Workspace} identity value from its id. Extra fields pass
 * through, so this also builds a {@link WorkspaceSnapshot}.
 *
 * @category constructors
 * @since 0.1.0
 */
export const makeWorkspace = <A extends WorkspaceFields>(fields: A): A & Workspace =>
  Object.assign(Object.create(WorkspaceProto), fields)

/**
 * Whether a value is a {@link Pane}.
 *
 * Tag-based, so it is sound against `Tab`/`Workspace` — which a
 * field-presence check is not, since `Pane` structurally contains both.
 *
 * @category refinements
 * @since 0.1.0
 */
export const isPane = (u: unknown): u is Pane => isEntity(u) && u[EntityTypeId] === "pane"

/**
 * Whether a value is a {@link Tab}.
 *
 * Tag-based, so it is sound against `Pane` — which has every field a `Tab`
 * has and would satisfy a field-presence check.
 *
 * @category refinements
 * @since 0.1.0
 */
export const isTab = (u: unknown): u is Tab => isEntity(u) && u[EntityTypeId] === "tab"

/**
 * Whether a value is a {@link Workspace}.
 *
 * Tag-based, so it is sound against `Pane`/`Tab` — both of which carry an
 * `id` and would satisfy a field-presence check.
 *
 * @category refinements
 * @since 0.1.0
 */
export const isWorkspace = (u: unknown): u is Workspace => isEntity(u) && u[EntityTypeId] === "workspace"

// =============================================================================
// Snapshot types — point-in-time state captures
// =============================================================================

/**
 * The timestamp every snapshot type carries, stamped SDK-side (via
 * Effect's `Clock`) at decode time — diagnostic only, never a source of
 * ordering truth against herdr's own `revision` counters.
 *
 * @category models
 * @since 0.1.0
 */
export interface SnapshotCaptured {
  readonly capturedAt: DateTime.Utc
}

/**
 * A pane's state as of `capturedAt`. Returned by `snapshotPane`,
 * `listPanes`, and `currentPane`.
 *
 * **Example** (reading a pane's cwd)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HerdrSession, snapshotPane } from "effect-herdr"
 * import type { PaneId } from "effect-herdr"
 *
 * const program = Effect.gen(function*() {
 *   const pane = yield* snapshotPane({ id: "w1:t1:p1" as PaneId })
 *   return pane.cwd
 * })
 *
 * program.pipe(Effect.provide(HerdrSession.Live), Effect.runPromise)
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneSnapshot extends Pane, SnapshotCaptured {
  /** Herdr's own monotonic per-pane counter. Comparable across snapshots of the same pane. */
  readonly revision: number
  readonly cwd: string
  readonly agent: Agent | undefined
  readonly agentStatus: AgentStatus
  readonly focused: boolean
}

/**
 * A tab's state as of `capturedAt`. Returned by `currentTab` and the
 * `focus.ts` lookups. Has no `activePaneId` field — herdr's per-tab active
 * pane is only available via a `session.snapshot` layout entry, which
 * `activePane` reads under the hood.
 *
 * @category models
 * @since 0.1.0
 */
export interface TabSnapshot extends Tab, SnapshotCaptured {
  readonly label: string
  readonly focused: boolean
  readonly paneCount: number
  readonly agentStatus: AgentStatus
}

/**
 * A workspace's state as of `capturedAt`. Returned by `currentWorkspace`
 * and the `focus.ts` lookups.
 *
 * @category models
 * @since 0.1.0
 */
export interface WorkspaceSnapshot extends Workspace, SnapshotCaptured {
  readonly label: string
  readonly activeTabId: TabId
  readonly focused: boolean
  readonly tabCount: number
  readonly paneCount: number
  readonly agentStatus: AgentStatus
}

/**
 * A git worktree's state as of `capturedAt`. Returned by `listWorktrees`,
 * `createWorktree`, and `openWorktree`. Not an identity type — unlike
 * `Pane`/`Tab`/`Workspace`, a worktree has no server-issued opaque id;
 * its natural key is the filesystem `path`, and `isPrunable`/
 * `openWorkspaceId` are point-in-time mutable state, which is exactly
 * what the snapshot discipline exists for.
 *
 * @category models
 * @since 0.1.0
 */
export interface WorktreeSnapshot extends SnapshotCaptured {
  readonly path: string
  readonly label: string
  readonly branch: Option.Option<string>
  readonly isBare: boolean
  readonly isDetached: boolean
  readonly isLinkedWorktree: boolean
  readonly isPrunable: boolean
  readonly openWorkspaceId: Option.Option<WorkspaceId>
}

/**
 * Static repo metadata scoping a `listWorktrees` query — which repo the
 * `worktrees` array was listed for. Not a snapshot: unlike
 * `WorktreeSnapshot`, none of its fields are evolving pane/tab/workspace
 * -style state.
 *
 * @category models
 * @since 0.1.0
 */
export interface WorktreeSource {
  readonly repoKey: string
  readonly repoName: string
  readonly repoRoot: string
  readonly sourceCheckoutPath: string
  readonly sourceWorkspaceId: Option.Option<WorkspaceId>
}

// =============================================================================
// Spatial pane types — #15
// =============================================================================

/**
 * Which directions `pane` has a neighboring pane in, within its tab, from
 * `paneEdges`. `true` means a pane exists on that side; `false` means the
 * pane is flush against that edge of the tab's layout.
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneEdges {
  readonly left: boolean
  readonly right: boolean
  readonly up: boolean
  readonly down: boolean
}

// =============================================================================
// Layout geometry types — #17
// =============================================================================

/**
 * A rectangle in a tab's terminal-cell grid — `x`/`y` are the top-left
 * corner, `width`/`height` the extent, all measured in cells.
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneLayoutRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * One pane's placement within `paneLayout`'s tab-wide geometry.
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneLayoutPane {
  readonly paneId: PaneId
  readonly focused: boolean
  readonly rect: PaneLayoutRect
}

/**
 * One split divider within `paneLayout`'s tab-wide geometry. `ratio` is
 * the fraction of `rect` given to the side nearer the split's origin.
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneLayoutSplit {
  readonly id: string
  readonly direction: "right" | "down"
  readonly ratio: number
  readonly rect: PaneLayoutRect
}

/**
 * A tab's current pane geometry — every pane's rectangle, every split
 * divider, and whether the tab is zoomed. Returned by `paneLayout`. Not a
 * `SnapshotCaptured` type — unlike `PaneSnapshot`/`TabSnapshot`, herdr's
 * reply is server-authoritative geometry with no SDK-side clock value to
 * add, so there is no `capturedAt` to stamp. Also structurally distinct
 * from the fogged `layout.export`/`layout.apply`'s recursive `LayoutNode`
 * tree — this is flat rects and lists, a read of current state rather
 * than a portable, replayable description.
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneLayoutSnapshot {
  readonly workspaceId: WorkspaceId
  readonly tabId: TabId
  readonly zoomed: boolean
  readonly area: PaneLayoutRect
  readonly focusedPaneId: PaneId
  readonly panes: ReadonlyArray<PaneLayoutPane>
  readonly splits: ReadonlyArray<PaneLayoutSplit>
}

// =============================================================================
// Process introspection types — #17
// =============================================================================

/**
 * One process herdr found in a pane's foreground process group, from
 * `paneProcessInfo`.
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneProcessInfoProcess {
  readonly pid: number
  readonly name: string
  readonly argv: ReadonlyArray<string> | undefined
  readonly argv0: string | undefined
  readonly cmdline: string | undefined
  readonly cwd: string | undefined
}

/**
 * A pane's shell/process state — shell PID, tty path, and the foreground
 * process group herdr found in the pty. Returned by `paneProcessInfo`.
 * Not folded into `PaneSnapshot`: walking the pty's foreground process
 * tree is a heavier, opt-in read most `snapshotPane` callers don't need.
 * No `capturedAt` — same server-authoritative reasoning as
 * `PaneLayoutSnapshot`.
 *
 * @category models
 * @since 0.1.0
 */
export interface PaneProcessInfo {
  readonly paneId: PaneId
  readonly shellPid: number | undefined
  readonly tty: string | undefined
  readonly foregroundProcessGroupId: number | undefined
  readonly foregroundProcesses: ReadonlyArray<PaneProcessInfoProcess>
}

// =============================================================================
// Agent identity/snapshot types — #18
// =============================================================================

/**
 * Opaque branded id for an agent target. Unlike `PaneId`/`TabId`/
 * `WorkspaceId`, this is not a distinct wire concept — herdr's
 * `AgentTarget.target` field disambiguates a raw pane id from a
 * caller-assigned name server-side, confirmed empirically (renaming an
 * agent, then resolving it by the new name). Both forms share this one
 * branded string.
 *
 * @category models
 * @since 0.1.0
 */
export type AgentTargetId = string & { readonly _brand: "AgentTargetId" }

/**
 * An agent's stable identity — either a `PaneId` or a caller-assigned
 * name, resolved server-side. Combinators that mutate an agent
 * (`renameAgent`, `focusAgent`) accept and return this — call
 * `snapshotAgent` for current state.
 *
 * @category models
 * @since 0.1.0
 */
export interface AgentTarget {
  readonly target: AgentTargetId
}

/**
 * An agent's state as of `capturedAt`. Returned by `snapshotAgent` and
 * `listAgents`.
 *
 * @category models
 * @since 0.1.0
 */
export interface AgentSnapshot extends AgentTarget, SnapshotCaptured {
  readonly paneId: PaneId
  readonly tabId: TabId
  readonly workspaceId: WorkspaceId
  readonly revision: number
  readonly focused: boolean
  readonly agentStatus: AgentStatus
  readonly agent: Agent | undefined
  readonly agentSessionId: string | undefined
  readonly cwd: string | undefined
  readonly displayAgent: string | undefined
  readonly name: string | undefined
  readonly title: string | undefined
  readonly stateLabels: Readonly<Record<string, string>>
  readonly tokens: Readonly<Record<string, string>>
}
