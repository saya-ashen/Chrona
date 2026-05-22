# @chrona/graph-runtime

Pure domain package for Chrona dynamic plan graph execution.

This package is Chrona's lightweight, project-specific LangGraph-like runtime. It owns graph execution state, graph mutation, dependency traversal, invalidation, command reduction, node attempt/result lifecycle, validation, and deterministic runtime events.

It must not depend on DB, Prisma, server routes, providers, Task business logic, WorkBlock business logic, or UI code. Those concerns belong in host adapters such as `engine` or `server`.

## Runtime Boundary

This package owns:

- effective graph resolution
- node readiness and blocked-state calculation
- dependency traversal and edge semantics
- graph mutation application
- structural impact analysis
- downstream invalidation planning/application
- node attempt lifecycle
- node result lifecycle
- execution context snapshots
- command reduction for start/resume/retry/cancel/mutate/sync
- executor registry contracts
- external async sync state transitions
- validation and graph invariants
- deterministic runtime events

This package does not own:

- Prisma or database access
- Hono route handlers
- React state or UI components
- provider-specific clients
- Task or WorkBlock business persistence
- auth/session concerns
- schedule storage
- provider artifact storage

The host application should load and persist graph state, provide node executors, persist emitted events, and map product/API actions to runtime commands.

## Usage

Build or load a `PlanGraph`, create a runtime with executor callbacks, then dispatch commands. The runtime returns the next graph state, effective graph, status, message, executed node ids, and emitted events.

```ts
import {
  createGraphRuntime,
  createPlanGraphFromCompiledPlan,
  executeBuiltinGraphNode,
  type CompiledPlan,
  type GraphExecutionState,
} from "@chrona/graph-runtime";

const compiledPlan: CompiledPlan = {
  id: "compiled_1",
  editablePlanId: "graph_1",
  sourceVersion: 1,
  nodes: [
    {
      id: "choose_path",
      localId: "choose_path",
      type: "condition",
      title: "Choose path",
      description: "Ask the user which path to run",
      config: {
        condition: "Which path should run?",
        evaluationBy: "user",
        branches: [{ label: "yes", nextNodeId: "finish" }],
      },
      dependencies: [],
      dependents: ["finish"],
    },
    {
      id: "finish",
      localId: "finish",
      type: "task",
      title: "Finish",
      config: { expectedOutput: "Done" },
      dependencies: ["choose_path"],
      dependents: [],
    },
  ],
  edges: [{ id: "edge_yes", from: "choose_path", to: "finish", label: "yes" }],
  entryNodeIds: ["choose_path"],
};

const graph = createPlanGraphFromCompiledPlan({
  taskId: "task_1",
  compiledPlan,
});

const state: GraphExecutionState = {
  graph,
  attempts: [],
  results: [],
  executionContextSnapshots: [],
};

const runtime = createGraphRuntime({
  taskId: "task_1",
  runtimeName: "chrona",
  policies: {
    maxSteps: 20,
    maxConcurrency: 2,
    retry: { maxAttempts: 3 },
  },
  executors: {
    condition: async ({ node, plan, userInput }) =>
      executeBuiltinGraphNode({ node, plan, userInput }),
    task: async ({ node }) => ({
      status: "done",
      summary: `${node.title} completed`,
      evidence: {},
    }),
  },
});

const started = await runtime.dispatch({
  type: "start",
  state,
  trigger: "manual",
  context: null,
});

const resumed = await runtime.dispatch({
  type: "resume_with_input",
  state: started.state,
  context: null,
  input: {
    nodeId: "choose_path",
    value: "yes",
    replaceStatus: "obsolete",
  },
});
```

Persist `outcome.state` as the durable runtime state. Persist `outcome.events` if the host needs audit logs, projections, or replay-like debugging.

### Executor Registry

Executors are supplied by the host application. They perform business side effects and return pure graph-runtime results.

```ts
const runtime = createGraphRuntime({
  taskId: "task_1",
  runtimeName: "chrona",
  executors: {
    "task.agent": async ({ node, context }) => {
      const run = await context.agentClient.run({ prompt: node.objective });
      return {
        status: "child_running",
        summary: "Agent run started",
        evidence: { runId: run.id },
      };
    },
  },
});
```

