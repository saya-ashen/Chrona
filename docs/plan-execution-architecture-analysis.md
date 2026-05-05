# Chrona Plan Execution Architecture Analysis

> **Scope:** Plan graph lifecycle from AI blueprint through domain compilation, engine orchestration, node execution, to provider invocation.
> **Date:** 2026-05-05
> **Method:** Source-code audit of all layers (contracts → domain → engine → persistence → API).

---

## 1. Current Implementation Map

### 1.1 Layer Diagram (current reality)

```
┌─────────────────────────────────────────────────────────────┐
│  apps/server/src/routes/                                     │
│  plans.routes.ts          execution.routes.ts                │
│  ───────────────────────────────────────────────────         │
│  Route handlers: Hono validation glue, delegates to engine   │
└──────────────────────┬──────────────────────────────────────┘
                       │ calls
┌──────────────────────▼──────────────────────────────────────┐
│  packages/engine/src/modules/                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  plan-execution/                                       │  │
│  │  orchestrator.ts          advancePlanExecution()        │  │
│  │  node-executor.ts          executePlanNode()            │  │
│  │  executable-path.ts        computeExecutablePath()      │  │
│  │  session-policy.ts         decideNodeExecutionSession() │  │
│  │  plan-run-bridge.ts        createPlanRunFromGraph()     │  │
│  │  plan-run-store.ts         savePlanRun/getPlanRun()     │  │
│  │  apply-plan-patch.ts       applyPlanPatch() [engine]    │  │
│  │  replan-detector.ts        detectPlanDrift()            │  │
│  │  plan-state-store.ts       ensurePlanMainSession()      │  │
│  │  node-child-session.ts     ensureNodeChildSession()     │  │
│  │  settle-node-run.ts        settlePlanNodeFromRun()      │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  tasks/                                                │  │
│  │  task-plan-graph-store.ts   save/load TaskPlanGraph    │  │
│  │  plan-blueprint-compiler.ts compile AI output → graph  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  task-execution/                                       │  │
│  │  execution-registry.ts      createRuntimeExecutionAdapter│
│  └─────────────┬─────────────────────────────────────────┘  │
│  ┌─────────────▼─────────────────────────────────────────┐  │
│  │  runtime-sync/                                         │  │
│  │  sync-run.ts       syncRunFromRuntime() [OpenClaw]     │  │
│  │  mapper.ts         OpenClaw event → canonical          │  │
│  │  freshness.ts      syncStaleWorkspaceRunsForRead()     │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ uses
┌──────────────────────▼──────────────────────────────────────┐
│  packages/domain/src/plan/                                   │
│  validate.ts          validateEditablePlan() [pure]          │
│  patch.ts             applyPlanPatch() [immutable]           │
│  compile.ts           compileEditablePlan() [pure]           │
│  run.ts               createPlanRun(), applyRuntimeCommand() │
│  prompts.ts           buildPlanPatchPrompt()                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ defined by types from
┌──────────────────────▼──────────────────────────────────────┐
│  packages/contracts/src/                                     │
│  ai-plan-blueprint.ts  PlanBlueprint, EditablePlan, Patch   │
│  ai-plan-runtime.ts    CompiledPlan, PlanRun, RuntimeCommand │
│                    (+ legacy TaskPlanGraph, etc.)            │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Persistence

| Artifact | Store | Serialization |
|----------|-------|---------------|
| `TaskPlanGraph` | `Memory` table (scope=task) | JSON blob |
| `PlanRun` | `Memory` table (scope=task, sourceType=agent_inferred) | JSON blob `{type:"plan_run_v1", planRun}` |
| Main execution session | `TaskSession` table | Row |
| Child run records | `Run` table | Row |
| Conversation entries | `ConversationEntry` table | Row |
| Canonical events | `CanonicalEvent` table | Row |

---

## 2. Current Model Taxonomy

### 2.1 Three Type Generations Coexisting

```
Generation 1 (AI output)   →  Generation 2 (Domain)   →  Generation 3 (Compiled)
PlanBlueprint                 EditablePlan               CompiledPlan
  ├─ PlanBlueprintNode          ├─ EditableNode             ├─ CompiledNode
  ├─ PlanBlueprintEdge          ├─ EditableEdge             ├─ CompiledEdge
  └─ loose/optimistic           └─ strict + validated       └─ read-only + ID-mapped
