import type { CheckpointResponse } from "./checkpoints";
import type { NodeActionForm, WaitKind } from "./node";

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

export interface ArtifactRef {
  id: string;
  planRunId: string;
  nodeId: string;
  artifactType: string;
  artifactId: string;
  metadata?: unknown;
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
  review?: {
    required: boolean;
    status: "pending" | "accepted" | "rejected" | "request_changes";
    feedback?: string;
    reviewedAt?: string;
    reviewedBy?: string;
  };
  selectedBranch?: {
    ref?: string;
    key?: string;
    label: string;
    nextNodeId: string;
    resolvedNextNodeId?: string;
    resolvedNextNodeLayerId?: string | null;
    refVersion?: number;
    source: "user" | "ai" | "system" | "default";
  };
}
