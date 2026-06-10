---
chronicle_version: 1
scope: "file"
source: "get-task-bootstrap.ts"
owner_feature: "Task Management"
owner_capability: "Get Task Bootstrap"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "5dfda6b987457359"
  last_scanned_commit: ""
symbols:
  - id: "getTaskBootstrap"
    source_name: "getTaskBootstrap"
    kind: "function"
    describe: true
---
# get-task-bootstrap

<!-- ai:start -->
Role: builds task-workspace bootstrap data: current occurrence, schedule fields, recurrence switcher rows, saved plan, generation status, runnability, and lightweight orchestration state.

Behavior: loads task, candidate work blocks, projection, workspace runtime defaults, imported calendar metadata, dependencies, and the latest plan read model. It chooses one current work block for the page and returns that block's schedule/status fields.

Important invariant: `currentWorkBlock`, `savedPlan`, and `aiPlanGenerationStatus` must describe the same occurrence scope unless caller explicitly requested task-level state. A recurring task page that shows work block B must not expose a plan saved under work block A.

Coverage: none before this investigation. No direct tests covered bootstrap occurrence selection, in-window scheduled blocks, or plan/current-work-block scope consistency.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `getTaskBootstrap` | function | 8 | ai-selected:task-workspace-recurring-occurrence-bootstrap | `export async function getTaskBootstrap(input:` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:getTaskBootstrap:start -->

### `getTaskBootstrap`

<!-- ai:start -->
Role: page bootstrap read use case for the task workspace.

Inputs/outputs: input is `taskId` plus optional `workBlockId`. Output is task workspace data with selected work block, recurrence occurrences, saved plan, generation status, runnability, dependencies, and source-managed calendar metadata.

Invariants:
- Explicit `workBlockId` must select that work block when it belongs to the task.
- Without an explicit work block, current/active occurrence selection must prefer work visible to the user now over arbitrary latest persisted plan scope.
- Saved plan lookup must use the same canonical occurrence scope returned as `currentWorkBlock`.

Coverage: none before regression tests for the plan acceptance scope bug. Direct tests needed for recurring tasks with today/tomorrow scheduled blocks and scoped plans.
<!-- ai:end -->

<!-- generated:tests:start getTaskBootstrap -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end getTaskBootstrap -->

<!-- symbol:getTaskBootstrap:end -->
