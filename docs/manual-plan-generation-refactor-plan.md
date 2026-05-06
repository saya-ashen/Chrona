# Manual Plan Generation Refactor Plan

## Status

Implemented.

Targeted runtime and test verification for this refactor pass is complete.

Workspace-wide `tsc` still reports unrelated pre-existing errors in `apps/web/vite.config.ts`.

This document defines the implementation plan for removing automatic task-created plan generation and rebuilding plan generation around one manual SSE-driven path with one canonical payload model.

## Implementation progress snapshot

The refactor has already landed partially.

### Completed

1. automatic task-created generation was removed from the active create-task path
2. queue-based auto generation file was deleted from active code
3. canonical contract types were introduced:
   - `TaskPlanReadModel`
   - `GenerateTaskPlanApiRequest`
   - `GeneratePlanSSEEvent`
4. new engine modules were added:
   - `packages/engine/src/modules/commands/generate-task-plan-manual-stream.ts`
   - `packages/engine/src/modules/commands/materialize-generated-task-plan.ts`
   - `packages/engine/src/modules/queries/task-plan-read-model.ts`
5. `POST /api/tasks/:taskId/plan/generate` was rewired to stream from the new manual engine path
6. legacy mixed cached-vs-fresh result branching in the old stream command was removed and replaced by the new manual-only stream implementation
7. frontend `TaskPlanGenerationPanel` was migrated away from `legacyPlanGraphToGraphPlan(...)` and now renders from compiled-plan-based mapping
8. a regression test was added to assert create-task no longer triggers automatic plan generation
9. canonical saved-plan reads now use `getLatestTaskPlanReadModel(...)` instead of legacy snapshot compatibility logic
10. `GET /api/tasks/:taskId/plan/state` now returns canonical `{ savedPlan }`
11. `POST /api/tasks/:taskId/plan/accept` now returns canonical saved-plan data
12. `planningPrompt` is now wired route -> stream command -> persistence/read model
13. remaining active runtime `savedAiPlan` naming was removed from engine/server/web task + schedule paths
14. legacy `saved-plan-snapshot.ts` active runtime path was retired
15. production `POST /api/tasks/:taskId/plan/materialize` route was restored and aligned with the canonical compiled-plan flow
16. targeted Bun/Vitest verification now passes for the touched runtime paths

### Confirmed remaining gaps

1. frontend graph rendering still maps from `compiledPlan` in `task-plan-view-model.ts`; the document’s stricter “render directly from `effectivePlan`” end state has not been implemented in this pass
2. workspace-wide `bunx tsc --noEmit --pretty false` still fails because of unrelated pre-existing `apps/web/vite.config.ts` typing errors

## Goal

Make manual plan generation the only generation path.

Desired end state:

1. no automatic plan generation after task creation
2. provider SSE remains the source of progress events
3. authoritative plan payload comes only from the `generate_task_plan_graph` tool call arguments
4. engine persists one canonical plan model
5. frontend consumes one canonical read model
6. no legacy `planGraph` / `savedPlan` compatibility payloads

## Why change

Current behavior has structural drift:

1. automatic generation and manual generation use different orchestration paths
2. manual SSE result assembly mixes transport concerns, persistence concerns, and UI compatibility concerns
3. `/api/tasks/:taskId/plan/generate` returns inconsistent payload shapes between cached and fresh branches
4. frontend still treats `result.planGraph` as a legacy graph even when backend returns compiled-plan-shaped data
5. deprecated contract fields are now active-path behavior, which makes the system hard to reason about

The result is an API whose final `result` event is not semantically stable.

## Canonical design decisions

### 1. One trigger path

For now, plan generation is manual only.

- keep `POST /api/tasks/:taskId/plan/generate`
- remove `createTask -> enqueueTaskPlanGeneration`
- remove queue-based auto generation support from active code

If automatic generation returns later, it must call the same core generation service as the manual route.

### 2. One authoritative provider payload

The canonical machine-readable plan payload is the `generate_task_plan_graph` function tool arguments.

Rules:

- `generate_plan` must force tool use
- final plan extraction must prefer `response.output[*].function_call.arguments`
- assistant free text is non-authoritative
- partial text may be streamed for preview only
- business logic must not parse free text as the primary result channel

### 3. One canonical engine model

Generation pipeline:

`AIPlanOutput -> PlanBlueprint -> CompiledPlan -> EffectivePlanGraph -> TaskPlanReadModel`

Definitions:

- `AIPlanOutput`: provider-facing tool payload
- `PlanBlueprint`: normalized business-layer blueprint
- `CompiledPlan`: persisted base plan
- `EffectivePlanGraph`: compiled plan resolved with layers
- `TaskPlanReadModel`: frontend-facing stable shape

### 4. SSE is transport, not view-model compatibility

SSE should stream:

- lifecycle/progress events
- optional partial preview text
- optional tool-call visibility
- one final canonical result event

SSE must not construct legacy response shapes for frontend rendering.

### 5. No legacy compatibility requirement

Remove old shape support instead of adapting new code to it.

Delete or replace:

- legacy `planGraph` response usage
- legacy `savedPlan` response usage
- legacy frontend graph adapters
- deprecated fields that exist only to support the old mixed contract

## Target architecture

### Route layer

File area:

- `apps/server/src/routes/plans.routes.ts`

Responsibilities:

1. validate request body
2. acquire generation lock
3. call engine manual-generation stream service
4. map engine stream events to SSE
5. release generation lock

Non-responsibilities:

- no plan-shape assembly
- no legacy compatibility mapping
- no persistence logic

### Engine generation stream service

Recommended new module:

- `packages/engine/src/modules/commands/generate-task-plan-manual-stream.ts`

Responsibilities:

1. load task context
2. start provider SSE generation
3. emit progress events
4. extract authoritative `AIPlanOutput` from tool calls
5. materialize final plan through a dedicated persistence service
6. emit one final canonical result event

This becomes the only engine entry point used by the manual route.

### Engine materialization service

Recommended new module:

- `packages/engine/src/modules/commands/materialize-generated-task-plan.ts`

Responsibilities:

1. accept `taskId`, normalized blueprint input, prompt metadata, and generator metadata
2. compile blueprint with `compilePlanBlueprint(...)`
3. persist compiled plan with `saveCompiledPlan(...)`
4. create initial layers/run with `createPlanRunFromCompiledPlan(...)` and `savePlanRun(...)`
5. compute effective plan via `resolveEffectivePlanGraph(...)`
6. build canonical read model

This service owns compile/save/read-model assembly.

### Engine read-model builder

Recommended new module:

- `packages/engine/src/modules/queries/task-plan-read-model.ts`

Responsibilities:

1. convert persisted compiled plan + layers into one stable frontend model
2. be reused by both:
   - `/plan/generate` final success event
   - `/plan/state` query response

This avoids cached and fresh branches drifting again.

## Recommended API contracts

## Manual generation request

```ts
type GenerateTaskPlanApiRequest = {
  forceRefresh?: boolean;
  planningPrompt?: string | null;
};
```

Notes:

- `planningPrompt` stays optional
- `forceRefresh` may be kept, but phase 1 can ignore cached reuse and always regenerate for simplicity

## Canonical read model

```ts
type TaskPlanReadModel = {
  id: string;
  status: "draft" | "accepted" | "superseded" | "archived";
  revision: number;
  prompt: string | null;
  summary: string | null;
  updatedAt: string;
  generatedBy: string | null;
  blueprint: PlanBlueprint;
  compiledPlan: CompiledPlan;
  effectivePlan: EffectivePlanGraph;
};
```

This should replace mixed legacy response fields.

## SSE event schema

### Status event

```ts
type GeneratePlanStatusEvent = {
  type: "status";
  phase:
    | "starting"
    | "loading_task"
    | "requesting_provider"
    | "streaming"
    | "extracting_tool_payload"
    | "compiling"
    | "saving"
    | "completed";
  message: string;
};
```

### Partial preview event

```ts
type GeneratePlanPartialEvent = {
  type: "partial";
  text: string;
};
```

This is optional preview-only data.

### Tool call event

```ts
type GeneratePlanToolCallEvent = {
  type: "tool_call";
  tool: "generate_task_plan_graph";
  input: AIPlanOutput;
};
```

### Final result event

```ts
type GeneratePlanResultEvent = {
  type: "result";
  result: TaskPlanReadModel;
  taskSessionKey?: string;
};
```

### Error event

```ts
type GeneratePlanErrorEvent = {
  type: "error";
  code:
    | "TASK_NOT_FOUND"
    | "PLAN_GENERATION_IN_FLIGHT"
    | "NO_AI_CLIENT"
    | "INVALID_TOOL_PAYLOAD"
    | "EMPTY_PLAN"
    | "PROVIDER_ERROR"
    | "ABORTED"
    | "INTERNAL_ERROR";
  message: string;
};
```

### Done event

```ts
type GeneratePlanDoneEvent = {
  type: "done";
};
```

## Canonical manual generation flow