```

**Plus legacy:** `TaskPlanGraph` / `TaskPlanNode` / `TaskPlanEdge` (used by the engine).

### 2.2 Type Details

#### PlanBlueprint (`contracts/ai-plan-blueprint.ts:33`)

- Loose AI output. Nodes have `id`, `type`, optional `dependsOn` (string[]).
- `validateAIPlanOutput()` (legacy). `upgradeBlueprintToEditable()` converts to EditablePlan.
- Used at the API entry boundary: AI generates a blueprint, it's upgraded to EditablePlan.

#### EditablePlan (`contracts/ai-plan-blueprint.ts:93`)

- Strict internal plan. Nodes have `id`, `type`, optional `estimatedMinutes`, `requiredTools`, `parallelizable`.
- Edges are explicit `{from, to}` with optional `condition`.
- Supports 4 node types: `task`, `checkpoint`, `condition`, `wait`.
- Validated by `validateEditablePlan()` in domain.
- Mutated immutably via `applyPlanPatch()` in domain.

#### CompiledPlan (`contracts/ai-plan-runtime.ts:70`)

- Backend-compiled execution graph. **Read-only** — never mutated after creation.
- Nodes have compiled IDs (`cn_...`) with `localId` pointing back to the EditablePlan id.
- Contains pre-computed `dependencies` (list of compiled node IDs) and `dependents`.
- Contains `entryNodeIds`, `terminalNodeIds`, `completionPolicy`, `validationWarnings`.
- Created by `compileEditablePlan()` in domain. No runtime state.

#### PlanRun (`contracts/ai-plan-runtime.ts:211`)

- Execution runtime state. Created from a CompiledPlan.
- `status`: `pending` | `running` | `paused` | `completed` | `cancelled` | `failed`.
- `nodeStates`: `Record<compiledNodeId, NodeRuntimeState>` — per-node execution status.
- NodeRuntimeState contains: `status` (pending/ready/running/completed/failed/blocked/replan_required), `attempts`, `lastError`, `retryCount`, `executedAt`.
- `checkpointResponses`: for checkpoint nodes.
- `artifactRefs`: links to artifacts produced by nodes.

#### TaskPlanGraph (`contracts/ai-plan-runtime.ts` — legacy section)

- **Legacy type** (pre-EditablePlan/CompiledPlan). Still used by the engine.
- Nodes carry `status` inline: `TaskPlanNode.status: TaskPlanNodeStatus` (pending/done/waiting_for_user/waiting_for_approval/blocked/running/failed).
- `dependencies` is a flat array of node IDs (not compiled IDs).
- The engine orchestrator reads and **mutates** `TaskPlanGraph.nodes[*].status` in place.

### 2.3 Control Flow Summary

```
1. AI generates PlanBlueprint → validated → upgradeBlueprintToEditable()
2. EditablePlan is presented to user → user accepts/patch-applies → store as TaskPlanGraph
3. Engine loads TaskPlanGraph → compileBlueprintToCompiledPlan() [for PlanRun bridge]
4. Engine creates PlanRun via createPlanRunFromGraph()
5. Engine loop: computeExecutablePath() → pick ready nodes → executePlanNode()
6. executePlanNode() → decideNodeExecutionSession() → execute or wait
7. Node execution → createRuntimeExecutionAdapter("openclaw") → invoke AI
8. Settling: settlePlanNodeFromRun() mutates TaskPlanGraph node.status
9. Replan: detectPlanDrift() → applyPlanPatch() [engine] mutates TaskPlanGraph
10. Bridge: syncGraphStateToRun() mutates PlanRun.nodeStates in both directions
```

---

## 3. Target Model Comparison

### 3.1 Ideal Layered Architecture (target model)

```
┌─────────────────────────────────────────────────────────────┐
│  API Layer (apps/server)                                     │
│  ────────────────────────────────────────────────             │
│  Hono routes: validate input, call runtime layer, return DTOs│
│  No direct DB access, no business logic.                     │
└──────────────────────┬──────────────────────────────────────┘
                       │ calls
┌──────────────────────▼──────────────────────────────────────┐
│  Runtime / Application Layer (packages/runtime/src/modules/)  │
│  ────────────────────────────────────────────────────────────│
│  Command handlers: startPlan(), advanceNode(), applyPatch()  │
│  Query handlers: getEffectivePlanView()                      │
│  Orchestration: coordinator reads effective view, dispatches │
│  Provider adapter calls go through provider/core              │
│  Uses domain for pure logic, contracts for types              │
└──────────────────────┬──────────────────────────────────────┘
                       │ uses
