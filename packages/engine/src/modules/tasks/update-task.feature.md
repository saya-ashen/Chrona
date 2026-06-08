---
feature_doc_version: 1
scope: "file"
source: "update-task.ts"
owner_feature: "Task Management"
owner_capability: "Update Task"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "d6e41e304a8216b4"
  last_scanned_commit: ""
symbols:
  - id: "updateTask"
    source_name: "updateTask"
    kind: "function"
    describe: true
---
# update-task

## Purpose

<!-- ai:purpose:start -->
TODO: AI fill.
<!-- ai:purpose:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `updateTask` | function | 11 | ai-selected:pilot-task-management-update-use-case | `export async function updateTask( input: UpdateTaskInput &` |
<!-- generated:symbols:end -->

## Function docs

<!-- symbol:updateTask:start -->

### `updateTask`

#### Role

<!-- ai:role:start updateTask -->
TODO: AI fill.
<!-- ai:role:end updateTask -->

#### Behavior

<!-- ai:behavior:start updateTask -->
TODO: AI fill.
<!-- ai:behavior:end updateTask -->

#### Inputs and outputs

<!-- ai:io:start updateTask -->
TODO: AI fill.
<!-- ai:io:end updateTask -->

#### Invariants

<!-- ai:invariants:start updateTask -->
TODO: AI fill.
<!-- ai:invariants:end updateTask -->

#### Test coverage

<!-- generated:tests:start updateTask -->
Direct tests:
- apps/server/src/__tests__/api/task-validation-workflow.bun.test.ts
- apps/server/src/__tests__/api/task-workflow.bun.test.ts
- packages/engine/src/modules/tasks/__tests__/command-chain.bun.test.ts
- packages/engine/src/modules/tasks/create-task-no-auto-plan.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end updateTask -->

<!-- ai:test-assessment:start updateTask -->
Coverage status: Unknown

Covered:
- TODO

Missing or weak:
- TODO
<!-- ai:test-assessment:end updateTask -->

<!-- symbol:updateTask:end -->
