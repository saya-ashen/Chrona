# Unified Task Plan Graph Implementation Plan

> For Hermes: use this as the implementation source of truth for migrating Chrona from split placeholder task plans + subtasks toward a unified plan-first architecture.

Goal

Replace the current split model of:
- workbench-only placeholder task plans,
- schedule/task-cockpit AI plans,
- and loosely related child tasks,

with a single implementable Plan-first model where:
- a task owns one or more versioned plans,
- a plan contains structured nodes and edges,
- workbench reads the plan directly,
- task cockpit creates/revises/accepts plans,
- and only selected executable nodes are materialized into real child tasks for scheduling/execution.

Architecture

The core architectural decision is:
- Plan is the canonical planning model.
- Subtasks are no longer the primary planning primitive.
- Instead, subtasks become one possible materialization of plan nodes.

This gives one source of truth for:
- AI-generated plans,
- workbench execution path,
- user-confirmed planning revisions,
- and schedule-visible executable child tasks.

Tech Stack

- Next.js app routes / server actions
- Prisma + existing SQLite schema
- TypeScript types under `src/modules/*` and `src/components/*`
- Existing Task / TaskDependency / Memory / Event infrastructure
- Existing AI decomposition endpoint `/api/ai/decompose-task`

---

## 1. Problem Statement

Current system has 3 overlapping planning representations:

1. Workbench task plan
- Source: latest `task.plan_generated` / `task.plan_updated` event
- Consumer: `src/modules/queries/get-work-page.ts`
- UI: `src/components/work/task-plan-side-panel.tsx`, `src/components/work/work-inspector.tsx`
- Problem: mostly placeholder-oriented, event-derived, not canonical, weakly connected to subtasks.

2. AI task planning in task cockpit
- Source: `/api/ai/decompose-task` + task AI plan memory draft/accepted state
- Consumer: `src/components/tasks/task-ai-sidebar.tsx`
- Problem: richer and closer to desired behavior, but not the same structure consumed by workbench.

3. Subtasks
- Source: child `Task` rows with `parentTaskId` and `TaskDependency`
- Consumer: schedule popup/task pages/subtask APIs
- Problem: executable and schedulable, but too rigid to express checkpoints, user-input pauses, branching, or flow-level planning metadata.

This creates duplication and semantic drift.

---

## 2. Target Model

Introduce a unified `TaskPlanGraph` domain model.

### 2.1 Canonical idea

A task owns versioned plans.
Each plan contains:
- plan-level metadata,
- nodes,
- edges,
- optional linkage to materialized child tasks.

### 2.2 Core plan types

Use these TypeScript domain types as the first implementation target.

```ts
export type TaskPlanStatus = "draft" | "accepted" | "superseded" | "archived";

export type TaskPlanNodeType =
  | "step"
  | "checkpoint"
  | "decision"
  | "user_input"
  | "deliverable"
  | "tool_action";

export type TaskPlanNodeStatus =
  | "pending"
  | "in_progress"
  | "waiting_for_user"
  | "blocked"
  | "done"
  | "skipped";

export type TaskPlanEdgeType =
  | "sequential"
  | "depends_on"
  | "branches_to"
  | "unblocks"
  | "feeds_output";

export type TaskPlanNodeExecutionMode = "none" | "child_task" | "inline_action";

export type TaskPlanNode = {
  id: string;
  type: TaskPlanNodeType;
  title: string;
  objective: string;
  description: string | null;
  status: TaskPlanNodeStatus;
  phase: string | null;
  estimatedMinutes: number | null;
  priority: "Low" | "Medium" | "High" | "Urgent" | null;
  executionMode: TaskPlanNodeExecutionMode;
  linkedTaskId: string | null;
  needsUserInput: boolean;
  metadata: Record<string, unknown> | null;
};

export type TaskPlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: TaskPlanEdgeType;
  metadata: Record<string, unknown> | null;
};

export type TaskPlanGraph = {
  id: string;
  taskId: string;
  status: TaskPlanStatus;
  revision: number;
  source: "ai" | "user" | "mixed";
  generatedBy: string | null;
  prompt: string | null;
  summary: string | null;
  changeSummary: string | null;
  createdAt: string;
  updatedAt: string;
  nodes: TaskPlanNode[];
  edges: TaskPlanEdge[];
};
```