┌──────────────────────▼──────────────────────────────────────┐
│  Domain Layer (packages/domain/src/plan/)                     │
│  ────────────────────────────────────────────────             │
│  Pure functions (no I/O, no providers, no DB):               │
│  validateEditablePlan(), applyPlanPatch(), compileEditablePlan│
│  createPlanRun(), applyRuntimeCommand()                      │
│  [Missing] computeNodeReadiness() ← does not exist yet       │
│  [Missing] computeEffectivePlanView() ← does not exist yet   │
└──────────────────────┬──────────────────────────────────────┘
                       │ defined by types from
┌──────────────────────▼──────────────────────────────────────┐
│  Contracts Layer (packages/contracts/src/)                    │
│  ────────────────────────────────────────────────             │
│  PlanBlueprint, EditablePlan, PlanPatch                      │
│  CompiledPlan, PlanRun, RuntimeCommand, NodeRuntimeState     │
│  [Missing] EffectivePlanView, NodeReadiness, ReplanDecision  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Target Abstraction: EffectivePlanView

The key missing abstraction is an **EffectivePlanView** — a read-only, denormalized projection that merges `CompiledPlan` (static graph) with `PlanRun.nodeStates` (runtime state) to produce per-node readiness:

```typescript
// Proposed contract
type EffectivePlanView = {
  compiledPlanId: string;
  planRunId: string;
  nodes: Array<{
    compiledNodeId: string;
    localId: string;
    type: "task" | "checkpoint" | "condition" | "wait";
    status: "ready" | "running" | "waiting_for_user" | 
            "waiting_for_approval" | "blocked" | "completed" | "failed" | "pending";
    dependencies: string[];     // compiled IDs
    dependents: string[];       // compiled IDs
    allDependenciesSatisfied: boolean;  // computed
    ready: boolean;             // = status=="ready" || (pending && allDependenciesSatisfied)
    blockedReason?: string;
  }>;
  planStatus: "running" | "paused" | "completed" | "cancelled" | "failed";
  readyNodeIds: string[];       // denormalized for fast lookup
  terminalReason?: string;      // why nothing is ready
  expectedNextNodeId?: string;  // for the UI
};
```

### 3.3 Target Abstraction: NodeReadiness (pure domain function)

```typescript
// domain — pure, no I/O
function computeNodeReadiness(
  compiledNode: CompiledNode,
  nodeState: NodeRuntimeState,
  dependencyStates: Record<string, NodeRuntimeState>
): { ready: boolean; blocked: boolean; reason?: string }
```

Currently this logic lives in `executable-path.ts:predecessorsSatisfied()`, which reads `TaskPlanGraph.node.status` directly. Moving it to domain makes it testable with pure data.

---

## 4. Gap Analysis

### 4.1 Gap: Dual Graph Representation

| Aspect | TaskPlanGraph | CompiledPlan + PlanRun |
|--------|---------------|----------------------|
| **Role** | Active execution graph | Compiled structure + runtime state |
| **Mutation** | Mutable (node.status written in place) | PlanRun is immaturely used; CompiledPlan is immutable |
| **Persistence** | Memory table as JSON | Memory table as JSON (separate row) |
| **Ready-node logic** | Reads node.status directly | Would need EffectivePlanView |
| **Used by engine** | YES (primary) | YES (bridge, but secondary) |
| **Used by domain** | NO | YES (type definitions) |

**Problem:** Two competing representations of the same thing. The engine uses `TaskPlanGraph` as its primary data structure while the domain layer defines `CompiledPlan` + `PlanRun`. The bridge (`plan-run-bridge.ts`) syncs them bidirectionally, adding complexity and potential for drift.

**Target:** Single source of truth. `CompiledPlan` is the structure. `PlanRun` is the state. No `TaskPlanGraph` at runtime.

### 4.2 Gap: Status Embedded in Graph Node vs. State in PlanRun

**Current (TaskPlanGraph):**
```typescript
node.status = "done"  // status is a property of the graph node
```

**Target (CompiledPlan + PlanRun):**
```typescript
run.nodeStates[compiledNodeId].status = "completed"  // status is tracked separately
```

