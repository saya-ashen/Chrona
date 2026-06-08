---
feature_doc_version: 1
scope: "file"
source: "accept-task-result.ts"
owner_feature: "Task Management"
owner_capability: "Accept Task Result"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "ef0e214e8abbb085"
  last_scanned_commit: ""
symbols:
  - id: "acceptTaskResult"
    source_name: "acceptTaskResult"
    kind: "function"
    describe: true
    reason: "ai-selected:pilot-task-management-result-flow"
    status: "needs-ai-fill"
tests:
  direct:
    - "apps/server/src/routes/__tests__/task-execution-closure.bun.test.ts"
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
    - "apps/server/src/routes/__tests__/task-execution-closure.bun.test.ts"
    - "apps/server/src/routes/tasks/runtime-event-summary.test.ts"
    - "packages/engine/src/modules/agent-tools/operations.bun.test.ts"
coverage:
  status: "unknown"
  confidence: "low"
---
# accept-task-result

## Purpose

<!-- ai:purpose:start -->
TODO: AI fill.
<!-- ai:purpose:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `acceptTaskResult` | function | 8 | ai-selected:pilot-task-management-result-flow | `export async function acceptTaskResult(input:` |
<!-- generated:symbols:end -->

## Function docs

<!-- symbol:acceptTaskResult:start -->

### `acceptTaskResult`

#### Role

<!-- ai:role:start acceptTaskResult -->
TODO: AI fill.
<!-- ai:role:end acceptTaskResult -->

#### Behavior

<!-- ai:behavior:start acceptTaskResult -->
TODO: AI fill.
<!-- ai:behavior:end acceptTaskResult -->

#### Inputs and outputs

<!-- ai:io:start acceptTaskResult -->
TODO: AI fill.
<!-- ai:io:end acceptTaskResult -->

#### Invariants

<!-- ai:invariants:start acceptTaskResult -->
TODO: AI fill.
<!-- ai:invariants:end acceptTaskResult -->

#### Test coverage

<!-- generated:tests:start acceptTaskResult -->
Direct tests:
- apps/server/src/routes/__tests__/task-execution-closure.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end acceptTaskResult -->

<!-- ai:test-assessment:start acceptTaskResult -->
Coverage status: Unknown

Covered:
- TODO

Missing or weak:
- TODO
<!-- ai:test-assessment:end acceptTaskResult -->

<!-- symbol:acceptTaskResult:end -->