### 2.3 Key design rule

The plan is the canonical structure.
Child tasks are optional materializations for nodes where:
- execution must be independently tracked,
- scheduling matters,
- runtime config diverges,
- or a node should become a first-class executable unit.

---

## 3. Product Semantics

### 3.1 What a node represents

Examples:
- `step`: a normal actionable planning step
- `checkpoint`: a preparation or verification gate
- `user_input`: a node that explicitly requires user confirmation or info
- `decision`: a branch point or mutually exclusive choice
- `deliverable`: produce an output, memo, report, artifact
- `tool_action`: a concrete low-level action if needed

### 3.2 What becomes a child task

Only nodes with `executionMode: "child_task"` should be materialized into real `Task` records.

This solves the current mismatch:
- not every planning item should become a subtask,
- but true executable units still can become subtasks.

### 3.3 How pages consume the plan

Task cockpit
- create / revise / accept / replan plan versions
- show prompt, revision, summary, and current graph projection

Workbench
- show current node, next nodes, blocked nodes, user-input nodes, deliverables
- read directly from accepted plan if present; otherwise latest draft

Schedule
- show only materialized child tasks
- top-level queue remains clean
- no direct rendering of every plan node unless explicitly materialized

---

## 4. Persistence Strategy

### 4.1 Phase 1 persistence choice

Do not add new Prisma tables first.
Use existing `Memory` persistence as the short-term canonical store for plans.

Reason:
- current repo already persists task AI plans in task-scoped memory,
- faster to migrate behavior incrementally,
- avoids destabilizing current Task/Projection chains too early.

### 4.2 Memory payload format

Replace the current `task_ai_plan_v1` payload with a richer graph shape.

```ts
{
  type: "task_plan_graph_v1",
  status: "draft" | "accepted" | "superseded" | "archived",
  revision: number,
  source: "ai" | "user" | "mixed",
  generatedBy: string | null,
  prompt: string | null,
  summary: string | null,
  changeSummary: string | null,
  nodes: [...],
  edges: [...]
}
```

### 4.3 Plan store module

Create a dedicated store module:
- `src/modules/tasks/task-plan-graph-store.ts`

Responsibilities:
- getLatestTaskPlanGraph(taskId)
- getAcceptedTaskPlanGraph(taskId)
- saveTaskPlanGraph(...)
- acceptTaskPlanGraph(...)
- supersedeOlderTaskPlanGraphs(...)
- parse/serialize payload safely

### 4.4 Long-term persistence

After the graph model stabilizes in production behavior, introduce dedicated Prisma tables:
- `TaskPlan`
- `TaskPlanNode`
- `TaskPlanEdge`

But this is explicitly a Phase 3 optimization, not the first move.

---

## 5. Data Flow Changes

### 5.1 AI generation flow

Current:
- `/api/ai/decompose-task` returns decomposition result
- task cockpit stores draft memory

Target:
- `/api/ai/decompose-task` becomes the generator for a normalized `TaskPlanGraph`
- it may still reuse decomposition + automation internals, but the final response shape should be graph-oriented
- if `taskId && !forceRefresh`, return saved latest plan graph first
- otherwise generate and save new draft graph

### 5.2 Materialization flow

New flow needed:
- create / sync child tasks from plan nodes marked `executionMode: "child_task"`

Create a dedicated command:
- `src/modules/commands/materialize-task-plan.ts`

Responsibilities:
- for each materializable node, create or update a child task
- write `linkedTaskId` back into the plan payload
- create `TaskDependency` edges as needed
- preserve plan node identity across replans where possible

### 5.3 Workbench read flow

Current workbench derives from latest plan event payload.

