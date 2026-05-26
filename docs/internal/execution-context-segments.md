# Execution Context Segments

Chrona should not run a whole task plan through one long provider session, and it should not default to one fresh provider session per node. The execution kernel needs a middle boundary: a context segment.

## Problem

The current plan execution path creates a plan-level main task session and passes that session to provider-backed node execution. In practice this means an automatic task can run from start to finish through the same provider conversation.

That design has several problems:

- Provider context compression becomes part of Chrona correctness. Different providers preserve, compress, or truncate history differently.
- Long-running tasks can lose important early context through provider-side truncation that Chrona cannot inspect or test.
- Node work can pollute later nodes with failed assumptions, exploratory dead ends, or obsolete local state.
- Retrying one node is hard to reason about because the retry inherits the whole prior provider conversation.
- Parallel branches and branch joins cannot safely share one mutable provider conversation.
- Auditing is unclear because Chrona execution state, provider session state, and node attempt evidence are all treated as one continuity boundary.

Switching to one session per node fixes some contamination, but creates a new problem: related nodes lose useful short-term working context. Implementation, verification, and follow-up repair nodes often need the same local findings, design decisions, and tool state. Rebuilding that context for every node is inefficient and can reduce result quality.

## Decision

Use `ExecutionContextSegment` as Chrona's provider-session and context-compaction boundary.

A context segment is a runtime grouping of related plan nodes. Nodes inside the same segment share one provider task session. When execution moves to a different segment, Chrona summarizes the completed segment into structured state, starts or resumes the next segment's provider session, and injects only the selected compact context needed by that segment.

This makes the default strategy `per_segment`, not `whole_task_shared` and not `per_node`.

## Responsibilities

`ExecutionSession` remains the durable Chrona execution-control session. It owns current node, pause/resume state, completed node IDs, and execution lifecycle.

`WorkBlock` remains the scheduling/time container. It answers when a task should run, not which provider conversation should carry context.

`ExecutionContextSegment` owns provider conversation boundaries for a set of related nodes. It answers which nodes should share short-term AI/runtime context.

`TaskSession` remains the persisted provider-facing session record. A context segment normally maps to one task session.

`Run` remains one provider invocation. A segment can contain multiple runs for multiple node attempts.

## Model Sketch

```prisma
model ExecutionContextSegment {
  id                 String   @id @default(cuid())
  workspaceId        String
  taskId             String
  planId             String
  executionSessionId String?
  workBlockId        String?
  taskSessionId      String?
  segmentKey         String
  title              String
  objective          String?
  nodeIds            Json
  status             String
  summary            Json?
  startedAt          DateTime?
  completedAt        DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

The first implementation may store segment assignment in node metadata and segment summaries in events if a schema migration is not yet justified. If segmenting becomes core execution behavior, it should become a first-class table because it is execution state, not provider detail.

## Session Keys

Segment provider sessions should use stable, deterministic keys:

```text
chrona:task:{taskId}:plan-{planId}:segment-{segmentId}
```

If a retry must isolate polluted context, create an attempt-scoped variant:

```text
chrona:task:{taskId}:plan-{planId}:segment-{segmentId}:attempt-{attemptNumber}
```

Attempt-scoped sessions should be opt-in by policy or failure classification. Most segment-local retries can reuse the segment session and include the failed attempt summary explicitly.

## Segment Summary

Segment handoff must be structured, not only prose. The next segment should receive compact facts that Chrona selected from durable execution state.

```ts
type ExecutionContextSegmentSummary = {
  segmentId: string;
  title: string;
  objective: string;
  completedNodeIds: string[];
  decisions: Array<{
    topic: string;
    decision: string;
    rationale?: string;
  }>;
  facts: string[];
  changedFiles?: string[];
  artifacts: Array<{
    type: string;
    title: string;
    uri?: string;
  }>;
  openQuestions: string[];
  blockers: string[];
  nextContextHints: string[];
};
```

The summary is input to later segments, alongside current task goal, accepted plan state, dependency node outputs, relevant artifacts, and prior failed-attempt summaries.

## Segment Boundary Rules

Start with deterministic rules before adding model-generated grouping:

- Split before and after human checkpoints.
- Split before and after user-input or approval waits.
- Split across major execution domains such as research, design, implementation, verification, and release.
- Split parallel branches into separate segments.
- Start a new segment at branch joins so the joined node receives compact summaries from each upstream branch.
- Isolate destructive, deployment, migration, or other high-risk nodes.
- Split when projected context size crosses the configured budget.
- Allow node metadata or task execution config to override the default strategy.

Plan generation may propose segment IDs or phase keys, but runtime must validate and adjust them. Graph mutation or replanning can invalidate future segment assignments.

## Execution Flow

1. Resolve the accepted plan and execution session.
2. Determine the next ready node.
3. Resolve or create the node's context segment.
4. Ensure the segment task session using the deterministic segment session key.
5. Build provider input from Chrona state: task goal, current segment objective, dependency outputs, relevant summaries, artifacts, and failed-attempt context.
6. Execute node attempts through the segment task session.
7. Persist node result, provider run evidence, and graph events.
8. When no more runnable nodes remain in the segment, produce or update the segment summary.
9. Move to the next segment with a new provider task session and compact handoff context.

## Provider Boundary

Providers may create, resume, or virtualize provider-native sessions, but they must not decide segment membership, summary content, retry policy, or graph progression. Segment policy belongs in `packages/engine`.

Provider-side compression can still be useful as an optimization, but Chrona correctness must depend on Chrona-owned segment summaries and durable node results.

## Open Implementation Questions

- Whether segment assignment should be persisted at plan acceptance time, lazily during execution, or both.
- Whether segment summaries should be generated by a dedicated structured feature or assembled from node outputs plus optional AI compaction.
- How much previous segment history should be injected by default when a task has many segments.
- Whether `sessionStrategy` should evolve from `shared | per_subtask` into `shared | per_segment | per_node | per_attempt`.
- How UI should surface current segment, especially when a task pauses at a segment boundary.
