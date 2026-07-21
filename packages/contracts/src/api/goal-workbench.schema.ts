import { z } from "zod";

import { workspaceId } from "./common";

export const goalAssetKindSchema = z.enum(["document", "form", "page", "file"]);
export const goalAssetVersionSourceSchema = z.enum(["manual", "ai_task", "inbox", "restored", "imported"]);
export const goalAssetDraftStatusSchema = z.enum(["Active", "Conflict", "Discarded", "Submitted"]);
export const goalInboxCandidateStatusSchema = z.enum(["Pending", "Accepted", "Rejected"]);
export const goalAssetJobKindSchema = z.enum(["thumbnail", "export"]);
export const goalAssetJobStatusSchema = z.enum(["Queued", "Processing", "Completed", "Failed"]);

const assetContentSchema = z.union([
  z.string().max(2_000_000),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const goalAssetParamSchema = z.object({
  goalId: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
});
export const goalAssetVersionParamSchema = goalAssetParamSchema.extend({
  versionId: z.string().trim().min(1),
});
export const goalInboxCandidateParamSchema = z.object({
  goalId: z.string().trim().min(1),
  candidateId: z.string().trim().min(1),
});

export const listGoalAssetsQuerySchema = z.object({
  workspaceId,
  query: z.string().trim().max(200).optional(),
  kind: goalAssetKindSchema.optional(),
  sourceTaskId: z.string().trim().min(1).optional(),
  state: z.enum(["all", "draft", "running", "failed", "archived"]).default("all"),
  sort: z.enum(["updated_desc", "updated_asc", "name_asc"]).default("updated_desc"),
});

export const renameGoalAssetBodySchema = z.object({
  label: z.string().trim().min(1).max(200),
});

export const saveGoalAssetDraftBodySchema = z.object({
  workspaceId,
  baseVersionId: z.string().trim().min(1),
  content: assetContentSchema,
  authorType: z.enum(["user", "ai_task"]).default("user"),
});

export const submitGoalAssetDraftBodySchema = z.object({
  workspaceId,
  draftId: z.string().trim().min(1),
  changeSummary: z.string().trim().min(1).max(2_000),
});

export const restoreGoalAssetVersionBodySchema = z.object({
  workspaceId,
  changeSummary: z.string().trim().min(1).max(2_000),
});

export const archiveGoalAssetBodySchema = z.object({
  workspaceId,
  action: z.enum(["archive", "restore"]),
});

export const resolveGoalInboxCandidateBodySchema = z.discriminatedUnion("action", [
  z.object({
    workspaceId,
    action: z.literal("create_asset"),
    label: z.string().trim().min(1).max(200),
  }),
  z.object({
    workspaceId,
    action: z.literal("append_version"),
    targetAssetId: z.string().trim().min(1),
    baseVersionId: z.string().trim().min(1),
    changeSummary: z.string().trim().min(1).max(2_000),
  }),
  z.object({ workspaceId, action: z.literal("reject") }),
]);

export const createGoalFormSubmissionBodySchema = z.object({
  workspaceId,
  versionId: z.string().trim().min(1),
  content: z.record(z.string(), z.unknown()),
});

export const createGoalAssetJobBodySchema = z.object({
  workspaceId,
  versionId: z.string().trim().min(1),
  kind: goalAssetJobKindSchema,
  format: z.string().trim().min(1).max(50).optional(),
});

export const createAssetModificationTaskBodySchema = z.object({
  workspaceId,
  versionId: z.string().trim().min(1),
  instruction: z.string().trim().min(1).max(10_000),
  expectedOutcome: z.string().trim().min(1).max(2_000),
});

export type GoalAssetKind = z.infer<typeof goalAssetKindSchema>;
export type SaveGoalAssetDraftRequest = z.infer<typeof saveGoalAssetDraftBodySchema>;
export type SubmitGoalAssetDraftRequest = z.infer<typeof submitGoalAssetDraftBodySchema>;
export type ResolveGoalInboxCandidateRequest = z.infer<typeof resolveGoalInboxCandidateBodySchema>;
export type CreateGoalFormSubmissionRequest = z.infer<typeof createGoalFormSubmissionBodySchema>;
export type CreateGoalAssetJobRequest = z.infer<typeof createGoalAssetJobBodySchema>;
export type CreateAssetModificationTaskRequest = z.infer<typeof createAssetModificationTaskBodySchema>;