The compiled approach is cleaner: nodes are structural, state is temporal. But the engine doesn't effectively use it — it mutates `TaskPlanGraph` and only sometimes syncs to `PlanRun`.

### 4.3 Gap: No EffectivePlanView Anywhere

The engine's `computeExecutablePath()` in `executable-path.ts` reads `TaskPlanGraph.node.status` and computes readiness imperatively. This logic is coupled to the legacy type and lives in the engine layer.

**What should exist:**
1. A pure domain function `computeNodeReadiness()`.
2. A query function `getEffectivePlanView()` that merges `CompiledPlan` + `PlanRun` → `EffectivePlanView`.
3. The orchestrator reads `EffectivePlanView` instead of `TaskPlanGraph`.

### 4.4 Gap: Provider Leak

**Where the break occurs:**

| File | What leaks |
|------|-----------|
| `node-executor.ts` | Hardcodes `"openclaw"` in main_session path. Imports `execution-registry` which imports `@chrona/openclaw`. |
| `node-child-session.ts:38` | `const runtimeName = input.runtimeName ?? "openclaw"` |
| `execution-registry.ts:24-34` | `loadOpenClawAdapterConfig()` directly queries DB for `aiClient.type === "openclaw"`. |
| `sync-run.ts` | Imports `@chrona/openclaw` types directly. |
| `mapper.ts` | Defines `OpenClawSyncCursor`, `OpenClawConversationEntry` — provider-specific types in the engine. |
| `freshness.ts` | Calls `createRuntimeExecutionAdapter()` and assumes OpenClaw lifecycle. |
| `session-policy.ts` | References openclaw session key patterns. |

**What should happen:**
- Engine should call `packages/providers/core` (a provider-facing middle layer).
- `providers/core` provides a config-agnostic factory: `createAdapter(providerKey)`.
- Provider-specific logic (DB config loading, protocol translation) stays in `packages/providers/openclaw/`.
- `runtime-sync/` should consume canonical contracts, not OpenClaw wire types.

### 4.5 Gap: Patch Application at Wrong Layer

**Domain `applyPlanPatch()`** (`packages/domain/src/plan/patch.ts`):
- Operates on `EditablePlan`.
- Immutable (returns new plan).
- Optimistic locking on version.
- Validates result with `validateEditablePlan()`.

**Engine `applyPlanPatch()`** (`packages/engine/src/modules/plan-execution/apply-plan-patch.ts`):
- Operates on `TaskPlanGraph`.
- **Mutates** nodes, including `node.status`.
- Handles add_node, update_node, delete_node, update_dependencies, update_plan_summary, reorder_nodes, replace_plan.
- No optimistic locking.
- No validation of the result graph.

**Problem:** Two separate patch application functions for two different types. The engine version mutates graph state directly. If a replan modifies the structure, the domain-editable version never reflects it.

**Target:** Single patch application flow:
1. AI/human proposes `PlanPatch` (contracts).
2. Domain `applyPlanPatch()` applies to `EditablePlan` immutably.
3. `EditablePlan` → recompile → new `CompiledPlan`.
4. `getEffectivePlanView()` reflects all changes — no separate mutation path needed.

### 4.6 Gap: No Orchestration in the Runtime Layer

The engine layer (`packages/engine/`) contains the orchestrator (`orchestrator.ts:advancePlanExecution()`), but the architecture prescribes that `packages/runtime/src/modules/` should own orchestration.

**Current state:** `packages/engine/` does everything:
- Orchestration (pick ready nodes, execute, handle replan)
- Node execution (session creation, provider invocation, DB writes)
- Sync (bidirectional bridge, OpenClaw sync)
- Persistence (save/load TaskPlanGraph, PlanRun, sessions)
- Replan detection and application

**Target state:** `packages/runtime/src/modules/plan-execution/` owns orchestration. Engine should be a facade.

### 4.7 Gap: Settling Logic Spread Across Files

Child run settling is scattered across:
- `settle-node-run.ts` — reads run, mutates TaskPlanGraph node, persists, rebuilds projection, updates task status.
- `node-child-session.ts` — creates child sessions/runs, reads adapter history, persists conversation entries to DB.
- `node-executor.ts:main_session path` — creates run records, calls adapter, reads history, persists conversation entries.

These should be unified under a single `settleRun()` or `finalizeNodeExecution()` flow.

### 4.8 Gap: No Runtime Command Processing in Domain for Two Types

