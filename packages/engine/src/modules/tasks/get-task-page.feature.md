---
feature_doc_version: 1
scope: "file"
source: "get-task-page.ts"
owner_feature: "Task Management"
owner_capability: "Get Task Page"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "15a3f5a47cd44201"
  last_scanned_commit: ""
symbols:
  - id: "getTaskPage"
    source_name: "getTaskPage"
    kind: "function"
    describe: true
    reason: "ai-selected:pilot-task-management-page-read-model"
    status: "needs-ai-fill"
tests:
  direct:
    - "apps/server/src/__tests__/api/task-workspace-console.bun.test.ts"
    - "packages/engine/src/modules/tasks/__tests__/external-task-description-echo.bun.test.ts"
    - "packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts"
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
    - "apps/server/src/__tests__/api/task-workspace-console.bun.test.ts"
    - "apps/server/src/__tests__/bootstrap-runtime.bun.test.ts"
    - "apps/server/src/routes/__tests__/mcp-routes.bun.test.ts"
    - "apps/server/src/routes/__tests__/plan-operations.bun.test.ts"
    - "apps/server/src/routes/tasks/runtime-event-summary.test.ts"
    - "apps/web/src/__tests__/localized-child-loader-regression.test.tsx"
    - "apps/web/src/__tests__/localized-root-index-route.test.tsx"
    - "packages/engine/src/modules/agent-tools/operations.bun.test.ts"
    - "packages/engine/src/modules/tasks/__tests__/external-task-description-echo.bun.test.ts"
    - "packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts"
coverage:
  status: "unknown"
  confidence: "low"
---
# get-task-page

## Purpose

<!-- ai:purpose:start -->
TODO: AI fill.
<!-- ai:purpose:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `getTaskPage` | function | 8 | ai-selected:pilot-task-management-page-read-model | `export async function getTaskPage(input:` |
<!-- generated:symbols:end -->

## Function docs

<!-- symbol:getTaskPage:start -->

### `getTaskPage`

#### Role

<!-- ai:role:start getTaskPage -->
TODO: AI fill.
<!-- ai:role:end getTaskPage -->

#### Behavior

<!-- ai:behavior:start getTaskPage -->
TODO: AI fill.
<!-- ai:behavior:end getTaskPage -->

#### Inputs and outputs

<!-- ai:io:start getTaskPage -->
TODO: AI fill.
<!-- ai:io:end getTaskPage -->

#### Invariants

<!-- ai:invariants:start getTaskPage -->
TODO: AI fill.
<!-- ai:invariants:end getTaskPage -->

#### Test coverage

<!-- generated:tests:start getTaskPage -->
Direct tests:
- apps/server/src/__tests__/api/task-workspace-console.bun.test.ts
- packages/engine/src/modules/tasks/__tests__/external-task-description-echo.bun.test.ts
- packages/engine/src/modules/tasks/get-task-page-orchestrator.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end getTaskPage -->

<!-- ai:test-assessment:start getTaskPage -->
Coverage status: Unknown

Covered:
- TODO

Missing or weak:
- TODO
<!-- ai:test-assessment:end getTaskPage -->

<!-- symbol:getTaskPage:end -->
