---
feature_doc_version: 1
scope: "file"
source: "task-planning.ts"
owner_feature: "Plans"
owner_capability: "Task Planning"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "4f2686d804de542d"
  last_scanned_commit: ""
symbols:
  - id: "TaskPlanning"
    source_name: "TaskPlanning"
    kind: "class"
    describe: true
---
# task-planning

<!-- ai:start -->
Role: engine-facing task plan lifecycle service. It reads plan state, controls manual generation sessions, accepts generated plans, stops generation, and applies plan patch/mutation commands.

Behavior: `accept` verifies workspace membership when provided, finds the target persisted plan, saves it as accepted, supersedes sibling draft/accepted plans in that scope, rebuilds the task projection, and returns the accepted read model.

Important invariant: plan acceptance is a command against a unique `planId`; submitted work-block hints must not cause the command to accept a different plan or report success for a failed background accept.

Coverage: weak before this investigation. API lifecycle tests cover simple task-level accept, but direct tests did not cover recurring work-block scope mismatch or accepting by unique plan id when UI sends a stale/neighbor occurrence id.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `TaskPlanning` | class | 5 | ai-selected:task-plan-lifecycle-acceptance-scope | `export class TaskPlanning` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:TaskPlanning:start -->

### `TaskPlanning`

<!-- ai:start -->
Role: groups task-plan lifecycle operations behind one class used by engine services and routes.

Accept behavior: validates workspace/task ownership, resolves the plan targeted by `planId`, persists accepted status through compiled-plan store, rebuilds projection, and returns latest frontend read model.

Invariants:
- `planId` must identify the plan being accepted.
- Acceptance must preserve the plan's canonical `workBlockId` instead of moving it to an unrelated submitted work block.
- Failed async route execution must surface as command failure; 202 dispatch ack is not acceptance success.

Coverage: weak. Existing route tests miss recurring scope mismatch and async command failure visibility.
<!-- ai:end -->

<!-- generated:tests:start TaskPlanning -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end TaskPlanning -->

<!-- symbol:TaskPlanning:end -->
