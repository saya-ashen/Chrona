# Chrona Layered Mutable Plan Graph Execution Architecture

## Purpose

This document defines a revised execution-layer architecture for Chrona based on
the current product direction: plans are allowed to evolve during execution, and
AI may update future planning based on runtime results.

The goal is to make Chrona execution:

1. predictable
2. resumable
3. safe under runtime replanning
4. easy to explain to users
5. conservative about result validity
6. simple enough to implement without heavyweight cross-plan migration

This design replaces the earlier emphasis on an immutable accepted executable
plan with a **Layered Mutable Plan Graph** model.

Short principle:

> The graph may evolve, but node layers, attempts, results, and execution
> snapshots are immutable once created.

---

## Core Motivation

Chrona is not a traditional fixed workflow engine.

In Chrona, AI may execute a node, inspect the result, then adjust the remaining
plan. This means the plan can change during execution.

A strict model where every runtime plan change creates a new accepted plan
version and then runs a migration analyzer introduces unnecessary complexity for
Chrona's intended workflow.

Instead, Chrona should treat the plan as a mutable, layered graph:

- each node maintains its own layer history
- the current node definition is the top layer
- execution reads only the resolved current graph
- previous node layers and results remain available as history
- dependency-changing edits propagate invalidation to downstream nodes
- old results are not deleted, but they stop counting as current results

This avoids complicated old-plan/new-plan node mapping while keeping execution
correctness conservative.

---

## Design Principles

1. **Plans may change during execution.**
2. **Node layers are immutable.**
3. **Execution only uses the latest resolved graph.**
4. **Results belong to node layers, not just nodes.**
5. **Attempts belong to the node layer active when they started.**
6. **Runtime replanning must not silently reuse stale results.**
7. **If a hard dependency changes, downstream current results are invalidated.**
8. **Running nodes cannot be edited in place.**
9. **Old results are preserved as history, not treated as current truth.**
10. **AI should usually edit future plan only, not completed or running work.**
11. **The execution engine should not care how a node changed historically; it
    should execute the resolved current graph.**
12. **Every execution result should be traceable to the graph layer and AI
    context that produced it.**

---

## High-Level Model

The target model is:

```text
Task
  ├─ PlanGraph
  │    ├─ PlanNode[]
  │    │    └─ NodeLayer[]
  │    ├─ PlanEdge[]
  │    ├─ GraphMutation[]
  │    └─ EffectivePlanGraph projection
  │
  ├─ WorkBlock[]
  ├─ ExecutionSession[]
  ├─ NodeAttempt[]
  ├─ ExecutionContextSnapshot[]
  └─ NodeResult[]
```

Mental model:

```text
PlanGraph = mutable graph container
NodeLayer = immutable node definition or invalidation layer
PlanEdge = graph connection with dependency semantics
ExecutionSession = one runtime process boundary
NodeAttempt = one attempt to execute one node layer
ExecutionContextSnapshot = frozen context used by one attempt
NodeResult = output produced by one attempt for one node layer
EffectivePlanGraph = resolved current view used by runtime and UI
```

---

## Core Concepts

### Task

Business-level work item.

`Task` owns:

- identity
- title
- description
- priority
- deadline
- owner metadata
- user-facing lifecycle

`Task` should not be the primary source of truth for:

- current executing node
- node runtime status
- node results
- plan structure
- scheduled work windows
- AI execution context

---

### PlanGraph

Mutable layered plan container for a task.

The graph is not immutable. It may evolve through user edits, AI replanning, or
system-generated invalidation.

`PlanGraph` owns:

- graph identity
- task id
- nodes
- edges
- mutation history
- current resolved graph version

`PlanGraph` should not directly store large runtime outputs inline if those
outputs are better represented as separate result/artifact records.

Recommended fields:

```ts
type PlanGraph = {
  id: string;
  taskId: string;
  status: "draft" | "active" | "archived";
  nodes: PlanNode[];
  edges: PlanEdge[];
  mutations: GraphMutation[];
  createdAt: string;
  updatedAt: string;
};
```

