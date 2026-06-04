import type { WaitKind } from "./graph";

export type PlanRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type NodeRuntimeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "degraded"
  | "blocked"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "invalidated"
  | "skipped";

export type RuntimeProgressStatus =
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled";

export function runtimeProgressStatusForWaitKind(
  waitKind: WaitKind | undefined,
): Extract<RuntimeProgressStatus, "waiting_for_user" | "waiting_for_approval" | "blocked"> {
  switch (waitKind) {
    case "user_input":
      return "waiting_for_user";
    case "approval":
    case "review":
    case "replan_required":
      return "waiting_for_approval";
    default:
      return "blocked";
  }
}

export function runtimeProgressStatusForNodes(input: {
  readyNodeIds: readonly string[];
  runningNodeIds: readonly string[];
  nodes: readonly { status: NodeRuntimeStatus; reachable?: boolean; id?: string }[];
  blockedNodeIds: readonly string[];
  failedNodeIds: readonly string[];
  completedNodeIds: readonly string[];
}): RuntimeProgressStatus {
  if (input.readyNodeIds.length > 0 || input.runningNodeIds.length > 0) {
    return "running";
  }
  if (input.nodes.some((node) => node.status === "waiting_for_user")) {
    return "waiting_for_user";
  }
  if (input.nodes.some((node) => node.status === "waiting_for_approval")) {
    return "waiting_for_approval";
  }
  if (input.failedNodeIds.length > 0) {
    return "failed";
  }
  if (input.blockedNodeIds.length > 0) {
    return "blocked";
  }

  const reachableNodes = input.nodes.filter((node) => node.reachable !== false);
  if (
    reachableNodes.length > 0 &&
    reachableNodes.every((node) =>
      node.id ? input.completedNodeIds.includes(node.id) : node.status === "completed",
    )
  ) {
    return "completed";
  }

  return "blocked";
}

export interface NodeRuntimeState {
  nodeId: string;
  status: NodeRuntimeStatus;
  attempts: number;
  linkedTaskId?: string;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CheckpointResponse {
  id: string;
  planRunId: string;
  nodeId: string;
  response: unknown;
  submittedAt: string;
}

export interface ArtifactRef {
  id: string;
  planRunId: string;
  nodeId: string;
  artifactType: string;
  artifactId: string;
  metadata?: unknown;
}

export interface NodeResultReview {
  required: boolean;
  status: "pending" | "accepted" | "rejected" | "request_changes";
  feedback?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface NodeResultSelectedBranch {
  label: string;
  nextNodeId: string;
  source: "user" | "ai" | "system" | "default";
}

export type NodeResultOutput =
  | { kind: "markdown"; content: string; title?: string }
  | { kind: "json"; value: unknown; title?: string }
  | {
      kind: "file";
      path: string;
      title?: string;
      language?: string;
      description?: string;
    }
  | { kind: "link"; href: string; title: string; description?: string };

export interface NodeResultEvidence {
  sessionId?: string;
  runId?: string;
  runtimeName?: string;
  runtimeRunRef?: string | null;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
}

export interface NodeActionFormField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select";
  required?: boolean;
  options?: string[];
}

export interface NodeActionForm {
  instructions: string;
  submitLabel?: string;
  inputFields: NodeActionFormField[];
}

export interface NodeResult {
  id?: string;
  taskId?: string;
  graphId?: string;
  nodeId?: string;
  nodeLayerId?: string;
  attemptId?: string;
  status?: "current" | "stale" | "obsolete" | "invalidated" | "rejected";
  outputSummary?: string;
  outputs?: NodeResultOutput[];
  inputFields?: Record<string, string>;
  evidence?: NodeResultEvidence;
  artifactRefs?: ArtifactRef[];
  checkpointResponse?: CheckpointResponse["response"];
  error?: string;
  errorDetails?: unknown;
  actionForm?: NodeActionForm;
  waitKind?: WaitKind;
  review?: NodeResultReview;
  selectedBranch?: NodeResultSelectedBranch;
}
