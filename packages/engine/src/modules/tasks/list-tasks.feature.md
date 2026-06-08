---
feature_doc_version: 1
scope: "file"
source: "list-tasks.ts"
owner_feature: "Task Management"
owner_capability: "List Tasks"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "1350e9e62a81af27"
  last_scanned_commit: ""
symbols:
  - id: "listTasksByWorkspace"
    source_name: "listTasksByWorkspace"
    kind: "function"
    describe: true
    reason: "ai-selected:pilot-task-management-list-use-case"
    status: "needs-ai-fill"
tests:
  direct: []
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
coverage:
  status: "unknown"
  confidence: "low"
---
# list-tasks

## Purpose

<!-- ai:purpose:start -->
TODO: AI fill.
<!-- ai:purpose:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `listTasksByWorkspace` | function | 8 | ai-selected:pilot-task-management-list-use-case | `export async function listTasksByWorkspace(input: ListTasksInput)` |
<!-- generated:symbols:end -->

## Function docs

<!-- symbol:listTasksByWorkspace:start -->

### `listTasksByWorkspace`

#### Role

<!-- ai:role:start listTasksByWorkspace -->
TODO: AI fill.
<!-- ai:role:end listTasksByWorkspace -->

#### Behavior

<!-- ai:behavior:start listTasksByWorkspace -->
TODO: AI fill.
<!-- ai:behavior:end listTasksByWorkspace -->

#### Inputs and outputs

<!-- ai:io:start listTasksByWorkspace -->
TODO: AI fill.
<!-- ai:io:end listTasksByWorkspace -->

#### Invariants

<!-- ai:invariants:start listTasksByWorkspace -->
TODO: AI fill.
<!-- ai:invariants:end listTasksByWorkspace -->

#### Test coverage

<!-- generated:tests:start listTasksByWorkspace -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end listTasksByWorkspace -->

<!-- ai:test-assessment:start listTasksByWorkspace -->
Coverage status: Unknown

Covered:
- TODO

Missing or weak:
- TODO
<!-- ai:test-assessment:end listTasksByWorkspace -->

<!-- symbol:listTasksByWorkspace:end -->