---

### PlanNode

Stable graph node identity.

A node is not a single mutable object. It is a stable node identity plus a
stack/list of immutable layers.

Recommended fields:

```ts
type PlanNode = {
  id: string;
  semanticKey: string;
  layers: NodeLayer[];
  createdAt: string;
  updatedAt: string;
};
```

Rules:

- `PlanNode.id` remains stable across node changes.
- `semanticKey` represents the intended work identity when available.
- The current node is resolved from the top active layer.
- Old layers remain available for audit, rollback, stale context, and
  explanation.

---

### NodeLayer

Immutable layer of a node.

A layer may represent:

1. a node definition
2. an invalidation caused by dependency changes
3. a cancellation or state transition caused by replanning
4. a retry or request-changes branch

Recommended shape:

```ts
type NodeLayer =
  | NodeDefinitionLayer
  | NodeInvalidationLayer
  | NodeCancellationLayer;
```

Definition layer:

```ts
type NodeDefinitionLayer = {
  id: string;
  type: "definition";
  createdAt: string;
  createdBy: "user" | "ai" | "system";
  reason:
    | "initial"
    | "definition_changed"
    | "manual_edit"
    | "ai_replan"
    | "request_changes";

  definition: NodeDefinition;
};
```

Invalidation layer:

```ts
type NodeInvalidationLayer = {
  id: string;
  type: "invalidation";
  createdAt: string;
  createdBy: "system" | "ai";
  reason:
    | "dependency_changed"
    | "upstream_invalidated"
    | "edge_changed"
    | "hard_dependency_inserted"
    | "hard_dependency_removed";

  invalidatedBy: Array<{
    nodeId: string;
    layerId: string;
    mutationId: string;
  }>;
};
```

Cancellation layer:

```ts
type NodeCancellationLayer = {
  id: string;
  type: "cancellation";
  createdAt: string;
  createdBy: "user" | "ai" | "system";
  reason:
    | "cancelled_due_to_replan"
    | "cancelled_by_user"
    | "superseded_by_new_definition";
};
```

Important rule:

> Chrona does not need a separate numeric `node.version` field. The ordered
> layer list and immutable layer IDs are enough. However, every layer must have
> a unique `layerId` because attempts, results, and snapshots must bind to it.

---

### NodeDefinition

Current executable meaning of a node.

Recommended shape:

```ts
type NodeDefinition = {
  title: string;
  objective: string;
  description?: string;

  semantics:
    | "automatic"
    | "user_input"
    | "approval"
    | "external_wait"
    | "manual_action"
    | "review";

  executor?: {
    kind: "ai" | "tool" | "human" | "external";
    capability?: string;
    provider?: string;
  };

  inputContract?: InputContract;
  outputContract?: OutputContract;
  reviewRequired?: boolean;
  estimatedMinutes?: number;
  metadata?: Record<string, unknown>;
};
```

---

### PlanEdge

Connection between nodes.

Edges must describe dependency semantics. This is critical because invalidation
propagation depends on edge type.

Recommended shape:

```ts
type PlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
```

Recommended edge types:

```ts
type EdgeType =
  | "hard_dependency"
  | "ordering"
  | "context"
  | "review_gate"
  | "branch";
```

Meaning:

| Edge type         | Meaning                                                                              | Upstream change effect                                        |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `hard_dependency` | Downstream result depends on upstream result                                         | Invalidate downstream current results                         |
| `ordering`        | Downstream should run after upstream, but does not semantically depend on its output | Usually no result invalidation                                |
| `context`         | Upstream may provide helpful context                                                 | Mark stale/context-changed, but do not necessarily invalidate |
| `review_gate`     | Downstream depends on review/finalization state                                      | Usually affects finalization, not raw result                  |
| `branch`          | Conditional path                                                                     | Only affects reachable branch                                 |

MVP may implement only:

```text
hard_dependency
ordering
```

But the model should leave room for the rest.

---

### GraphMutation

