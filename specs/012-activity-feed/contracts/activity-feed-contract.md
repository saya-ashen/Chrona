# Contract: Workspace Activity Feed

## Purpose

Define the product contract for activity displayed in Command Center and the selected node drawer. The same contract applies to persisted activity loaded with a task page, live activity received while a task runs, and older activity loaded through progressive browsing.

## Activity Item Shape

```ts
type WorkspaceActivityKind =
  | "assistant_message"
  | "reasoning"
  | "tool_started"
  | "tool_completed"
  | "provider_run"
  | "approval"
  | "node"
  | "task"
  | "artifact"
  | "schedule"
  | "raw";

type WorkspaceActivityTone = "neutral" | "info" | "success" | "warning" | "danger";

type WorkspaceToolActivity = {
  name?: string;
  label?: string;
  preview?: string;
  inputSummary?: string;
  durationMs?: number;
  error?: string;
  state: "started" | "completed" | "failed";
};

type WorkspaceAssistantActivity = {
  text: string;
  isReasoning: boolean;
  isPartial?: boolean;
};

type WorkspaceActivityItem = {
  id: string;
  kind: WorkspaceActivityKind;
  title: string;
  summary: string;
  timestamp: string;
  tone: WorkspaceActivityTone;
  sourceNodeId?: string;
  sourceNodeTitle?: string;
  provider?: string;
  runtimeName?: string;
  runId?: string;
  nativeRunId?: string;
  sequence?: number;
  rawEventType?: string;
  tool?: WorkspaceToolActivity;
  assistant?: WorkspaceAssistantActivity;
  raw?: unknown;
};
```

## Scope Rules

- Command Center Activity uses task scope and includes all task-level and node-level activity.
- Node drawer Activity uses node scope and includes only entries where `sourceNodeId` equals the selected node.
- Final state does not infer `sourceNodeId` for old events that did not record node identity.
- Task-scope entries with node identity should display the node title or equivalent node cue.
- Node-scope entries should avoid redundant node labels unless needed for clarity.

## Ordering and Deduplication Rules

- Newest relevant activity appears first in the visible feed.
- Persisted and live items deduplicate by stable event identity.
- Stable identity should prefer source event identifiers and sequence; when unavailable, it must combine task scope, node identity, provider, runtime, run identifiers, kind, raw event type, timestamp, and content signature.
- Pagination must not produce duplicates across pages.
- Live partial assistant or reasoning entries may update in place until the segment completes.

## Merge Rules

- Assistant text fragments merge only with adjacent assistant fragments from the same task, node, provider, runtime, run, and native run.
- Reasoning fragments merge only with adjacent reasoning fragments from the same task, node, provider, runtime, run, and native run.
- Assistant output and reasoning never merge together.
- Tool events remain distinct visible events, even when a start and completion share the same tool call.
- Node boundaries are merge boundaries.

## Tool Display Rules

- `tool_started` shows tool identity and available preview/input summary.
- `tool_completed` shows success or failure state, duration when available, and error when failed.
- Long preview/input/error content is summarized by default and expandable.
- Missing optional tool details do not block rendering; available details are shown without invented values.

## Empty and Error States

- Task scope with no activity shows a task-level empty message.
- Node scope with no matching activity shows a node-level empty message.
- Unknown activity renders as `raw` with a safe summary so surrounding activity remains inspectable.
- Feed loading and older-history loading states must be distinct.

## Progressive History Contract

Initial task load may return a bounded latest activity page. Older history browsing returns additional `WorkspaceActivityItem` pages with a cursor.

```ts
type WorkspaceActivityPage = {
  items: WorkspaceActivityItem[];
  nextCursor?: string;
  scope: {
    type: "task" | "node";
    taskId: string;
    nodeId?: string;
    limit: number;
  };
};
```

## Final Legacy Removal Contract

- No node drawer tab named Evidence remains.
- No coarse-only activity renderer remains as an alternate path.
- No compatibility fallback attempts to display old provider events as node-scoped activity without node identity.
- No time-window inference is used to assign provider events to nodes.
