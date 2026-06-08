---
feature_doc_version: 1
scope: "file"
source: "create-task.ts"
owner_feature: "Task Management"
owner_capability: "Create Task"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "34e54ecb63ef21b2"
  last_scanned_commit: ""
symbols:
  - id: "createTask"
    source_name: "createTask"
    kind: "function"
    describe: true
    reason: "ai-selected:pilot-task-management-create-use-case"
    status: "needs-ai-fill"
tests:
  direct:
    - "apps/server/src/__tests__/api/task-validation-workflow.bun.test.ts"
    - "apps/server/src/__tests__/api/task-workflow.bun.test.ts"
    - "packages/engine/src/modules/scheduling/auto-start-scheduled-plan.bun.test.ts"
    - "packages/engine/src/modules/tasks/__tests__/command-chain.bun.test.ts"
    - "packages/engine/src/modules/tasks/create-task-no-auto-plan.bun.test.ts"
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
    - "packages/engine/src/modules/scheduling/auto-start-scheduled-plan.bun.test.ts"
    - "packages/engine/src/modules/tasks/__tests__/command-chain.bun.test.ts"
    - "packages/engine/src/modules/tasks/create-task-no-auto-plan.bun.test.ts"
coverage:
  status: "unknown"
  confidence: "low"
---
# create-task

## Purpose

<!-- ai:purpose:start -->
TODO: AI fill.
<!-- ai:purpose:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `createTask` | function | 11 | ai-selected:pilot-task-management-create-use-case | `export async function createTask(input: CreateTaskInput)` |
<!-- generated:symbols:end -->

## Function docs

<!-- symbol:createTask:start -->

### `createTask`

#### Role

<!-- ai:role:start createTask -->
TODO: AI fill.
<!-- ai:role:end createTask -->

#### Behavior

<!-- ai:behavior:start createTask -->
TODO: AI fill.
<!-- ai:behavior:end createTask -->

#### Inputs and outputs

<!-- ai:io:start createTask -->
TODO: AI fill.
<!-- ai:io:end createTask -->

#### Invariants

<!-- ai:invariants:start createTask -->
TODO: AI fill.
<!-- ai:invariants:end createTask -->

#### Test coverage

<!-- generated:tests:start createTask -->
Direct tests:
- apps/server/src/__tests__/api/task-validation-workflow.bun.test.ts
- apps/server/src/__tests__/api/task-workflow.bun.test.ts
- packages/engine/src/modules/scheduling/auto-start-scheduled-plan.bun.test.ts
- packages/engine/src/modules/tasks/__tests__/command-chain.bun.test.ts
- packages/engine/src/modules/tasks/create-task-no-auto-plan.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end createTask -->

<!-- ai:test-assessment:start createTask -->
Coverage status: Unknown

Covered:
- TODO

Missing or weak:
- TODO
<!-- ai:test-assessment:end createTask -->

<!-- symbol:createTask:end -->