1. frontend calls `POST /api/tasks/:taskId/plan/generate`
2. route acquires task generation lock
3. engine loads task and session context
4. engine starts provider SSE request
5. stream passes through progress events
6. engine captures the authoritative `generate_task_plan_graph` tool call payload
7. engine validates and normalizes the payload into `PlanBlueprint`
8. engine compiles the blueprint into `CompiledPlan`
9. engine persists compiled plan and initial plan run/layers
10. engine resolves `EffectivePlanGraph`
11. engine builds `TaskPlanReadModel`
12. route emits final `result` SSE event with `TaskPlanReadModel`
13. route emits `done`

## Caching and refresh policy

### Recommended phase-1 behavior

Always regenerate on manual trigger.

Reason:

- simplest semantics
- no cached/fresh divergence
- easier to validate the new path
- easier to reason about stop/retry behavior

### Optional phase-2 behavior

If cached reuse returns later, reuse must go through the same read-model builder and must emit the same `result` payload shape as fresh generation.

No branch may return a structurally different final result.

## Frontend redesign

### Remove legacy adapters

Delete or replace:

- `legacyPlanGraphToGraphPlan(...)`
- `summarizeLegacyPlanGraph(...)`
- `LegacyPlanGraph`
- `LegacySavedPlan`
- any cast from SSE payloads to legacy graph types

### New frontend rendering path

`TaskPlanGenerationPanel` should consume `TaskPlanReadModel` only.

Recommended mapping split:

1. `effectivePlanToGraphViewModel(effectivePlan: EffectivePlanGraph)`
2. `compiledPlanToEditorModel(compiledPlan: CompiledPlan)` if editing needs a separate model

Rules:

- display graph reads `effectivePlan`
- edit flow reads `compiledPlan`
- plan metadata reads top-level `TaskPlanReadModel`
- no field guessing based on response shape

### Plan state endpoint alignment

`GET /api/tasks/:taskId/plan/state` should return the same `TaskPlanReadModel` shape:

```ts
type TaskPlanStateResponse = {
  taskId: string;
  aiPlanGenerationStatus: "idle" | "generating" | "waiting_acceptance" | "accepted";
  savedPlan: TaskPlanReadModel | null;
};
```

This should replace `savedAiPlan` shape drift.

## Immediate deletions and simplifications

### Remove automatic generation path

Files to update or delete:

- `packages/engine/src/modules/commands/create-task.ts`
  - remove `enqueueTaskPlanGeneration(...)`
- `packages/engine/src/modules/commands/queue-task-plan-generation.ts`
  - delete or retire
- tests that assert auto generation after task creation

### Remove old mixed response contract

Files to update:

- `packages/contracts/src/ai-plan-runtime.ts`
  - replace `TaskPlanGraphResponse` with a new canonical result contract
- `packages/contracts/src/index.ts`
  - export the new contract

### Remove old manual-path payload assembly

Files to rewrite:

- `packages/engine/src/modules/commands/stream-task-plan-generation.ts`
- `packages/engine/src/modules/ai/ai-service.ts`
- any code returning `planGraph`, `savedPlan`, or `source` as final-response compatibility fields

### Remove old frontend compatibility path

Files to rewrite:

- `apps/web/src/components/task/ai/task-plan-generation-panel.tsx`
- `apps/web/src/components/task/plan/task-plan-view-model.ts`
- any task/schedule panels still reading legacy saved-plan graph shapes

## Suggested implementation phases

### Phase 0 — Contract reset

Goal: define the new payload shape first.

Tasks:

1. introduce `TaskPlanReadModel`
2. introduce manual-generation SSE event types
3. remove deprecated response fields from active contracts
4. update route and frontend imports to the new names

Success criteria:

- there is one documented final result shape
- no contract still implies mixed legacy response usage

### Phase 1 — Remove auto generation

Goal: reduce active-path complexity before rewriting manual generation.

Tasks:

1. remove `enqueueTaskPlanGeneration(...)` from `createTask`
2. delete queue command or move it out of active exports
3. update tests and docs

Success criteria:

- creating a task never triggers background plan generation
- only manual route can generate a plan

Current state:

- completed

### Phase 2 — Provider SSE extraction cleanup

Goal: make provider streaming extraction authoritative and simple.

Tasks:

1. keep tool-call extraction as the primary plan result path
2. treat free text as preview only
3. fail explicitly when the required tool payload is missing or invalid
4. surface structured error codes

Success criteria:

- final business payload always comes from the required tool call
- stream layer no longer builds frontend compatibility shapes

Current state:

- completed

### Phase 3 — Materialization split

Goal: isolate persistence and read-model assembly from streaming transport.

