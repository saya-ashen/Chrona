---
chronicle_version: 1
scope: "file"
source: "get-task-command-center.ts"
owner_feature: "Task Management"
owner_capability: "Get Task Command Center"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "a1e55fd19e686779"
  last_scanned_commit: ""
symbols:
  - id: "getTaskCommandCenter"
    source_name: "getTaskCommandCenter"
    kind: "function"
    describe: true
    signature_hash: "a09c21812fa4c961"
    body_hash: "0e6739862d98e7eb"
---
# get-task-command-center

<!-- ai:start -->
Role: builds the server-driven Command Center document bundle for one task workspace. This is the engine side of `GET /api/tasks/:taskId/command-center` and owns the `documents.now`, `documents.output`, and `documents.trail` payload returned to the web shell.

Behavior: verifies the task exists, reads recent artifacts and saved activity scoped by optional `workBlockId`, asks plan execution for the current execution snapshot, and converts those facts into json-render `UiDocument`s. `documents.now` contains execution status plus current checkpoint controls from `currentExecution.ui.currentOperationSpec`; `documents.output` contains artifact UI; `documents.trail` contains saved execution activity. It deliberately does not return raw `artifacts`, raw `activityTimeline`, or nested `ui.commandCenter` data.

Invariants:
- Missing task raises `TASK_NOT_FOUND`; callers must not receive an empty document set for a nonexistent task.
- The endpoint contract is UI-document-only: root keys stay limited to `documents` and document keys stay `now`, `output`, and `trail`.
- `workBlockId` filters saved timeline/events consistently with task workspace scope.
- Checkpoint actions in `documents.now` must include enough whitelisted action metadata for the React host to dispatch `submit-checkpoint`; JSON never executes arbitrary code.

Coverage: partial. API-level tests in `apps/server/src/__tests__/api/task-workspace-console.bun.test.ts` assert the route returns only `documents`, includes `now`, `output`, and `trail` `UiDocument`s, and projects persisted plan-generation events from the database into `documents.trail.state.trail.items`. Missing direct engine tests for nonexistent task, work-block isolation, event ordering, and failed/waiting checkpoint button payloads.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `getTaskCommandCenter` | function | 8 | ai-selected:task-workspace-command-center-json-render-documents | `export async function getTaskCommandCenter(input:` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:getTaskCommandCenter:start -->

### `getTaskCommandCenter`

<!-- ai:start -->
Role: command-center read model use case for json-render documents.

Inputs/outputs: input is `{ taskId, workBlockId? }`. Output is `{ documents: { now, output, trail } }`, where each value is a catalog-constrained `UiDocument`. `workBlockId` is nullable and only scopes saved activity sources; current execution is fetched with the same work-block scope.

Behavior: loads task artifacts, timeline items, raw execution events, and current execution state. It maps artifacts to `buildCommandCenterArtifactsSpec`, saved activity to `buildCommandCenterTrailSpec`, and execution status/checkpoint UI to `buildCommandCenterNowSpec`. Failure is explicit: a missing task throws `EngineError(TASK_NOT_FOUND)`.

Coverage: partial. The public API tests exercise successful document shape through Hono, catch regressions where raw data leaks back into the response, and verify persisted database activity appears in the Trail document state. Missing direct engine tests for nonexistent task, work-block isolation, event ordering, and failed/waiting checkpoint button payloads.
<!-- ai:end -->

<!-- generated:tests:start getTaskCommandCenter -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end getTaskCommandCenter -->

<!-- symbol:getTaskCommandCenter:end -->