Append-only record of a graph change.

A graph mutation records what changed and why. It should be created for user
edits, AI replans, edge rewrites, node insertions, node deletions, and system
invalidation propagation.

Recommended fields:

```ts
type GraphMutation = {
  id: string;
  graphId: string;
  createdAt: string;
  createdBy: "user" | "ai" | "system";
  reason:
    | "manual_edit"
    | "ai_replan_after_node_result"
    | "insert_node"
    | "delete_node"
    | "replace_subgraph"
    | "change_edge"
    | "invalidate_downstream"
    | "request_changes";

  operations: GraphOperation[];
  affectedNodeIds: string[];
  invalidatedNodeIds: string[];
};
```

Graph operations:

```ts
type GraphOperation =
  | { op: "add_node"; node: PlanNode }
  | { op: "push_node_layer"; nodeId: string; layer: NodeLayer }
  | { op: "add_edge"; edge: PlanEdge }
  | { op: "remove_edge"; edgeId: string }
  | { op: "update_edge"; edgeId: string; patch: Partial<PlanEdge> }
  | { op: "delete_node"; nodeId: string };
```

---

## EffectivePlanGraph

The execution engine and UI should not directly reason over all historical
layers.

Instead, they should read a resolved view:

```text
EffectivePlanGraph = resolve(PlanGraph nodes + top layers + active edges + current runtime/result state)
```

Recommended shape:

```ts
type EffectivePlanGraph = {
  graphId: string;
  resolvedAt: string;
  nodes: EffectivePlanNode[];
  edges: EffectivePlanEdge[];
  readyNodeIds: string[];
  blockedNodeIds: string[];
  runningNodeIds: string[];
  completedNodeIds: string[];
  invalidatedNodeIds: string[];
};
```

Effective node:

```ts
type EffectivePlanNode = {
  nodeId: string;
  activeLayerId: string;
  semanticKey: string;

  definition: NodeDefinition;
  status: NodeRuntimeStatus;
  result?: NodeResultSummary;

  dependenciesSatisfied: boolean;
  ready: boolean;
  reachable: boolean;
  invalidated: boolean;
  invalidationReason?: string;
};
```

Important rule:

> The runtime executes the effective graph only. It does not need to understand
> how a node reached its current layer.

---

## ExecutionSession

A resumable runtime process boundary.

Under this design, `ExecutionSession` is thinner than in a frozen-plan model. It
does not need to own all per-node state. Node state and results are attached to
node layers, attempts, and result records.

`ExecutionSession` owns:

- task id
- graph id
- status
- current execution boundary
- trigger source
- pause reason
- associated work block if any
- timestamps

Recommended shape:

```ts
type ExecutionSession = {
  id: string;
  taskId: string;
  graphId: string;
  workBlockId?: string | null;

  status:
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";

  trigger:
    | "manual"
    | "scheduled"
    | "resume_with_input"
    | "resume_with_approval"
    | "resume_after_unblock"
    | "retry";

  pauseReason?:
    | "needs_user_input"
    | "needs_approval"
    | "needs_review"
    | "manual_action_required"
    | "external_dependency"
    | "capability_unavailable"
    | "work_block_exhausted"
    | "node_failed"
    | null;

  startedAt: string;
  updatedAt: string;
  pausedAt?: string | null;
  completedAt?: string | null;
};
```

Session answers:

- is Chrona currently trying to execute this task?
- why did it stop?
- which work block activated it?
- what runtime process do node attempts belong to?

Session should not be the only truth for:

- node completion
- node results
- graph structure
- result validity

---

## WorkBlock

Scheduled permission to work.

`WorkBlock` and `ExecutionSession` remain separate.

- `WorkBlock` answers: when may work start?
- `ExecutionSession` answers: what runtime process is currently active or
  paused?

Recommended shape:

```ts
type WorkBlock = {
  id: string;
  taskId: string;
  graphId?: string | null;

  scheduledStartAt: string;
  scheduledEndAt: string;

  status:
    | "scheduled"
    | "activating"
    | "active"
    | "exhausted"
    | "completed"
    | "missed"
    | "cancelled";

  triggerSource: "user" | "ai" | "calendar" | "system";
  createdAt: string;
  updatedAt: string;
};
```

Scheduler responsibility stays thin:

1. find due work blocks
2. validate they are actionable
3. call execution action dispatcher

Scheduler should not contain graph execution orchestration logic.

---

## NodeAttempt

One attempt to execute one node layer.

Attempts must bind to the node layer active at the time the attempt starts.

Recommended shape:

```ts
type NodeAttempt = {
  id: string;
  sessionId: string;
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  contextSnapshotId: string;

  status:
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "obsolete";

  startedAt: string;
  finishedAt?: string | null;

  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

Critical rule:

> If an attempt finishes after its node has moved to a newer active layer, the
> result must not become current. It may be stored as obsolete historical
> evidence only.

---

## ExecutionContextSnapshot

Frozen context used to execute one node attempt.

Chrona should snapshot execution context after or during node execution so that
invalidated results do not leak stale AI conversation state into future
execution.

Recommended shape:

```ts
type ExecutionContextSnapshot = {
  id: string;
  sessionId: string;
  graphId: string;
  nodeId: string;
  nodeLayerId: string;

  resolvedGraphSignature: string;
  activeLayerIds: string[];
  dependencyResultRefs: string[];
  userInputRefs: string[];
  conversationRefs: string[];
  toolCallRefs: string[];
  artifactRefs: string[];

  promptSnapshot?: string;
  modelConfigSnapshot?: unknown;
  runtimeConfigSnapshot?: unknown;

  createdAt: string;
};
```

Purpose:

- preserve what the AI saw when executing a node
- make result invalidation explainable
- prevent future nodes from accidentally using obsolete context
- support audit and debugging

Important rule:

> A result is only valid relative to the node layer and context snapshot that
> produced it.

---

## NodeResult

Output produced by a node attempt for a specific node layer.

Recommended shape:

```ts
type NodeResult = {
  id: string;
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  attemptId: string;
  contextSnapshotId: string;

  status:
    | "current"
    | "stale"
    | "obsolete"
    | "invalidated"
    | "rejected";

  outputSummary?: string;
  outputData?: unknown;
  artifactRefs: string[];
  evidenceRefs: string[];

  review?: {
    required: boolean;
    outcome?: "accept" | "reject" | "request_changes";
    feedback?: string;
    reviewedAt?: string;
  };

  createdAt: string;
  updatedAt: string;
};
```

Rules:

- Results are never silently reused across node layers.
- Only result status `current` counts as completed current work.
- Old results should be preserved, not deleted.
- Invalidated results may be offered as stale context, but must not satisfy
  dependencies.

---

## Runtime Status Model

Recommended node runtime statuses:

```ts
type NodeRuntimeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "invalidated"
  | "skipped";
```

Recommended wait kind:

```ts
type WaitKind =
  | "user_input"
  | "approval"
  | "review"
  | "manual_action"
  | "external_dependency"
  | "capability_unavailable";