Tasks:

1. add `materialize-generated-task-plan.ts`
2. move compile/save logic there
3. add one read-model builder for both fresh and saved reads

Success criteria:

- one service owns compile/save
- one service owns frontend read-model assembly

Current state:

- completed

### Phase 4 — Route rewrite

Goal: make `/plan/generate` a thin SSE adapter.

Tasks:

1. route acquires lock
2. route streams engine events
3. route never assembles plan payloads
4. route writes one canonical final `result`

Success criteria:

- route is transport-only
- cached/fresh structural drift is impossible because there is one final result model

Current state:

- completed
- note: production router also regained `POST /tasks/:taskId/plan/materialize` so real-router coverage matches active product behavior

### Phase 5 — Frontend rewrite

Goal: consume only the new read model.

Tasks:

1. remove legacy graph adapters
2. render from `effectivePlan`
3. load state endpoint using `savedPlan: TaskPlanReadModel | null`
4. update apply/accept interactions to use canonical ids and revision fields from the new model

Success criteria:

- no frontend cast to legacy plan graph types
- manual generation UI renders the same shape as saved-plan polling state

Current state:

- mostly completed
- graph rendering path was modernized
- saved-state polling and fresh SSE success now share the same `TaskPlanReadModel` shape
- remaining design gap: graph view-model still derives from `compiledPlan` instead of rendering from `effectivePlan`

## File-level change map

### Delete or retire

- `packages/engine/src/modules/commands/queue-task-plan-generation.ts`

### Rewrite heavily

- `packages/engine/src/modules/commands/stream-task-plan-generation.ts`
- `packages/engine/src/modules/ai/ai-service.ts`
- `apps/server/src/routes/plans.routes.ts`
- `apps/web/src/components/task/ai/task-plan-generation-panel.tsx`
- `apps/web/src/components/task/plan/task-plan-view-model.ts`
- `packages/contracts/src/ai-plan-runtime.ts`

### Add

- `packages/engine/src/modules/commands/generate-task-plan-manual-stream.ts`
- `packages/engine/src/modules/commands/materialize-generated-task-plan.ts`
- `packages/engine/src/modules/queries/task-plan-read-model.ts`
- new tests for canonical SSE result contracts and frontend consumption

### Update

- `packages/engine/src/modules/commands/create-task.ts`
- `packages/engine/src/modules/plan-execution/compiled-plan-store.ts`
- `packages/engine/src/modules/queries/get-task-page.ts`
- `packages/engine/src/modules/queries/get-schedule-page.ts`
- any route/query code returning `savedAiPlan`

### Deleted during finish-up

- `packages/engine/src/modules/plan-execution/saved-plan-snapshot.ts`

## Testing plan

### Engine

1. provider stream extraction returns `AIPlanOutput` from the required tool call
2. missing tool payload returns `INVALID_TOOL_PAYLOAD`
3. empty-node blueprint returns `EMPTY_PLAN`
4. materialization persists compiled plan and initial layers
5. read-model builder returns stable `TaskPlanReadModel`

### API

1. `POST /plan/generate` streams ordered status events and one final `result`
2. final `result` shape matches contract exactly
3. `POST /plan/generate/stop` aborts current generation cleanly
4. `GET /plan/state` returns `savedPlan: TaskPlanReadModel | null`
5. creating a task does not trigger generation

## Current verification snapshot

### Verified done

1. auto-generation removal from `createTask(...)` is present
2. `queue-task-plan-generation.ts` is deleted
3. duplicate `streamTaskPlanGeneration` export was removed from `packages/engine/src/index.ts`
4. `GET /plan/state` and `POST /plan/accept` now return canonical `savedPlan` data
5. active runtime `savedAiPlan` naming was removed from engine/server/web task + schedule paths
6. `planningPrompt` is wired through the manual generation flow
7. production `POST /plan/materialize` route exists again and passes smoke coverage

### Passing targeted verification

1. `bun test packages/engine/src/modules/commands/create-task-auto-plan.bun.test.ts`
2. `bun test apps/server/src/__tests__/api/plan-lifecycle-workflow.bun.test.ts`
3. `bun test apps/server/src/__tests__/api/real-router-smoke.bun.test.ts`
4. `bunx vitest run apps/web/src/components/schedule/__tests__/task-plan-generation-panel.test.tsx`
5. `bunx vitest run apps/web/src/components/schedule/__tests__/selected-block-sheet.test.tsx`

### Remaining unrelated workspace issue

