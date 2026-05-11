import type { WaitKind } from "./graph";

export type PlanRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type NodeRuntimeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "invalidated"
  | "skipped";

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
  | { kind: "text"; content: string; title?: string }
  | { kind: "markdown"; content: string; title?: string }
  | { kind: "json"; value: unknown; title?: string }
  | {
      kind: "file";
      path: string;
      title?: string;
      language?: string;
      description?: string;
    }
  | { kind: "artifact"; artifactId: string; title: string; description?: string }
  | {
      kind: "command";
      command: string;
      title?: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
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
  evidence?: NodeResultEvidence;
  artifactRefs?: ArtifactRef[];
  checkpointResponse?: CheckpointResponse["response"];
  error?: string;
  errorDetails?: unknown;
  waitKind?: WaitKind;
  review?: NodeResultReview;
  selectedBranch?: NodeResultSelectedBranch;
}
