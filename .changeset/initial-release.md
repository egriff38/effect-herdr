---
"effect-herdr": minor
---

Initial public release: typed Effect SDK for herdr.

- Protocol layer (`HerdrRpcs`, identity/snapshot value objects, tagged error types)
- Connection primitive (`HerdrConnection`) with per-call-dial wire adapter and scoped `events.subscribe` support
- Service layer (`HerdrSession`) and domain combinators: `splitPane`, `focusPane`, `closePane`, `runInPane` (batch + streaming), `waitForOutput`, `activePane`/`activeTab`, `focusedPane`/`focusedTab`/`focusedWorkspace`, `focusedPaneRef`, `currentPane`/`currentTab`/`currentWorkspace`, `listWorkspaces`