`applyRuntimeCommand()` in `domain/run.ts` only handles the `PlanRun` (domain) model. Commands like `approve_checkpoint`, `mark_user_task_completed`, `retry_node` are applied to `PlanRun.nodeStates`. But the engine applies different mutations to `TaskPlanGraph` nodes directly (via `apply-plan-patch.ts`).

### 4.9 Gap Summary Table

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 1 | Dual graph (TaskPlanGraph vs CompiledPlan+PlanRun) | High | Eliminate TaskPlanGraph; use CompiledPlan+PlanRun exclusively |
| 2 | No EffectivePlanView | High | Add domain function + query |
| 3 | Provider leak (OpenClaw hardcoded) | High | Provider core layer, adapter factory |
| 4 | Two patch applications | Medium | Unify to domain applyPlanPatch → recompile |
| 5 | Orchestration in engine, not runtime | Medium | Move to runtime modules |
| 6 | Settling logic scattered | Medium | Unify settle flow |
| 7 | Ready-node computation at wrong layer | Low | Move to domain |
| 8 | sync-run.ts imports OpenClaw types | Medium | Canonical event types, provider-core bridge |
| 9 | Session-policy assumes openclaw keys | Low | Generic session strategies |

---

## 5. Proposed Target Abstractions

### 5.1 EffectivePlanView (contract + query)

**Contract:** `packages/contracts/src/ai-plan-runtime.ts` (new export)

```typescript
export type EffectiveNodeView = {
  compiledNodeId: string;
  localId: string;
  type: "task" | "checkpoint" | "condition" | "wait";
  config: Record<string, unknown>;
  status: NodeRuntimeStatus;
  ready: boolean;
  blockedReason?: string;
  dependenciesSatisfied: boolean;
  dependencies: string[];
  dependents: string[];
  attempts: number;
  lastError?: string;
};

export type EffectivePlanView = {
  compiledPlanId: string;
  planRunId: string;
  planRunStatus: PlanRunStatus;
  nodes: EffectiveNodeView[];
  readyNodeIds: string[];
  waitingNodeIds: string[];
  blockedNodeIds: string[];
  completedNodeIds: string[];
  terminalReason?: string;
};
```

**Domain function:** `packages/domain/src/plan/effective-view.ts`

```typescript
function computeEffectivePlanView(
  compiled: CompiledPlan,
  run: PlanRun
): EffectivePlanView
```

Pure function. Zero I/O. Takes compiled plan and run state, merges them, computes readiness. Testable with unit tests.

### 5.2 Provider Core Facade (packages/providers/core/)

```typescript
// packages/providers/core/src/adapter-factory.ts
async function createProviderAdapter(
  providerKey: string
): Promise<RuntimeExecutionAdapter>

// Internally: loads provider config from DB (provider-agnostic config key),
// calls provider-specific factory.
// Provider-specific packages (openclaw, research) register themselves.
```

### 5.3 Event Bridge (instead of adapter.readHistory() in engine)

```typescript
// packages/providers/core/src/event-bridge.ts
type CanonicalRunEvent = {
  type: "message" | "tool_call" | "approval_created" | "run_completed" | "run_failed";
  payload: Record<string, unknown>;
};

async function syncRunEvents(
  adapter: RuntimeExecutionAdapter,
  cursor: string
): Promise<{ events: CanonicalRunEvent[]; nextCursor: string }>
```

The engine calls `syncRunEvents()` — it never sees OpenClaw-specific wire types. Mapper logic stays in `packages/providers/openclaw/`.

### 5.4 Execution Coordinator (packages/runtime/src/modules/plan-execution/)

```typescript
// coordinator.ts
async function advancePlanExecution(
  taskId: string
): Promise<PlanAdvancementResult> {
  const run = await getPlanRun(taskId);           // PlanRun from store
  const compiled = await getCompiledPlan(taskId); // CompiledPlan from store
  const view = computeEffectivePlanView(compiled, run);  // domain (pure)
  
  for (const readyNode of view.readyNodeIds) {
    const result = await executePlanNode(readyNode, compiled, run);
    // apply node result back to PlanRun via applyRuntimeCommand()
    // persist
  }
}
```

### 5.5 Unify Run State Persistence

Replace separate `Memory` rows for `TaskPlanGraph` and `PlanRun` with:
- `CompiledPlan` stored once (structural, immutable after recompile).
- `PlanRun` stored as the single runtime state artifact.
- `getEffectivePlanView()` is a read query, not a separate stored artifact.