Target:
- `getWorkPage(...)` should read from accepted plan graph first
- fallback to latest draft if no accepted plan exists
- event history remains secondary audit trail, not the canonical source

This is the single most important behavior shift.

---

## 6. UI Migration Plan

### 6.1 Task cockpit

Files:
- `src/components/tasks/task-ai-sidebar.tsx`
- `src/modules/queries/get-task-page.ts`

Changes:
- continue showing draft / accepted state
- replace decomposition-result-centric rendering with graph plan summary rendering
- support:
  - planning prompt
  - replan
  - accept
  - materialize/apply
- accepted plans should not auto-regenerate
- draft plans should reopen as-is

### 6.2 Workbench

Files:
- `src/modules/queries/get-work-page.ts`
- `src/components/work/task-plan-side-panel.tsx`
- `src/components/work/work-inspector.tsx`
- `src/components/work/work-page-client.tsx`

Changes:
- rename conceptual source from placeholder plan -> plan graph projection
- side panel should show:
  - current node
  - upcoming executable nodes
  - checkpoints
  - waiting-for-user nodes
  - linked child tasks
- remove `占位计划` semantics once graph data is real

### 6.3 Schedule

Files:
- schedule query chain as needed

Changes:
- schedule page should continue consuming only materialized child tasks
- no direct queue pollution from non-executable plan nodes

---

## 7. Proposed Incremental Phases

## Phase A — Define the unified graph model

Objective
- Introduce one canonical plan graph type and store.

Files
- Create: `src/modules/tasks/task-plan-graph-store.ts`
- Modify: `src/modules/ai/types.ts`
- Modify: `src/app/api/ai/decompose-task/route.ts`

Steps
1. Define `TaskPlanGraph`, `TaskPlanNode`, `TaskPlanEdge` types.
2. Add parse/serialize helpers.
3. Save generated plans as `task_plan_graph_v1` in Memory.
4. Keep backward compatibility by reading old `task_ai_plan_v1` if present, mapping it into graph format.

Verification
- New and old plans can both be parsed.
- Existing task cockpit still works.

## Phase B — Make task cockpit graph-native

Objective
- Task cockpit should generate, reopen, accept, and replan graph-based plans.

Files
- Modify: `src/components/tasks/task-ai-sidebar.tsx`
- Modify: `src/modules/queries/get-task-page.ts`
- Modify: `src/app/api/ai/task-plan/accept/route.ts`

Steps
1. Return saved graph plan metadata from `getTaskPage`.
2. Show saved draft/accepted graph version.
3. Replan with prompt should create a new draft graph revision.
4. Accept should mark current graph accepted and supersede older accepted versions.

Verification
- First open auto-generates only when no plan exists.
- Reopen shows saved draft.
- Accept locks in current graph.
- Replan creates a fresh revision with prompt recorded.

## Phase C — Move workbench off placeholder event plans

Objective
- Work page should read the unified graph, not placeholder event payloads.

Files
- Modify: `src/modules/queries/get-work-page.ts`
- Modify: `src/components/work/task-plan-side-panel.tsx`
- Modify: `src/components/work/work-inspector.tsx`
- Modify: `src/components/work/work-page/work-page-types.ts`

Steps
1. Add a graph -> workbench projection helper.
2. Prioritize accepted graph, fallback to latest draft.
3. Keep old event-derived fallback only as temporary compatibility.
4. Replace current `steps` assumptions with node projection.

Verification
- Work page reflects the same plan shown in task cockpit.
- No more placeholder-only rail for tasks with accepted AI plans.

## Phase D — Materialize executable nodes into child tasks

Objective
- Connect graph planning to actual executable/schedulable tasks.

Files
- Create: `src/modules/commands/materialize-task-plan.ts`
- Modify: `src/app/api/ai/batch-decompose/route.ts` or add a dedicated route
- Modify: task cockpit apply behavior

Steps
1. Choose node -> child task mapping rules.
2. Create/update child tasks for materializable nodes.
3. Save `linkedTaskId` back into plan graph.
4. Create TaskDependency edges between child tasks where graph edges require it.