```

Prefer:

```text
status = waiting
waitKind = review
```

instead of creating too many top-level statuses like `waiting_for_review`,
`waiting_for_approval`, and so on.

---

## Invalidation Model

### Core Rule

If a node's hard dependency changes, the node's current result is no longer
valid.

Chrona should conservatively invalidate all downstream nodes connected through
`hard_dependency` edges.

This is intentional.

Because AI execution is not a pure function, Chrona usually cannot safely
determine whether a downstream result remains valid after its dependency context
changed.

---

### Invalidation Propagation

When a graph mutation affects a node or edge:

1. identify directly affected nodes
2. traverse downstream hard dependency edges
3. push invalidation layers to affected downstream nodes
4. mark current results on those nodes as stale/obsolete/invalidated
5. rebuild the effective graph projection

Pseudo-flow:

```ts
function invalidateDownstream(startNodeIds: string[], mutationId: string) {
  const affected = traverseHardDependencyDownstream(startNodeIds);

  for (const nodeId of affected) {
    pushNodeLayer(nodeId, {
      type: "invalidation",
      reason: "upstream_invalidated",
      invalidatedBy: [{ nodeId: startNodeIds[0], mutationId }],
    });

    markCurrentResult(nodeId, "invalidated");
  }
}
```

---

### Invalidation Statuses

Recommended result invalidation statuses:

| Status        | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `current`     | Valid for current active node layer                |
| `stale`       | Not current, but may be useful as context          |
| `obsolete`    | Superseded by a newer node layer or graph mutation |
| `invalidated` | Explicitly unusable as completion evidence         |
| `rejected`    | User or review rejected it                         |

---

## Runtime Replanning Rules

### Default AI Replan Scope

By default, AI should edit only future, not-yet-run nodes.

Recommended scope model:

```ts
type ReplanScope =
  | "future_only"
  | "from_node"
  | "include_completed";
```

Default:

```text
future_only
```

If AI or user attempts to change completed or running work, Chrona should treat
it as a stronger action and surface impact.

Example user-facing warning:

```text
This change will invalidate completed results for 3 downstream steps: B, C, and D.
```

---

### Mutating Completed Nodes

Completed nodes may be changed, but doing so must:

1. create a new node layer
2. mark previous current result obsolete or invalidated
3. invalidate hard-dependent downstream nodes
4. preserve old results as history

---

### Mutating Running Nodes

Running nodes cannot be edited in place.

To modify a running node:

1. stop or cancel the active attempt
2. mark the attempt as `cancelled` or `obsolete`
3. prevent any late-arriving result from becoming current
4. push a new node layer
5. re-resolve the graph
6. start a new attempt if appropriate

Critical rule:

> A running attempt always writes result to the node layer it started with,
> never to the latest layer if the layer changed while it was running.

---

## Orchestrator Model

All execution triggers should enter one unified action dispatcher.

Recommended entry:

```ts
dispatchExecutionAction(input);
```

Recommended actions:

```ts
type ExecutionAction =
  | { action: "start_manual"; taskId: string }
  | { action: "start_scheduled"; taskId: string; workBlockId: string }
  | { action: "resume_with_input"; sessionId: string; payload: unknown }
  | { action: "resume_with_approval"; sessionId: string; payload: unknown }
  | { action: "resume_after_unblock"; sessionId: string }
  | { action: "retry_node"; sessionId: string; nodeId: string }
  | { action: "cancel_session"; sessionId: string };
```

High-level loop:

1. load task, graph, work block if any, active/resumable session
2. acquire execution lock
3. resolve effective graph
4. choose ready node or stop condition
5. create execution context snapshot
6. start node attempt bound to active node layer
7. execute node
8. persist result, attempt, runtime state, and projection
9. allow AI replan if policy permits
10. apply graph mutation and invalidation if needed
11. resolve graph again
12. continue until explicit stop condition

---

## Stop Conditions

The orchestrator stops only when one of these is true:

1. all reachable required work is complete
2. waiting for user input
3. waiting for approval
4. waiting for review
5. waiting for manual action
6. external dependency unresolved
7. capability unavailable
8. work block window exhausted
9. node failure
10. user cancelled session
11. replan requires user confirmation because it invalidates completed work

---

## Review Model

Review is distinct from approval.

- `Approval`: permission before executing or taking a risky action
- `Review`: user evaluates an output after execution

Review outcomes:

```ts
type ReviewOutcome =
  | "accept"
  | "reject"
  | "request_changes";
