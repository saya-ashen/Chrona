---
feature_doc_version: 1
scope: "file"
source: "delete-task.ts"
owner_feature: "Task Management"
owner_capability: "Delete Task"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "f7f5b38692c32b39"
  last_scanned_commit: ""
symbols:
  - id: "deleteTask"
    source_name: "deleteTask"
    kind: "function"
    describe: true
    reason: "ai-selected:pilot-task-management-delete-use-case"
    status: "needs-ai-fill"
tests:
  direct:
    - "packages/engine/src/modules/tasks/delete-task.bun.test.ts"
  transitive:
    - "apps/server/src/__tests__/api/ai-client-crud.bun.test.ts"
    - "apps/server/src/__tests__/api/ai-feature-binding.bun.test.ts"
    - "apps/server/src/__tests__/api/external-calendar-events.bun.test.ts"
    - "apps/server/src/__tests__/api/external-calendar-source-management.bun.test.ts"
    - "apps/server/src/__tests__/api/external-calendar-sources.bun.test.ts"
    - "apps/server/src/__tests__/api/external-task-edit-roundtrip.bun.test.ts"
    - "apps/server/src/__tests__/api/plan-execution-module.bun.test.ts"
    - "apps/server/src/__tests__/api/provider-bridge-malformed-workflow.bun.test.ts"
    - "apps/server/src/__tests__/api/real-router-smoke.bun.test.ts"
    - "apps/server/src/__tests__/api/task-assistant-message.bun.test.ts"
    - "apps/server/src/__tests__/api/task-validation-workflow.bun.test.ts"
    - "apps/server/src/__tests__/api/task-workflow.bun.test.ts"
    - "apps/server/src/__tests__/api/task-workspace-activity.bun.test.ts"
    - "apps/server/src/__tests__/api/task-workspace-chat.bun.test.ts"
    - "apps/server/src/__tests__/bootstrap-runtime.bun.test.ts"
    - "apps/server/src/routes/__tests__/mcp-routes.bun.test.ts"
    - "apps/server/src/routes/__tests__/plan-operations.bun.test.ts"
    - "apps/server/src/routes/tasks/runtime-event-summary.test.ts"
    - "packages/engine/src/modules/agent-tools/operations.bun.test.ts"
    - "packages/engine/src/modules/tasks/delete-task.bun.test.ts"
coverage:
  status: "unknown"
  confidence: "low"
---
# delete-task

## Purpose

<!-- ai:purpose:start -->
TODO: AI fill.
<!-- ai:purpose:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `deleteTask` | function | 11 | ai-selected:pilot-task-management-delete-use-case | `export async function deleteTask(taskId: string)` |
<!-- generated:symbols:end -->

## Function docs

<!-- symbol:deleteTask:start -->

### `deleteTask`

#### Role

<!-- ai:role:start deleteTask -->
TODO: AI fill.
<!-- ai:role:end deleteTask -->

#### Behavior

<!-- ai:behavior:start deleteTask -->
TODO: AI fill.
<!-- ai:behavior:end deleteTask -->

#### Inputs and outputs

<!-- ai:io:start deleteTask -->
TODO: AI fill.
<!-- ai:io:end deleteTask -->

#### Invariants

<!-- ai:invariants:start deleteTask -->
TODO: AI fill.
<!-- ai:invariants:end deleteTask -->

#### Test coverage

<!-- generated:tests:start deleteTask -->
Direct tests:
- packages/engine/src/modules/tasks/delete-task.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end deleteTask -->

<!-- ai:test-assessment:start deleteTask -->
Coverage status: Unknown

Covered:
- TODO

Missing or weak:
- TODO
<!-- ai:test-assessment:end deleteTask -->

<!-- symbol:deleteTask:end -->
