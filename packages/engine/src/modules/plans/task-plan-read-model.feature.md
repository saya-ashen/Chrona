---
feature_doc_version: 1
scope: "file"
source: "task-plan-read-model.ts"
owner_feature: "Plans"
owner_capability: "Task Plan Read Model"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: "7b5137eabf75b329"
  last_scanned_commit: ""
symbols:
  - id: "getLatestTaskPlanReadModel"
    source_name: "getLatestTaskPlanReadModel"
    kind: "function"
    describe: true
  - id: "resolveSavedPlanEffectiveGraph"
    source_name: "resolveSavedPlanEffectiveGraph"
    kind: "function"
    describe: true
---
# task-plan-read-model

<!-- ai:start -->
Role: converts persisted compiled/editable plans plus persisted run state into frontend `TaskPlanReadModel` objects.

Behavior: reconstructs blueprint from editable plan when present, falls back to compiled plan, resolves effective graph from saved plan run state when available, and reads latest accepted/draft plan for a resolved task/work-block scope.

Important invariant: scope resolution is part of the read contract. A concrete work-block hint pins reads to that occurrence; null means resolve canonical task execution scope. Callers that already selected a UI occurrence must pass it deliberately.

Coverage: partial. Existing API/plan tests cover general read models, but direct tests did not assert consistency between task bootstrap selected occurrence and saved plan scope.
<!-- ai:end -->

## Generated symbol inventory

<!-- generated:symbols:start -->
| Symbol | Kind | Score | Reason | Signature |
|---|---:|---:|---|---|
| `getLatestTaskPlanReadModel` | function | 6 | ai-selected:task-plan-lifecycle-read-model-scope | `export async function getLatestTaskPlanReadModel( taskId: string, workBlockId?: string \| null, ): Promise<TaskPlanReadModel \| null>` |
| `resolveSavedPlanEffectiveGraph` | function | 5 | ai-selected:task-plan-lifecycle-read-model-scope | `export async function resolveSavedPlanEffectiveGraph( savedPlan: SavedCompiledPlan, ): Promise<EffectivePlanGraph>` |
<!-- generated:symbols:end -->

## Symbols

<!-- symbol:getLatestTaskPlanReadModel:start -->

### `getLatestTaskPlanReadModel`

<!-- ai:start -->
Role: returns latest frontend plan model for a task at a canonical work-block scope.

Behavior: resolves scope, prefers accepted plan in that scope, then latest plan in that scope, then task-level fallbacks for concrete occurrence scopes.

Invariants:
- Concrete `workBlockId` hints must not drift to another occurrence.
- Accepted plans win over drafts in the same scope.
- Task-level fallback is only fallback, not a replacement for occurrence-specific data.

Coverage: partial. Missing test before this fix: bootstrap selected one occurrence while this function resolved another via latest-plan scope.
<!-- ai:end -->

<!-- generated:tests:start getLatestTaskPlanReadModel -->
Direct tests:
- apps/server/src/__tests__/api/plan-lifecycle-edge-workflow.bun.test.ts
- apps/server/src/__tests__/api/plan-lifecycle-workflow.bun.test.ts
- apps/server/src/routes/__tests__/plan-operations.bun.test.ts
- packages/engine/src/modules/plans/generate-task-plan-for-task.bun.test.ts
- packages/engine/src/modules/plans/materialize-generated-task-plan.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end getLatestTaskPlanReadModel -->

<!-- symbol:getLatestTaskPlanReadModel:end -->

<!-- symbol:resolveSavedPlanEffectiveGraph:start -->

### `resolveSavedPlanEffectiveGraph`

<!-- ai:start -->
Role: derives effective plan graph for a saved compiled plan.

Behavior: reads persisted plan run state by task, plan id, and saved plan workBlockId. If run graph exists, resolves effective graph from run attempts/results; otherwise builds initial graph from compiled plan.

Invariants: persisted run lookup must use saved plan's canonical workBlockId so occurrence-specific execution state does not leak across recurring blocks.

Coverage: none direct. Covered only indirectly by APIs/components consuming effective plan graphs.
<!-- ai:end -->

<!-- generated:tests:start resolveSavedPlanEffectiveGraph -->
Direct tests:
- None found

Transitive tests:
- None found
<!-- generated:tests:end resolveSavedPlanEffectiveGraph -->

<!-- symbol:resolveSavedPlanEffectiveGraph:end -->
