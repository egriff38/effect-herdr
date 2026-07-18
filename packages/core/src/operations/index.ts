/**
 * Barrel re-export for the operations directory.
 *
 * Three sub-modules, three distinct use cases:
 *   - `pane` — mutation and IO against a pane (split, run, wait, list, snapshot)
 *   - `focus` — active-child, global-focus, and subscribable focus tracking
 *   - `current` — env-injected identity (the SDK's only env boundary)
 */

export * from "./current.js"
export * from "./focus.js"
export * from "./pane.js"