### 5.6 Patch → Recompile Pipeline

```
PlanPatch (AI or user)
  → domain.applyPlanPatch(editablePlan, patch)
  → domain.compileEditablePlan(newEditablePlan)
  → persist new CompiledPlan
  → recompute PlanRun (new node entries for added nodes, remove for deleted)
  → getEffectivePlanView() reflects everything
```

---

## 6. Migration Strategy

### Phase 0 — Add Tests for Gaps
**No behavior changes.** Add tests for:
- `computeEffectivePlanView()` (new domain function — write tests first).
- `computeNodeReadiness()` (extract + test existing logic).
- Add integration tests that verify `CompiledPlan` + `PlanRun` = correct effective view.
- Add provider-core interface tests.

### Phase 1 — Extract EffectivePlanView (Domain)
- Add `computeEffectivePlanView()` and `computeNodeReadiness()` to `packages/domain/src/plan/`.
- Add types to `packages/contracts/src/ai-plan-runtime.ts`.
- **Do not change engine code yet.** These are pure functions added alongside existing mutable code.
- Run existing tests (should all pass — new code is additive).

### Phase 2 — Add Provider Core Facade (Providers)
- Create `packages/providers/core/src/adapter-factory.ts`.
- Move `loadOpenClawAdapterConfig()` logic to `packages/providers/openclaw/src/config.ts`.
- `createRuntimeExecutionAdapter()` in `execution-registry.ts` delegates to `createProviderAdapter()`.
- Add provider-agnostic `syncRunEvents()` in providers/core.
- **No engine code changes yet** — just make the adapter call path go through core.

### Phase 3 — Engine Refactor: Use EffectivePlanView
- In `advancePlanExecution()`, replace `computeExecutablePath()` calls with `computeEffectivePlanView()`.
- Stop reading `TaskPlanGraph.node.status` for ready-node computation.
- Sync is still bidirectional (bridge) for this phase, but ready-node logic comes from domain.
- Run all tests, validate no behavior change.

### Phase 4 — Eliminate TaskPlanGraph Mutations
- Stop using `apply-plan-patch.ts` (engine-level mutation).
- Replace with: AI/human patch → `domain.applyPlanPatch()` → `recompile()` → new `CompiledPlan`.
- Remove `updateNodeStatus()` in orchestrator — use `applyRuntimeCommand()` on `PlanRun` instead.
- Remove bidirection sync in `plan-run-bridge.ts` — `PlanRun` is the single source of truth.
- `getEffectivePlanView()` becomes the authoritative read path.

### Phase 5 — Unify Settle + Clean Provider Boundary
- Consolidate `settle-node-run.ts` and `node-child-session.ts` settlement logic into a single `finalizeNodeExecution()` in the coordinator.
- Remove `sync-run.ts` direct OpenClaw imports — use `syncRunEvents()` from providers/core.
- Remove `mapper.ts` OpenClaw-specific types — move to `packages/providers/openclaw/`.
- Remove `freshness.ts` OpenClaw assumptions — make provider-agnostic.
- Remove hardcoded `"openclaw"` in `node-executor.ts` and `node-child-session.ts`.

### Phase 6 — Delete Legacy Types
- Remove `TaskPlanGraph`, `TaskPlanNode`, `TaskPlanEdge`, `TaskPlanNodeStatus` from contracts.
- Remove `task-plan-graph-store.ts` persistence.
- Remove `plan-blueprint-compiler.ts` compile-to-legacy path.
- Remove `plan-run-bridge.ts` (no longer needed).
- Clean up any remaining references.

### Migration Governance

Each phase:
1. Write tests for new target behavior.
2. Implement phase changes.
3. Run `bun run typecheck`, `bun run lint`, `bun run test`.
4. Verify no behavior regression.
5. Commit.

---

## 7. Design Constraints

### 7.1 Layer Boundaries (from AGENTS.md)

- **Domain** (`packages/domain/`): Must remain pure. No imports from React, Prisma, `fetch`, or `process.env`. No I/O.
- **Contracts** (`packages/contracts/`): Type definitions and Zod schemas only. No implementation.
- **Engine** (`packages/engine/`): Business logic + persistence + provider integration. Must not import React. Must not contain business logic that belongs in domain.
- **API** (`apps/server/`): Hono routes only — validation glue, call engine, return responses. No direct DB access.
- **Providers** (`packages/providers/`): Provider-specific logic. `core/` is the middle layer Chrona calls. Provider packages consume business contracts — must not invent competing schemas.

