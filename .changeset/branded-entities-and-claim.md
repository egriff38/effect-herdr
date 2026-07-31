---
"effect-herdr": minor
---

Branded identity types and scope-bound resource liveness.

`Pane`, `Tab`, and `Workspace` now carry a discriminating `EntityTypeId` tag
plus `Equal`/`Hash`/`Order` traits, and are built with `makePane`/`makeTab`/
`makeWorkspace`. This is a **breaking change to construction**: bare object
literals (`{ id, tabId, workspaceId }`) are no longer assignable. The tag lives
on the prototype, so spreading an entity drops it rather than producing a
half-entity that typechecks.

The tag fixes a real soundness hole. `Pane` structurally contains every field
of `Tab`, which contains every field of `Workspace`, so the previous
field-presence guards (`hasProperty(u, "id")` for a workspace) returned `true`
for all three kinds — a `Pane` passed where a `Workspace` was expected would
typecheck and dispatch the wrong RPC. New sound refinements `isPane`/`isTab`/
`isWorkspace` replace them everywhere.

New `claim`/`claimIn`/`withClaim` tie a resource's liveness to a `Scope`:

- `claim(entity)` forks a watcher on herdr's `*.closed` push stream and
  interrupts the claiming fiber if the resource is closed remotely, so
  multi-step work stops at the close instead of failing on a later RPC.
- `disconnectPolicy: "retain"` (default) only watches; `"destroy"` also closes
  the resource when the scope ends.
- `claim` takes its `Scope` from the requirements channel; `claimIn` takes one
  explicitly, for callers managing lifetimes by hand.

New kind-polymorphic `close`/`focus`/`rename` dispatch on the tag, collapsing
the three per-kind families into one surface each. `move` is deliberately not
collapsed — `movePane` takes a destination union and returns the pane's fresh
identity, while `moveTab`/`moveWorkspace` take an index and return `void`.