```

Recommended consequences:

| Outcome           | Effect                                                                         |
| ----------------- | ------------------------------------------------------------------------------ |
| `accept`          | result becomes finalized/current                                               |
| `reject`          | result becomes rejected; node may become failed or pending depending on policy |
| `request_changes` | push new node layer or retry layer; old result becomes stale/rejected          |

For `request_changes`, Chrona should decide whether to:

1. retry same node with feedback
2. push a new definition layer
3. trigger downstream invalidation
4. trigger broader AI replan

---

## AI Conversation Snapshot Policy

Because AI execution depends on conversational and tool context, Chrona should
snapshot node execution context.

Recommended snapshot timing:

1. before starting an automatic node attempt
2. after tool calls are completed
3. when a node result is finalized

At minimum, each completed node should have a snapshot that contains:

- active node layer id
- effective graph signature
- dependency result refs
- prompt used
- model/runtime config
- tool call refs
- produced artifact refs
- user input refs

When a node result is invalidated, the associated snapshot is not deleted. It
remains historical context but should not be included in future execution
context unless explicitly selected as stale reference material.

---

## Concurrency And Idempotency

Execution must be protected from duplicate starts and concurrent graph
mutations.

Recommended mechanisms:

1. task-level execution lock
2. graph mutation transaction lock
3. node attempt idempotency key
4. optimistic graph revision check
5. state transition preconditions

Examples:

```ts
startNodeAttempt({
  nodeId,
  nodeLayerId,
  expectedNodeStatus: "ready",
  idempotencyKey,
});
```

```ts
applyGraphMutation({
  graphId,
  expectedGraphRevision,
  mutation,
});
```

Important invariant:

> A node layer can have at most one current successful result.

---

## Transaction Boundaries

Graph mutation and invalidation should be atomic.

A replan mutation should commit all of the following together:

1. structural graph operation
2. node layer pushes
3. edge changes
4. downstream invalidation layers
5. affected result status changes
6. graph mutation record
7. projection rebuild marker

Do not allow partial graph updates where edges change but downstream
invalidation fails.

---

## Single Source Of Truth

| Concern                            | Canonical owner                       |
| ---------------------------------- | ------------------------------------- |
| Business task identity             | `Task`                                |
| Deadline                           | `Task.dueAt`                          |
| Plan structure                     | `PlanGraph` + active node/edge layers |
| Node definition history            | `NodeLayer[]`                         |
| Current node definition            | top active node layer                 |
| Dependency semantics               | `PlanEdge.type`                       |
| Scheduled work window              | `WorkBlock`                           |
| Runtime process boundary           | `ExecutionSession`                    |
| Node execution attempt             | `NodeAttempt`                         |
| AI/tool context used for execution | `ExecutionContextSnapshot`            |
| Node output/result                 | `NodeResult`                          |
| UI display state                   | derived projections/read models       |

---

## API Direction

### Execution Write API

Recommended endpoint:

```text
POST /tasks/:taskId/execution/actions
```

Example:

```json
{
  "action": "resume_with_input",
  "sessionId": "exec_sess_123",
  "payload": {
    "inputText": "Here is the missing context"
  }
}
```

---

### Plan Mutation API

Recommended endpoint:

```text
POST /tasks/:taskId/plan/mutations
```

Example:

```json
{
  "reason": "ai_replan_after_node_result",
  "scope": "future_only",
  "operations": [
    {
      "op": "add_node",
      "afterNodeId": "node_a",
      "node": {
        "title": "Verify source reliability",
        "semantics": "automatic"
      }
    }
  ]
}
```

Response should include:

```json
{
  "mutationId": "mut_123",
  "affectedNodeIds": ["node_x", "node_b", "node_c"],
  "invalidatedNodeIds": ["node_b", "node_c"],
  "requiresConfirmation": false
}
```

---

### Read APIs

Recommended reads:

```text
GET /tasks/:taskId/plan/effective
GET /tasks/:taskId/execution/state
GET /tasks/:taskId/execution/timeline
GET /tasks/:taskId/work-blocks
```

Read models should be projection-oriented and must not become write-time truth.

---

## Example Flow: Insert Node After Completed Work

Initial graph:

```text
A -> B -> C
```

State:

```text
A layer a1 completed
B layer b1 completed
C layer c1 pending
```

AI inserts X between A and B:

```text
A -> X -> B -> C
```

System transaction:

1. create graph mutation `mut_1`
2. create node X with layer `x1`
3. remove edge `A -> B`
4. add edge `A -> X`
5. add edge `X -> B`
6. traverse downstream hard dependencies from B
7. push invalidation layer `b2` to B
8. push invalidation layer `c2` to C
9. mark B result from `b1` as obsolete or invalidated
10. mark C result from `c1`, if any, as obsolete or invalidated
11. rebuild effective graph

Result:

```text
A a1 completed, current
X x1 pending, current
B b2 pending, current
C c2 pending, current
B b1 completed, historical only
C c1 historical only if it had a result
```

---

## Example Flow: Edit Running Node

Current state:

```text
B layer b1 running
attempt att_1 bound to b1
```

User or AI wants to change B.

System must:

1. cancel `att_1`
2. mark attempt as `cancelled_due_to_replan`
3. push new layer `b2`
4. mark any late result from `att_1` as obsolete
5. resolve graph
6. optionally start new attempt on `b2`

Forbidden behavior:

```text
Do not let att_1 write a current result to b2.
```

---

## MVP Implementation Direction

Recommended order:

1. Keep existing plan graph direction, but formalize node layer IDs.
2. Add edge type support, at least `hard_dependency` and `ordering`.
3. Bind node attempts/results to `nodeLayerId`.
4. Add graph mutation records.
5. Implement downstream invalidation for hard dependency changes.
6. Ensure running node mutation requires cancellation first.
7. Add execution context snapshots for completed automatic nodes.
8. Resolve an `EffectivePlanGraph` for runtime and UI.
9. Keep `ExecutionSession` thin.
10. Add user-facing impact preview for mutations that invalidate completed
    results.

---

## Non-Goals For MVP

The first implementation does not need:

1. complex result reuse heuristics
2. semantic migration analyzer across separate accepted plans
3. automatic partial carry-forward
4. multi-branch speculative execution
5. advanced stale-context reuse
6. graph compaction
7. full audit UI for every historical layer

Chrona should first prefer correctness and explainability over aggressive reuse.

---

## Future Enhancements

Potential later improvements:

1. soft invalidation for context-only edges
2. stale result reuse as AI context
3. graph snapshot compaction
4. visual history diff between node layers
5. AI-generated impact explanation before replanning
6. branch-specific invalidation
7. automatic replan confidence scoring
8. user approval for high-impact replan mutations
9. dependency fingerprinting for lazy invalidation
10. result reuse under explicit compatibility checks

---

## Critical Invariants

1. A node's current executable definition is the top active layer.
2. A node result belongs to exactly one node layer.
3. A node attempt belongs to exactly one node layer.
4. A running attempt cannot be retargeted to a newer node layer.
5. If a hard dependency changes, downstream current results are invalidated.
6. Invalidated results are preserved but cannot satisfy current dependencies.
7. Runtime executes the effective graph, not historical graph layers.
8. Graph mutation and downstream invalidation must be atomic.
9. WorkBlock is scheduling truth, not execution state truth.
10. ExecutionSession is process boundary, not the primary result ledger.

---

## Summary

The recommended Chrona execution architecture is a **Layered Mutable Plan Graph
Execution Model**.

Instead of freezing an entire accepted plan and migrating state across plan
versions, Chrona should allow the graph to evolve while making each node layer,
result, attempt, and context snapshot immutable.

This model fits Chrona because AI may replan during execution. It keeps runtime
execution simple by resolving the current effective graph, while preserving
historical layers and results for audit, explanation, rollback, and stale
context.

The core tradeoff is intentionally conservative result invalidation. When hard
dependencies change, downstream work is treated as no longer current. This
avoids unsafe reuse of AI-generated outputs whose underlying context may have
changed.

Final mental model:

```text
PlanGraph is mutable.
NodeLayer is immutable.
NodeResult is bound to NodeLayer.
NodeAttempt is bound to NodeLayer.
ExecutionContextSnapshot explains what the AI saw.
EffectivePlanGraph is what the runtime executes.
```