### 7.2 Runtime Constraints

- **Bun only.** No Node.js runtime. `Bun.serve()`, Bun SQLite, Bun tests.
- **No `@hono/node-server`.** Server entry is `apps/server/src/index.bun.ts`.
- **Prisma 7** with `prisma-adapter-bun-sqlite` (Bun-only).
- **OpenClaw** is the primary AI provider. Research provider is secondary. Both go through `providers/core`.

### 7.3 Type Constraints

- **Strict TypeScript everywhere.**
- **Zod** for runtime validation at API boundaries.
- **No `any`** in contracts or domain.

### 7.4 Test Constraints

- `bun run test:bun` for Bun-native tests (domain).
- `bun run test` for Vitest (frontend/general).
- All domain functions must have tests (witness: `plan.bun.test.ts` with 47 test cases).

---

## 8. Open Questions

1. **Replan during execution:** When a node detects replan_required, should the orchestrator pause all running nodes and wait for the patch to be applied, or should completed nodes continue to settle?
   - *Relevant files:* `replan-detector.ts:detectPlanDrift()`, `orchestrator.ts` replan handling.

2. **Node deletion during active run:** If a replan removes a node that is currently `running`, what happens? The current code in `apply-plan-patch.ts` (engine) just removes it. The domain `applyPlanPatch` for `EditablePlan` doesn't check for active runs.
   - *Needed:* `PlanPatch` operation validation against active `PlanRun` state.

3. **Condition node evaluation:** `evaluationBy: "system" | "ai" | "user"` — who evaluates condition branches at execution time? The current code stores branches but there's no runtime branch-evaluation logic visible in the engine.
   - *Relevant:* `contracts/ai-plan-blueprint.ts:EditableConditionNode.evaluationBy`, `compile.ts` condition branch handling.

4. **Parallel execution across sessions:** When two nodes launch child sessions concurrently, how are session conflicts handled? `session-policy.ts` only checks for main vs. child, not for concurrent child collisions.
   - *Relevant:* `node-child-session.ts`, `session-policy.ts`.

5. **Checkpoint node execution:** `executePlanNode()` in `node-executor.ts` handles checkpoints, but how does the checkpoint UI flow work? The checkpoint creates a `waiting_for_approval` status — does the engine poll or does a webhook/SSE push the approval back?
   - *Relevant:* `node-executor.ts:93-128` (checkpoint branch), `execution.routes.ts` approval routes.

6. **PlanRun vs TaskPlanGraph drift detection:** Should the system detect when `PlanRun` and `TaskPlanGraph` states diverge (due to bugs in the bidirectional bridge)? This could be a health check.
   - *Relevant:* `plan-run-bridge.ts`.

7. **Migration strategy for persisted `TaskPlanGraph` data:** How to migrate existing `Memory` table rows from `TaskPlanGraph` to `CompiledPlan + PlanRun`? Forward compatibility required.

8. **Wait node implementation:** `EditableWaitNode` has `waitFor: string` and `timeout?: { minutes: number; onTimeout: "fail" | "skip" | "retry" }`. Is there a timer/scheduler that resolves these, or are they always user-commanded (`mark_user_task_completed`)?
   - *Relevant:* `domain/run.ts:applyRuntimeCommand()`, no timer logic visible.

9. **Completion policy extensibility:** `completionPolicy: { type: "all_tasks_completed" }` — is this the only policy, or will there be `"any_terminal_reached"` or `"user_declared_done"`?
   - *Relevant:* `compile.ts`, `run.ts:checkPlanCompletion()`.

10. **Can `CompiledNode.config` carry everything needed for execution, or does the engine still need to reach back to `EditableNode` for some fields?**
    - The `compileEditablePlan()` function copies `config` but is the mapping complete for all four node types?

---

## 9. Final Deliverable

### Files Catalogued (Full Audit)