The graph should store serializable executor identity/config. The host binds that identity to actual functions through the registry. Provider clients, DB writes, artifacts, Task updates, and WorkBlock updates stay outside this package.

### External Async Sync

When a provider run or child task completes, dispatch `sync_external_result`. The runtime converts the external result into node results and resumes downstream execution when possible.

```ts
const outcome = await runtime.dispatch({
  type: "sync_external_result",
  state: persistedState,
  context,
  externalResult: {
    nodeId: "write_draft",
    status: "done",
    summary: "Draft created",
    evidence: { runId: "run_123", artifactIds: ["artifact_1"] },
  },
});
```

### Graph Mutation

Use `apply_mutation` to patch the graph while it is running. Set `invalidateDownstream` when changed nodes should invalidate downstream results.

```ts
const outcome = await runtime.dispatch({
  type: "apply_mutation",
  state: persistedState,
  context: null,
  mutation: {
    reason: "Replace obsolete branch",
    invalidateDownstream: true,
    operations: [
      {
        type: "remove_edge",
        edgeId: "edge_old",
      },
    ],
  },
});
```

Lower-level helpers are also exported for advanced host adapters:

- `resolveEffectivePlanGraph`
- `selectReadyNodeIds`
- `traverseDependencies`
- `getUpstreamNodeIds`
- `getDownstreamNodeIds`
- `analyzeStructuralChangeImpact`
- `applyGraphMutation`
- `planDownstreamInvalidation`
- `applyDownstreamInvalidation`
- `validatePlanGraph`
- `validateEffectivePlanGraph`

## Remaining Work

### Mutation And Replan

- Preserve compatible node ids/results during `replace_subgraph` when nodes are semantically unchanged.
- Make mutation output directly include structural impact and invalidation plans.
- Add branch-pruned node skipping as a reducer, not only resolver behavior.
- Emit richer mutation/invalidation events: result invalidated, attempt cancelled, branch pruned, node skipped.

### Edge Semantics

- Rewire effective graph readiness to consume centralized `resolveEdgeSemantics` internally.
- Add dedicated tests for `context` edges and `review_gate` edges.
- Define whether cycles are always invalid or allowed for specific edge types in future workflows.

### Human Review

- Add first-class review transitions: request approval, approve, reject, request changes, accept result, reject result, approve replan patch.
- Keep runtime approval, checkpoint approval, product result review, and replan patch approval separate.
- Let rejected/request-changes results drive retry or mutation commands predictably.

### External Async Sync

- Map external artifact refs into `NodeResult.artifactRefs`.
- Emit richer external sync events for provider start, provider completion, provider failure, cancellation, and artifact discovery.
- Add tests for failed, blocked, and cancelled external sync paths.

### Retry And Cancellation

- Add retryable/nonretryable error classification.
- Add retry backoff metadata.
- Add optional downstream cancellation propagation.
- Add deterministic tests for retry policy edge cases.

### Scheduling

- Add trigger-aware manual/assist/auto filtering.
- Add priority ordering.
- Add max time budget controls.
- Add scheduler-specific behavior for auto-run only flows.

### Validation

- Add deeper malformed config checks per node type.
- Validate duplicate current results from raw `GraphExecutionState`, not only effective graph shape.
- Validate invalid active attempts: unknown node, stale layer id, duplicate running attempts, impossible status transitions.
- Decide final cycle policy per edge type.

### Event Log And Replay

- Stabilize a full `GraphRuntimeEvent` union for every meaningful transition.
- Add event schema versioning.
- Add replay/snapshot tests that rebuild projections from emitted events.

### Serialization And Versioning

- Add graph schema version.
- Add runtime state schema version.
- Add event schema version.
- Add unsupported-version errors and migration extension points.

### Engine Rewiring

- Replace engine plan execution state-machine logic with `createGraphRuntime(...).dispatch(...)`.
- Keep engine responsible for persistence, provider clients, Task/WorkBlock updates, API mapping, and event storage.
- Remove obsolete domain/engine graph execution helpers after graph-runtime owns behavior.

## Test Commands

```sh
bunx tsc --noEmit --pretty false -p packages/graph-runtime/tsconfig.json
bun test packages/graph-runtime/src
```