Verification
- Work page graph links to child tasks.
- Schedule sees only materialized child tasks.
- Replan can preserve or supersede linked child tasks safely.

## Phase E — Optional graph visualization

Objective
- Add graph preview, not full editing.

Files
- Create: `src/components/tasks/task-plan-graph-preview.tsx`
- Optional: `src/components/work/task-plan-graph-preview.tsx`

Steps
1. Render read-only graph/DAG preview.
2. Highlight current node and blocked branches.
3. Keep list projection as primary UX.

Verification
- Graph preview improves comprehension but is not required for correctness.

---

## 8. Backward Compatibility Rules

During migration, maintain these compatibility rules:

1. Old saved AI plan memory payloads must still load.
2. Old event-based work plans must still display if no graph exists yet.
3. Existing child tasks remain valid; they should be adoptable into linked plan nodes later.
4. No schedule regression: child tasks must still stay out of top-level queue.

---

## 9. Recommended File-by-File Implementation Order

1. `src/modules/tasks/task-plan-graph-store.ts`
2. `src/modules/ai/types.ts`
3. `src/app/api/ai/decompose-task/route.ts`
4. `src/modules/queries/get-task-page.ts`
5. `src/components/tasks/task-ai-sidebar.tsx`
6. `src/modules/queries/get-work-page.ts`
7. `src/components/work/task-plan-side-panel.tsx`
8. `src/components/work/work-inspector.tsx`
9. `src/modules/commands/materialize-task-plan.ts`
10. schedule-side integration if needed

---

## 10. Test Plan

### Query / store tests
- `src/modules/queries/__tests__/get-task-page*.test.ts`
- `src/modules/queries/__tests__/get-work-page.bun.test.ts`
- new tests for `task-plan-graph-store`

### Component tests
- `src/components/tasks/task-ai-sidebar.test.tsx`
- `src/components/tasks/task-page.test.tsx`
- `src/components/work/work-page-client.test.tsx`
- `src/components/work/task-plan-side-panel*.test.tsx`
- `src/components/work/work-inspector*.test.tsx`

### Command / route tests
- `src/app/api/ai/decompose-task/*.test.ts`
- `src/app/api/ai/task-plan/accept/*.test.ts`
- `src/modules/commands/materialize-task-plan*.test.ts`

### Must-have acceptance tests
1. No saved plan -> cockpit auto-generates
2. Saved draft exists -> cockpit reopens draft without auto-regenerating
3. Accepted plan exists -> cockpit shows accepted plan + replan button only
4. Replan with prompt -> new revision saved
5. Workbench shows accepted graph plan instead of placeholder event-only plan
6. Materialized nodes create child tasks
7. Schedule only shows materialized child tasks, not every plan node

---

## 11. Important Constraints and Pitfalls

1. Do not make graph editing UI before graph data is stable.
2. Do not let workbench and cockpit drift into separate plan representations again.
3. Do not materialize every node into child tasks by default.
4. Do not keep placeholder event plans as the long-term truth source.
5. Keep `TaskDependency` meaningful:
   - `child_of` for hierarchy
   - `blocks` for execution ordering between materialized children
6. If using Memory as the interim store, explicitly version payloads and keep migration helpers simple.

---

## 12. Final Recommendation

Adopt this product rule:

- Plan graph is the planning truth.
- Child tasks are execution truth for selected executable nodes.
- Workbench consumes plan graph.
- Schedule consumes materialized child tasks.
- Task cockpit manages plan versions.

This gives one coherent architecture while preserving the practical value of existing subtasks.

---

## 13. Immediate Next Step

The next implementation step should be:

Implement Phase A only.

Concretely:
1. introduce `task_plan_graph_v1` payload and store module,
2. make `/api/ai/decompose-task` read/write it,
3. make task cockpit consume it,
4. leave workbench placeholder compatibility in place for one migration slice.

This is the smallest valuable slice that establishes a single planning source of truth.
