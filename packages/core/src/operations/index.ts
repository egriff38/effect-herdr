/**
 * Barrel re-export for the operations directory.
 *
 * Sub-modules, one per use case:
 *   - `pane` — mutation and IO against a pane (split, run, wait, list, snapshot)
 *   - `focus` — active-child, global-focus, and subscribable focus tracking
 *   - `current` — env-injected identity (the SDK's only env boundary)
 *   - `workspace` — workspace lifecycle (create, close, rename, focus, move)
 *   - `tab` — tab lifecycle (create, close, rename, focus, move, list)
 *   - `worktree` — listing, creating, opening, and removing git worktrees
 *   - `notification` — desktop toast alerts to the human operator
 *   - `integration` — installing/uninstalling herdr's shell integration for an agent CLI
 *   - `events` — blocking on a specific herdr lifecycle event
 *   - `agent` — inspecting/controlling herdr's tracked agents, by `AgentTarget`
 *   - `agentReporting` — self-reporting a pane's/workspace's own agent state
 *   - `claim` — scope-bound liveness: interrupt when herdr closes a resource
 *   - `entity` — kind-polymorphic `close`/`focus`/`rename` over all three
 */

export * from "./current.js"
export * from "./focus.js"
export * from "./pane.js"
export * from "./workspace.js"
export * from "./tab.js"
export * from "./worktree.js"
export * from "./notification.js"
export * from "./integration.js"
export * from "./events.js"
export * from "./agent.js"
export * from "./agentReporting.js"
export * from "./claim.js"
export * from "./entity.js"

