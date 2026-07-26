import { apiJson } from "@shared/http";
import type {
  ApplyGoalAssetOwnershipRequest,
  CreateAssetModificationTaskRequest,
  CreateGoalAssetJobRequest,
  CreateGoalFormSubmissionRequest,
  GenerateGoalAssetOwnershipRequest,
  ResolveGoalInboxCandidateRequest,
  SaveGoalAssetDraftRequest,
  SubmitGoalAssetDraftRequest,
} from "@chrona/contracts";

export type GoalAssetKind = "document" | "form" | "page" | "file" | "structured_result";
export type GoalAssetVersionData = {
  id: string;
  version: number;
  parentVersionId: string | null;
  source: string;
  content: string | Record<string, unknown> | unknown[];
  contentHash: string;
  mimeType: string | null;
  originalFilename: string | null;
  changeSummary: string | null;
  sourceTaskId: string | null;
  sourceRunId: string | null;
  sourceResultId: string | null;
  artifactId: string | null;
  createdAt: string;
};
export type GoalAssetDraftData = { id: string; baseVersionId: string; status: string; content: string | Record<string, unknown> | unknown[]; updatedAt: string };
export type GoalAssetJobData = { id: string; versionId: string; kind: string; format: string | null; status: string; outputUri: string | null; errorMessage: string | null; createdAt: string };
export type GoalAssetWorkbenchData = {
  id: string;
  workspaceId: string;
  goalId: string;
  label: string;
  kind: GoalAssetKind;
  status: string;
  archivedAt: string | null;
  lastOpenedAt: string | null;
  updatedAt: string;
  sourceArtifact: { id: string; taskId: string; runId: string; title: string; uri: string; contentPreview: string | null; metadata: unknown };
  versions: GoalAssetVersionData[];
  drafts: GoalAssetDraftData[];
  submissions: Array<{ id: string; versionId: string; content: unknown; createdAt: string }>;
  jobs: GoalAssetJobData[];
  linkedAssets?: Array<{ ref: string; assetId: string }>;
};
export type GoalAssetOwnershipProposalData = {
  id: string;
  status: "Generating" | "Ready" | "Applied" | "Rejected" | "Stale" | "Failed";
  sourceTaskId: string;
  sourceRunId: string | null;
  providerType: string | null;
  model: string | null;
  generationError: string | null;
  result: {
    schemaVersion: 1;
    decision: "create_asset" | "append_version" | "separate_asset";
    targetAssetId: string | null;
    proposedLabel: string;
    rationale: string;
    differenceSummary: string;
    certainty: "low" | "medium" | "high";
    evidence: string[];
    counterEvidence: string[];
  } | null;
  sourceTask: { id: string; title: string };
  targetAsset: { id: string; label: string } | null;
};

export type GoalInboxCandidateData = {
  id: string;
  sourceTaskId: string;
  sourceRunId: string;
  kind: GoalAssetKind;
  label: string;
  proposedAction: string;
  proposedTargetAssetId: string | null;
  content: string | Record<string, unknown> | unknown[];
  reason: string;
  changeSummary: string;
  confidence: number;
  sourceArtifact: { id: string; title: string; uri: string; contentPreview: string | null } | null;
  sourceTask: { title: string };
  proposedTargetAsset: { id: string; label: string } | null;
  ownershipProposals?: GoalAssetOwnershipProposalData[];
};

export async function listGoalAssets(goalId: string, workspaceId: string, query = "") {
  return apiJson<{ assets: GoalAssetWorkbenchData[]; recent: GoalAssetWorkbenchData[] }>(`/api/goals/${encodeURIComponent(goalId)}/assets?workspaceId=${encodeURIComponent(workspaceId)}${query}`);
}
export async function getGoalAsset(goalId: string, assetId: string) { return apiJson<GoalAssetWorkbenchData>(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}`); }
export async function renameGoalAsset(goalId: string, assetId: string, label: string) { return apiJson<GoalAssetWorkbenchData>(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}`, { method: "PATCH", body: JSON.stringify({ label }) }); }
export async function saveGoalAssetDraft(goalId: string, assetId: string, command: SaveGoalAssetDraftRequest) { return apiJson<GoalAssetDraftData>(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/drafts`, { method: "POST", body: JSON.stringify(command) }); }
export async function submitGoalAssetDraft(goalId: string, assetId: string, command: SubmitGoalAssetDraftRequest) { return apiJson<GoalAssetVersionData>(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/drafts/submit`, { method: "POST", body: JSON.stringify(command) }); }
export async function restoreGoalAssetVersion(goalId: string, assetId: string, versionId: string, workspaceId: string, changeSummary: string) { return apiJson<GoalAssetVersionData>(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: "POST", body: JSON.stringify({ workspaceId, changeSummary }) }); }
export async function archiveGoalAsset(goalId: string, assetId: string, workspaceId: string, action: "archive" | "restore") { return apiJson(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/archive`, { method: "POST", body: JSON.stringify({ workspaceId, action }) }); }
export async function listGoalInbox(goalId: string, workspaceId: string) { return apiJson<{ candidates: GoalInboxCandidateData[] }>(`/api/goals/${encodeURIComponent(goalId)}/inbox?workspaceId=${encodeURIComponent(workspaceId)}`); }
export async function extractGoalInboxCandidates(goalId: string, taskId: string, runId: string) { return apiJson<{ candidates: GoalInboxCandidateData[] }>(`/api/goals/${encodeURIComponent(goalId)}/inbox/extract`, { method: "POST", body: JSON.stringify({ taskId, runId }) }); }
export async function resolveGoalInboxCandidate(goalId: string, candidateId: string, command: ResolveGoalInboxCandidateRequest) { return apiJson(`/api/goals/${encodeURIComponent(goalId)}/inbox/${encodeURIComponent(candidateId)}/resolve`, { method: "POST", body: JSON.stringify(command) }); }
export async function generateGoalAssetOwnership(goalId: string, candidateId: string, command: GenerateGoalAssetOwnershipRequest) { return apiJson<{ proposalId: string; sourceTaskId: string; status: string }>(`/api/goals/${encodeURIComponent(goalId)}/inbox/${encodeURIComponent(candidateId)}/ownership-proposals`, { method: "POST", body: JSON.stringify(command) }); }
export async function applyGoalAssetOwnership(goalId: string, candidateId: string, proposalId: string, command: ApplyGoalAssetOwnershipRequest) { return apiJson<GoalAssetOwnershipProposalData>(`/api/goals/${encodeURIComponent(goalId)}/inbox/${encodeURIComponent(candidateId)}/ownership-proposals/${encodeURIComponent(proposalId)}/apply`, { method: "POST", body: JSON.stringify(command) }); }
export async function submitGoalForm(goalId: string, assetId: string, command: CreateGoalFormSubmissionRequest) { return apiJson(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/submissions`, { method: "POST", body: JSON.stringify(command) }); }
export async function createGoalAssetJob(goalId: string, assetId: string, command: CreateGoalAssetJobRequest) { return apiJson<GoalAssetJobData>(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/jobs`, { method: "POST", body: JSON.stringify(command) }); }
export async function createGoalAssetModificationTask(goalId: string, assetId: string, command: CreateAssetModificationTaskRequest) { return apiJson(`/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(assetId)}/ai-modification-task`, { method: "POST", body: JSON.stringify(command) }); }
