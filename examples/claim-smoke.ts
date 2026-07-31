/**
 * Smoke test for `claim`: does a real herdr close actually interrupt a
 * claiming fiber mid-work, and does `disconnectPolicy` control cleanup?
 *
 * Run against a live herdr: `bun run examples/claim-smoke.ts`
 */
import { BunFileSystem } from "@effect/platform-bun"
import { Effect, Exit, Fiber } from "effect"
import {
  claim,
  closeWorkspace,
  createWorkspace,
  HerdrSession,
  withClaim,
} from "../packages/core/src/index.js"
import { HerdrSession as HerdrSessionTag } from "../packages/core/src/HerdrSession.js"
import { Live as HerdrConnectionLive } from "../packages/core/src/HerdrConnection.js"
import type { Workspace } from "../packages/core/src/index.js"

/** Is the workspace still known to herdr? `workspace.get` 404s once it is gone. */
const exists = (workspace: Workspace) =>
  Effect.gen(function*() {
    const session = yield* HerdrSessionTag
    return yield* session.rpc["workspace.get"]({ workspace_id: workspace.id }).pipe(
      Effect.as(true),
      Effect.catchTag("HerdrProtocolError", () => Effect.succeed(false)),
    )
  })

// Scenario 1: a remote close interrupts long sequential work under a claim.
const remoteCloseInterrupts = Effect.gen(function*() {
  const workspace = yield* createWorkspace({ label: "claim-smoke-interrupt" })
  yield* Effect.log(`[1] created ${workspace.id}`)

  const claimed = Effect.gen(function*() {
    yield* claim(workspace)
    yield* Effect.log("[1] claimed; step one")
    yield* Effect.sleep("500 millis")
    yield* Effect.log("[1] step two")
    yield* Effect.sleep("30 seconds")
    yield* Effect.log("[1] step three — MUST NOT PRINT")
    return "ran to completion"
  }).pipe(Effect.scoped)

  const fiber = yield* Effect.forkChild(claimed)
  yield* Effect.sleep("1 second")

  yield* Effect.log(`[1] closing ${workspace.id} out from under the claim`)
  yield* closeWorkspace(workspace)

  const exit = yield* Fiber.await(fiber)
  yield* Effect.log(`[1] claimant exit: ${exit._tag}`)
  return exit
})

// Scenario 2: disconnectPolicy "destroy" closes the workspace at scope exit.
const destroyOnScopeClose = Effect.gen(function*() {
  const workspace = yield* Effect.gen(function*() {
    const created = yield* withClaim(
      createWorkspace({ label: "claim-smoke-destroy" }),
      { disconnectPolicy: "destroy" },
    )
    yield* Effect.log(`[2] created+claimed ${created.id} (destroy)`)
    yield* Effect.log(`[2] exists inside scope: ${yield* exists(created)}`)
    return created
  }).pipe(Effect.scoped)

  yield* Effect.sleep("500 millis")
  const stillThere = yield* exists(workspace)
  yield* Effect.log(`[2] exists after scope closed: ${stillThere} (want false)`)
  return stillThere
})

// Scenario 3: "retain" (the default) must NOT close the workspace.
const retainLeavesItAlone = Effect.gen(function*() {
  const workspace = yield* Effect.gen(function*() {
    const created = yield* withClaim(createWorkspace({ label: "claim-smoke-retain" }))
    yield* Effect.log(`[3] created+claimed ${created.id} (retain)`)
    return created
  }).pipe(Effect.scoped)

  yield* Effect.sleep("500 millis")
  const stillThere = yield* exists(workspace)
  yield* Effect.log(`[3] exists after scope closed: ${stillThere} (want true)`)
  if (stillThere) yield* closeWorkspace(workspace)
  return stillThere
})

const program = Effect.gen(function*() {
  const exit = yield* remoteCloseInterrupts
  const destroyed = yield* destroyOnScopeClose
  const retained = yield* retainLeavesItAlone

  yield* Effect.log("=== RESULTS ===")
  yield* Effect.log(`1 remote close interrupted claimant: ${Exit.isFailure(exit)} (want true)`)
  yield* Effect.log(`2 destroy closed the workspace:      ${destroyed === false} (want true)`)
  yield* Effect.log(`3 retain left the workspace alive:   ${retained === true} (want true)`)
})

Effect.runPromise(
  program.pipe(
    Effect.provide(HerdrSession.Live),
    Effect.provide(HerdrConnectionLive),
    Effect.provide(BunFileSystem.layer),
  ),
).catch((error) => {
  console.error(error)
  process.exit(1)
})