| # | File | Lines | Layer |
|---|------|-------|-------|
| 1 | `packages/contracts/src/ai-plan-blueprint.ts` | 565 | contracts |
| 2 | `packages/contracts/src/ai-plan-runtime.ts` | 469 | contracts |
| 3 | `packages/contracts/src/ai.ts` | export | contracts |
| 4 | `packages/domain/src/plan/validate.ts` | 257 | domain |
| 5 | `packages/domain/src/plan/patch.ts` | 389 | domain |
| 6 | `packages/domain/src/plan/compile.ts` | 213 | domain |
| 7 | `packages/domain/src/plan/run.ts` | 247 | domain |
| 8 | `packages/domain/src/plan/prompts.ts` | 85 | domain |
| 9 | `packages/domain/src/plan/plan.bun.test.ts` | 1002 | domain tests |
| 10 | `packages/engine/src/.../plan-execution/orchestrator.ts` | 825 | engine |
| 11 | `packages/engine/src/.../plan-execution/node-executor.ts` | 321 | engine |
| 12 | `packages/engine/src/.../plan-execution/executable-path.ts` | 211 | engine |
| 13 | `packages/engine/src/.../plan-execution/session-policy.ts` | 145 | engine |
| 14 | `packages/engine/src/.../plan-execution/plan-run-bridge.ts` | 221 | engine |
| 15 | `packages/engine/src/.../plan-execution/plan-run-store.ts` | 112 | engine |
| 16 | `packages/engine/src/.../plan-execution/apply-plan-patch.ts` | 267 | engine |
| 17 | `packages/engine/src/.../plan-execution/replan-detector.ts` | 77 | engine |
| 18 | `packages/engine/src/.../plan-execution/plan-state-store.ts` | 115 | engine |
| 19 | `packages/engine/src/.../plan-execution/node-child-session.ts` | 221 | engine |
| 20 | `packages/engine/src/.../plan-execution/settle-node-run.ts` | 238 | engine |
| 21 | `packages/engine/src/.../plan-execution/index.ts` | 13 | engine |
| 22 | `packages/engine/src/.../tasks/task-plan-graph-store.ts` | 529 | engine |
| 23 | `packages/engine/src/.../tasks/plan-blueprint-compiler.ts` | 364 | engine |
| 24 | `packages/engine/src/.../runtime-sync/sync-run.ts` | 349 | engine |
| 25 | `packages/engine/src/.../runtime-sync/mapper.ts` | 393 | engine |
| 26 | `packages/engine/src/.../runtime-sync/freshness.ts` | 128 | engine |
| 27 | `packages/engine/src/.../task-execution/execution-registry.ts` | 49 | engine |
| 28 | `packages/runtime-core/src/contracts.ts` | 96 | provider boundary |
| 29 | `apps/server/src/routes/plans.routes.ts` | 655 | api |
| 30 | `apps/server/src/routes/execution.routes.ts` | 470 | api |

**Total lines audited: ~8,568 across 30 files.**

### Core Architectural Problems Identified

1. **Dual graph entanglement** — `TaskPlanGraph` (legacy) and `CompiledPlan + PlanRun` (target) coexist with a bidirectional bridge. The bridge creates state drift risk and doubles the mutation surface.

2. **No EffectivePlanView** — Ready-node computation is coupled to `TaskPlanGraph.node.status` in engine code. This belongs in domain as a pure merge of `CompiledPlan` + `PlanRun`.

3. **Provider leak** — 5+ files in the engine layer import OpenClaw types or hardcode `"openclaw"`. No provider-core abstraction exists between the engine and providers.

4. **Two patch systems** — Domain `applyPlanPatch()` (immutable, EditablePlan) and engine `applyPlanPatch()` (mutable, TaskPlanGraph) implement overlapping logic on different types.

5. **Settling logic fragmentation** — 3+ files handle pieces of node settlement (status update, child run creation, conversation entry persistence, task status update).

6. **Orchestration at wrong layer** — The orchestrator lives in `packages/engine/` but should be in `packages/runtime/src/modules/` per the prescribed architecture.

### Recommended Execution Order

| Priority | Phase | Action |
|----------|-------|--------|
| P0 | Phase 0 | Add tests for EffectivePlanView and provider-core |
| P1 | Phase 1 | Implement EffectivePlanView in domain (pure, additive) |
| P1 | Phase 2 | Create provider-core facade (additive) |
| P2 | Phase 3 | Switch engine to use EffectivePlanView for ready-node computation |
| P2 | Phase 4 | Eliminate TaskPlanGraph mutations |
| P3 | Phase 5 | Clean provider boundary, unify settle |
| P4 | Phase 6 | Delete legacy types |
