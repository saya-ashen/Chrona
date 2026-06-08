---
feature_doc_version: 1
scope: "file"
source: "crud.routes.ts"
owner_feature: "Tasks"
owner_capability: "Crud.routes"
layer: "server"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "d4a7a48b8b11fa86"
  last_scanned_commit: ""
symbols:
  - id: "createTasksRoutes"
    source_name: "createTasksRoutes"
    kind: "route"
    describe: true
---
# crud.routes

<!-- ai:start -->
Role: Hono task API route group for task CRUD plus task workspace split context endpoints.

Behavior: registers task list/create/read/update/delete routes, node activity routes, and split workspace context routes. The command-center route is `GET /api/tasks/:taskId/command-center`; it delegates to `engine.tasks.getCommandCenter({ taskId, workBlockId })` and returns the engine payload directly through `taskContextResponse`.

Invariants:
- Split routes such as `runtime-context`, `review-context`, and `command-center` must remain before the generic `/tasks/:taskId` route so Hono does not match them as task ids.
- `command-center` response must stay json-render-only: `{ documents: { now, output, trail } }`.
- HTTP errors from engine errors flow through `toHttpError`; unexpected failures use the route-specific context string for diagnostics.

Coverage: partial. `apps/server/src/__tests__/api/task-workspace-console.bun.test.ts` now covers successful `GET /api/tasks/:taskId/command-center` and asserts no raw `artifacts`, `activityTimeline`, or legacy `ui` wrapper leaks into the API. Missing route-level tests for 404/not-found behavior, `workBlockId` query scoping, route-order regressions, and click-through checkpoint dispatch from rendered documents.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `createTasksRoutes` | route | 9 | ai-selected:task-workspace-command-center-api-route | `export function createTasksRoutes(engine: ChronaEngine)` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:createTasksRoutes:start -->

### `createTasksRoutes`

<!-- ai:start -->
Role: constructs task route handlers and binds each route to the corresponding engine service method.

Command-center contract: `GET /api/tasks/:taskId/command-center?workBlockId=...` validates `taskId`, passes optional `workBlockId`, and returns engine-provided json-render documents without adding route-local UI wrappers or raw read-model fields.

Coverage: partial. Successful command-center shape is tested through the public router. Coverage is not complete because error mapping, `workBlockId`, and route precedence are not directly asserted.
<!-- ai:end -->

<!-- generated:tests:start createTasksRoutes -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end createTasksRoutes -->

<!-- symbol:createTasksRoutes:end -->
