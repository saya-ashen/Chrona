---
feature_doc_version: 1
scope: "file"
source: "reopen-task.ts"
owner_feature: "Task Management"
owner_capability: "Reopen Task"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "f6d7427a61bc0a94"
  last_scanned_commit: ""
symbols:
  - id: "reopenTask"
    source_name: "reopenTask"
    kind: "function"
    describe: true
    reason: "ai-selected:pilot-task-management-lifecycle-use-case"
    status: "needs-ai-fill"
tests:
  direct:
    - "apps/server/src/routes/__tests__/task-execution-closure.bun.test.ts"
    - "packages/engine/src/modules/tasks/__tests__/command-chain.bun.test.ts"
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
    - "packages/engine/src/modules/tasks/__tests__/command-chain.bun.test.ts"
coverage:
  status: "unknown"
  confidence: "low"
---
# reopen-task

## Purpose

<!-- ai:purpose:start -->
TODO: AI fill.
<!-- ai:purpose:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `reopenTask` | function | 11 | ai-selected:pilot-task-management-lifecycle-use-case | `export async function reopenTask(input:` |
<!-- generated:symbols:end -->

## Function docs

<!-- symbol:reopenTask:start -->

### `reopenTask`

#### Role

<!-- ai:role:start reopenTask -->
TODO: AI fill.
<!-- ai:role:end reopenTask -->

#### Behavior

<!-- ai:behavior:start reopenTask -->
TODO: AI fill.
<!-- ai:behavior:end reopenTask -->

#### Inputs and outputs

<!-- ai:io:start reopenTask -->
TODO: AI fill.
<!-- ai:io:end reopenTask -->

#### Invariants

<!-- ai:invariants:start reopenTask -->
TODO: AI fill.
<!-- ai:invariants:end reopenTask -->

#### Test coverage

<!-- generated:tests:start reopenTask -->
Direct tests:
- apps/server/src/routes/__tests__/task-execution-closure.bun.test.ts
- packages/engine/src/modules/tasks/__tests__/command-chain.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end reopenTask -->

<!-- ai:test-assessment:start reopenTask -->
Coverage status: Unknown

Covered:
- TODO

Missing or weak:
- TODO
<!-- ai:test-assessment:end reopenTask -->

<!-- symbol:reopenTask:end -->
