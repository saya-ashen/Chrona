import type { CheckpointInputFields, CheckpointResponse } from "./checkpoints";
import type { NodeActionForm, WaitKind } from "./node";
import type { Spec } from "@chrona/ui-protocol";

export type PlanOutputPatch =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; path: string; from: string }
  | { op: "copy"; path: string; from: string }
  | { op: "test"; path: string; value: unknown };

export type PlanOutputRevision = {
  id: string;
  nodeId: string | null;
  nodeLayerId?: string | null;
  attemptId?: string | null;
  sessionId?: string;
  summary?: string;
  patches: PlanOutputPatch[];
  createdAt: string;
};

export type PlanOutputState = {
  spec: Spec | null;
  revision: number;
  updatedAt: string | null;
  updatedByNodeId: string | null;
  history: PlanOutputRevision[];
};

export interface NodeResultEvidence {
  sessionId?: string;
  runId?: string;
  runtimeName?: string;
  provider?: string;
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
  inputFields?: CheckpointInputFields;
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
