/**
 * Env-injected identity accessors — the env boundary of the SDK.
 *
 * This is the only place in the SDK that reads `process.env`. Every
 * accessor here answers "what pane/tab/workspace launched this Effect
 * program", based on herdr's HERDR_PANE_ID / HERDR_TAB_ID /
 * HERDR_WORKSPACE_ID env vars.
 *
 * Behavior (per D1):
 *   - `Option.none` iff HERDR_ENV is unset (this program isn't running
 *     inside a herdr-managed pane).
 *   - `HerdrProtocolError` if HERDR_* is set but the id no longer resolves
 *     (pane closed after launch, id compacted). Fails loud — a caller
 *     that wants to interpret "closed pane" as "not in herdr" can do
 *     `Effect.catchTag("PaneNotFound", () => Effect.succeed(Option.none()))`
 *     explicitly.
 *
 * Kept in its own module (@#3) to make the env-boundary distinction
 * visually obvious.
 */

import type { Effect, Option } from "effect"
import type { HerdrSession } from "../HerdrSession.js"
import type { HerdrProtocolError } from "../protocol/errors.js"
import type { PaneSnapshot, TabSnapshot, WorkspaceSnapshot } from "../protocol/schemas.js"

export declare const currentPane: Effect.Effect<
  Option.Option<PaneSnapshot>,
  HerdrProtocolError,
  HerdrSession
>

export declare const currentTab: Effect.Effect<
  Option.Option<TabSnapshot>,
  HerdrProtocolError,
  HerdrSession
>

export declare const currentWorkspace: Effect.Effect<
  Option.Option<WorkspaceSnapshot>,
  HerdrProtocolError,
  HerdrSession
>
