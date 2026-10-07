import type { NodeActionForm, WaitKind } from "./node-core";
import type { ResultContributionContent } from "../results/content";
type CheckpointInputFields = Record<string, string | boolean | string[]>;
type CheckpointResponse = { response: unknown };
import type { UiDocument } from "@chrona/ui-protocol";


export type AiArtifactRef = `AF${string}`;

export type DeliverableKind =
  | "document"
  | "table"
  | "dataset"
  | "image"
  | "archive"
  | "code"
  | "other";

export type DeliverablePresentation = {
  primary: "table" | "file" | "document" | "image";
  allowDownload: boolean;
};

export type NodeDeliverableDeclaration = {
  deliverableKey: string;
  title: string;
  kind: DeliverableKind;
  source:
    | { type: "generated_file"; uri: `generated://${string}` }
    | { type: "existing_artifact"; artifactRef: AiArtifactRef };
  summary?: string;
  presentation?: DeliverablePresentation;
  placement?: "primary" | "supporting" | "evidence";
};

export type NodeDeliverable = {
  deliverableKey: string;
  title: string;
  kind: DeliverableKind;
  artifactRef: AiArtifactRef;
  status: "current" | "superseded";
  supersedes?: AiArtifactRef;
  sourceNodeRef: string;
  summary?: string;
  presentation: DeliverablePresentation;
  placement: "primary" | "supporting" | "evidence";
};

// Node provenance extends shared content; it is not required by the content schema.
export type ResultContribution = ResultContributionContent & {
  sourceNodeRef?: string;
};

export type ResultEvidence = {
  key: string;
  summary: string;
  artifactRef?: AiArtifactRef;
  sourceNodeRef: string;
};

export type ResultReadiness = "ready" | "ready_with_caveats" | "partial" | "blocked";

export type ResultManifest = {
  schemaVersion: 1;
  sourceRevision: number;
  outcome: { title: string; summary: string };
  readiness: { status: ResultReadiness; summary: string };
  deliverables: NodeDeliverable[];
  findings: ResultContribution[];
  decisions: ResultContribution[];
  caveats: ResultContribution[];
  nextActions: ResultContribution[];
  evidence: ResultEvidence[];
};

export type ResultFinalizationState =
  | { status: "Pending"; sourceRevision: number }
  | { status: "Running"; sourceRevision: number; attempt: number; startedAt: string; phase?: "compose" | "review" }
  | { status: "Ready"; sourceRevision: number; attempt: number; finalizedAt: string }
  | {
      status: "Failed";
      sourceRevision: number;
      attempt: number;
      failedAt: string;
      errorCode: string;
      errorMessage: string;
    };

export type FinalizedResult = {
  sourceRevision: number;
  manifest: ResultManifest;
  spec: UiDocument;
  finalizedAt: string;
  /** Editorial review is not factual verification or human acceptance.
   * Absent on historical results: never infer that review completed. */
  review?: {
    status: "pending" | "completed" | "fallback";
    reason?: "timeout" | "interrupted" | "provider_error" | "invalid_output";
  };
};


export type PlanOutputState = {
  manifest: ResultManifest;
  finalizedResult: FinalizedResult | null;
  finalization: ResultFinalizationState;
  revision: number;
  updatedAt: string | null;
  updatedByNodeId: string | null;
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
  deliverables?: NodeDeliverable[];
  findings?: ResultContribution[];
  decisions?: ResultContribution[];
  caveats?: ResultContribution[];
  nextActions?: ResultContribution[];
  resultEvidence?: ResultEvidence[];
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
