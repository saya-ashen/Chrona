---
chronicle_version: 1
scope: "file"
source: "work.routes.ts"
owner_feature: "Pages"
owner_capability: "Work.routes"
layer: "server"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "ce2ff4a8f1f3bf8f"
  last_scanned_commit: ""
symbols:
  - id: "createWorkRoutes"
    source_name: "createWorkRoutes"
    kind: "route"
    describe: true
---
# work.routes

<!-- ai:start -->
Role: HTTP route module for work-page projection reads, async workspace commands, and workspace SSE events.

Behavior: `POST /work/:taskId/commands` validates a workspace command, allocates an idempotency/command id, publishes an immediate `command.accepted` event, starts async command execution, and returns 202. Actual plan generation, plan acceptance, execution action, and checkpoint results are later published through workspace events.

Important invariant: 202 response means command dispatch accepted, not operation success. UI must wait for success events/refetched state, and command failures must be visible through `command.failed`.

Coverage: weak before this investigation. Tests covered direct plan accept routes and hook refresh behavior, but not the async work-command path where `plan.accept` can fail after the 202 ack.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `createWorkRoutes` | route | 8 | ai-selected:task-workspace-async-command-route | `export function createWorkRoutes(engine: ChronaEngine)` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:createWorkRoutes:start -->

### `createWorkRoutes`

<!-- ai:start -->
Role: creates work page Hono routes.

Inputs/outputs: GET returns work projection. POST returns command ack. SSE streams command/projection/runtime events to connected clients.

Invariants:
- `command.accepted` names dispatch acceptance only.
- `command.failed` must carry the engine error message when async execution fails.
- Plan accept route must publish a success trigger only after `engine.tasks.plan.accept` completes.

Coverage: none direct for this route before regression work. Missing case: wrong workBlockId with valid planId returns 202 but later emits command failure and leaves DB draft.
<!-- ai:end -->

<!-- generated:tests:start createWorkRoutes -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end createWorkRoutes -->

<!-- symbol:createWorkRoutes:end -->