1. `bunx tsc --noEmit --pretty false` still fails in `apps/web/vite.config.ts`
2. current remaining errors observed:
   - `TS2321` excessive stack depth comparing config object to `UserConfig`
   - `TS2769` `plugins: [react()]` / `Plugin<any>[]` not assignable to `PluginOption`
3. no remaining typecheck errors were observed in files changed for this manual-plan cleanup pass

## Finish-up checklist

Use this as the remaining execution list.

### 1. Fix engine export surface

- [x] remove the duplicate `streamTaskPlanGeneration` export from `packages/engine/src/index.ts`
- [x] rerun server API plan lifecycle tests

### 2. Fix frontend SSE final-result parsing

- [x] update `apps/web/src/components/task/ai/task-plan-generation-panel.tsx`
- [x] read SSE `result` payload as `data.result`
- [x] keep local panel state typed as `TaskPlanReadModel`
- [x] verify `onPlanLoaded(...)` and apply flow still receive the canonical model

### 3. Canonicalize `/plan/state`

- [x] change route response field from `savedAiPlan` to `savedPlan`
- [x] remove placeholder blueprint reconstruction in `apps/server/src/routes/plans.routes.ts`
- [x] make saved-state reads return a real canonical `TaskPlanReadModel`
- [x] update callers to consume `savedPlan: TaskPlanReadModel | null`

### 4. Canonicalize `/plan/accept`

- [x] update `POST /api/tasks/:taskId/plan/accept` to return canonical saved plan data
- [x] avoid returning older `{ id, status, prompt, plan, summary }` compatibility payloads

### 5. Remove remaining active `savedAiPlan` runtime naming

- [x] update `packages/engine/src/modules/queries/get-task-page.ts`
- [x] update `packages/engine/src/modules/queries/get-schedule-page.ts`
- [x] update `apps/web/src/components/tasks/task-workspace-page.tsx`
- [x] update `apps/web/src/components/schedule/schedule-page-types.ts`
- [x] align selected-block plan state hooks and route consumers on one canonical name and shape

### 6. Retire remaining legacy snapshot compatibility code

- [x] simplify `packages/engine/src/modules/plan-execution/saved-plan-snapshot.ts`
- [x] remove legacy memory fallback and old graph-shape adaptation if no longer needed by active product paths
- [x] ensure saved snapshot construction is based on canonical persisted plan data only

### 7. Wire `planningPrompt` end to end

- [x] read `planningPrompt` in `POST /plan/generate`
- [x] pass it into `generateTaskPlanManualStream(...)`
- [x] pass it into `materializeGeneratedTaskPlan(...)`
- [x] persist and expose it in the final `TaskPlanReadModel`

### 8. Update tests to the new contract

- [x] rewrite server API tests that still assert `savedAiPlan` or old `planGraph` shapes
- [x] update frontend tests to assert canonical SSE `result.result` handling
- [x] fix Bun/Vitest mocking mismatch in `task-plan-generation-panel.test.tsx`
- [x] add coverage for `/plan/state -> savedPlan`
- [x] add coverage for `/plan/accept` canonical response shape

### 9. Final verification gate

- [x] manual generate streams status -> tool_call -> result -> done in valid order
- [x] final result event always contains canonical `TaskPlanReadModel`
- [x] polling `/plan/state` returns the same semantic model shape as fresh generation
- [x] create-task never triggers background plan generation
- [x] no active runtime path depends on legacy `planGraph` / `savedAiPlan` compatibility payloads

### Post-pass note

- task cleanup checklist is complete for this refactor pass
- only remaining item outside this task scope is the unrelated `apps/web/vite.config.ts` workspace typecheck issue

### Frontend

1. task plan panel renders final graph from `effectivePlan`
2. no legacy graph conversion is used
3. polling `/plan/state` and fresh `/plan/generate` success both update the same local state shape
4. stop/regenerate UX behaves correctly with the new status events

## Main tradeoffs

### Pros

1. one trigger path
2. one authoritative payload source
3. one final API shape
4. route logic becomes thin
5. frontend rendering becomes explicit
6. future automatic generation can be reintroduced safely through the same core service

### Cons

1. broad contract changes across engine, server, and web
2. old tests and UI assumptions will need coordinated rewrites
3. removing cached reuse in phase 1 may increase provider calls temporarily

These tradeoffs are acceptable because the current active-path ambiguity is already a correctness problem.

## Recommendation

Implement the refactor as a contract reset, not a patch.

Most important rule:

> The final `result` event for manual plan generation must always return one canonical `TaskPlanReadModel`, regardless of whether the plan was freshly generated or loaded from existing persisted state.

That single rule prevents the current class of drift from reappearing.
