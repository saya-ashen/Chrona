import { z } from "zod";
import {
  aiJsonValueSchema,
  userQuestionSchema,
} from "../ai-feature-runtime";

import { workspaceId } from "./common";

export const goalStatusSchema = z.enum([
  "Draft",
  "Active",
  "Paused",
  "Achieved",
  "Stopped",
]);

export const goalSuccessCriterionSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.literal("user_confirmed"),
  description: z.string().trim().min(1),
  satisfied: z.boolean().default(false),
  confirmedAt: z.string().datetime().nullable().default(null),
  evidenceArtifactIds: z.array(z.string().trim().min(1)).optional(),
  proposalStatus: z.enum(["proposed", "confirmed"]).default("confirmed"),
});


export const goalOperationalBriefSchema = z.object({
  outcome: z.string().trim().min(1),
  currentFocus: z.string().trim().min(1),
  strategy: z.string().trim(),
  constraints: z.array(z.string().trim().min(1)),
});


export const goalCriterionEvidenceSchema = z.object({
  criterionId: z.string().trim().min(1),
  artifactIds: z.array(z.string().trim().min(1)).min(1),
});

export const processGoalResultBodySchema = z.object({
  artifactIds: z.array(z.string().trim().min(1)).min(1),
  criterionId: z.string().trim().min(1).nullable().optional(),
});

export const confirmGoalCriterionBodySchema = z.object({
  artifactIds: z.array(z.string().trim().min(1)).min(1),
  note: z.string().trim().min(1).max(2_000),
});

export const reviewGoalCriterionBodySchema = z.object({
  description: z.string().trim().min(1).max(2_000),
});


export const updateGoalBriefBodySchema = z.object({
  brief: goalOperationalBriefSchema,
});

export const goalIdParamSchema = z.object({
  goalId: z.string().trim().min(1),
});
export const goalReviewProposalParamSchema = z.object({
  goalId: z.string().trim().min(1),
  proposalId: z.string().trim().min(1),
});
export const createGoalTaskBodySchema = z.object({
  kind: z.enum(["task", "review"]),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10_000).nullable().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("High"),
  autoPlanGeneration: z.boolean().default(false),
  expectedOutcome: z.string().trim().min(1).optional(),
});

export const goalReviewOperationIdSchema = z.string().uuid();
export const goalReviewExpectedVersionSchema = z.number().int().nonnegative();

export const goalTaskParamSchema = z.object({
  goalId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
});

export const goalArtifactParamSchema = z.object({
  goalId: z.string().trim().min(1),
  artifactId: z.string().trim().min(1),
});

export const listGoalsQuerySchema = z.object({
  workspaceId,
});

export const createGoalBodySchema = z.object({
  workspaceId,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).nullable().optional(),
  successCriteria: z.array(goalSuccessCriterionSchema).min(1),
  nextReviewAt: z.string().datetime().nullable().optional(),
});

export const createGoalWithFirstTaskBodySchema = z.object({
  workspaceId,
  title: z.string().trim().min(1).max(200),
  firstTaskTitle: z.string().trim().min(1).max(200),
  additionalContext: z.string().trim().max(5_000).nullable().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("High"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export const updateGoalBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5_000).nullable().optional(),
    successCriteria: z.array(goalSuccessCriterionSchema).min(1).optional(),
    nextReviewAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const goalActionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("stop") }),
  z.object({
    action: z.literal("achieve"),
    confirmation: z.string().trim().min(1).max(2_000),
    evidenceArtifactIds: z.array(z.string().trim().min(1)).min(1),
  }),
]);

export const goalReviewProposalStatusSchema = z.enum([
  "Generating",
  "Ready",
  "NeedsInput",
  "CannotComplete",
  "PartiallyApplied",
  "Applied",
  "Rejected",
  "Superseded",
  "Failed",
]);

export const goalReviewProposalItemKindSchema = z.enum([
  "brief_field",
  "next_review_at",
  "task_candidate",
  "evidence_gap",
]);

export const goalReviewProposalItemDecisionSchema = z.enum([
  "Pending",
  "Accepted",
  "Rejected",
  "Converted",
  "Ignored",
  "Stale",
]);

export const goalReviewEvidenceRefSchema = z.object({
  type: z.enum(["goal", "criterion", "task", "result", "artifact", "asset", "working_set"]),
  id: z.string().trim().min(1),
  version: z.string().trim().min(1).optional(),
  hash: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
});

const goalReviewCommonResultItemSchema = z.object({
  itemId: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  evidenceRefs: z.array(goalReviewEvidenceRefSchema).default([]),
  warnings: z.array(z.string().trim().min(1)).default([]),
});

export const goalReviewBriefFieldResultItemSchema = goalReviewCommonResultItemSchema.extend({
  kind: z.literal("brief_field"),
  field: z.enum(["outcome", "currentFocus", "strategy", "constraints"]),
  value: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1))]),
}).superRefine((item, ctx) => {
  if (item.field === "constraints" && !Array.isArray(item.value)) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "constraints must be an array" });
  }
  if (item.field !== "constraints" && typeof item.value !== "string") {
    ctx.addIssue({ code: "custom", path: ["value"], message: `${item.field} must be a string` });
  }
});

export const goalReviewNextReviewResultItemSchema = goalReviewCommonResultItemSchema.extend({
  kind: z.literal("next_review_at"),
  value: z.string().datetime(),
});

export const goalReviewTaskCandidateResultItemSchema = goalReviewCommonResultItemSchema.extend({
  kind: z.literal("task_candidate"),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  expectedOutcome: z.string().trim().min(1),
});

export const goalReviewEvidenceGapResultItemSchema = goalReviewCommonResultItemSchema.extend({
  kind: z.literal("evidence_gap"),
  criterionId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  suggestedTask: z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    expectedOutcome: z.string().trim().min(1),
  }).optional(),
});

export const goalReviewResultSchema = z.object({
  schemaVersion: z.literal(1),
  summary: z.string().trim().min(1),
  items: z.array(z.discriminatedUnion("kind", [
    goalReviewBriefFieldResultItemSchema,
    goalReviewNextReviewResultItemSchema,
    goalReviewTaskCandidateResultItemSchema,
    goalReviewEvidenceGapResultItemSchema,
  ])).min(1).max(50),
});

export const generateGoalReviewBodySchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
  operationId: goalReviewOperationIdSchema,
  mode: z.enum(["initial", "progress"]).default("progress"),
});

export const applyGoalReviewProposalBodySchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
  expectedVersion: goalReviewExpectedVersionSchema,
  expectedGoalUpdatedAt: z.string().datetime(),
  dependencyHashes: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  decisions: z.array(z.object({
    itemId: z.string().trim().min(1),
    action: z.enum(["accept", "reject", "convert_to_task", "ignore"]),
  })).min(1).max(50),
});

export const rejectGoalReviewProposalBodySchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
});
export const goalReviewQuestionSchema = userQuestionSchema;

export const answerGoalReviewProposalBodySchema = z.object({
  operationId: goalReviewOperationIdSchema,
  expectedVersion: goalReviewExpectedVersionSchema,
  answers: z.array(z.object({
    questionId: z.string().trim().min(1),
    answer: aiJsonValueSchema,
  })).min(1).max(16),
});

export const retryGoalReviewProposalBodySchema = z.object({
  operationId: goalReviewOperationIdSchema,
  expectedVersion: goalReviewExpectedVersionSchema,
});

export const goalReviewProgressEventSchema = z.object({
  proposalId: z.string().trim().min(1),
  status: goalReviewProposalStatusSchema,
  version: goalReviewExpectedVersionSchema,
  message: z.string().trim().min(1).max(2_000).optional(),
  errorCode: z.string().trim().min(1).max(128).optional(),
});

export const promoteTaskToGoalParamSchema = z.object({
  taskId: z.string().trim().min(1),
});

export const promoteTaskToGoalBodySchema = z.object({
  workspaceId,
  acceptedRunId: z.string().trim().min(1),
  artifactIds: z.array(z.string().trim().min(1)).min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).nullable().optional(),
  successCriteria: z.array(goalSuccessCriterionSchema).min(1),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type GoalSuccessCriterion = z.infer<typeof goalSuccessCriterionSchema>;
export type CreateGoalRequest = z.infer<typeof createGoalBodySchema>;
export type CreateGoalWithFirstTaskRequest = z.infer<typeof createGoalWithFirstTaskBodySchema>;
export type UpdateGoalRequest = z.infer<typeof updateGoalBodySchema>;
export type GoalActionRequest = z.infer<typeof goalActionBodySchema>;
export type PromoteTaskToGoalRequest = z.infer<typeof promoteTaskToGoalBodySchema>;
export type CreateGoalTaskRequest = z.infer<typeof createGoalTaskBodySchema>;
export type ProcessGoalResultRequest = z.infer<typeof processGoalResultBodySchema>;
export type ConfirmGoalCriterionRequest = z.infer<typeof confirmGoalCriterionBodySchema>;
export type ReviewGoalCriterionRequest = z.infer<typeof reviewGoalCriterionBodySchema>;
export type GoalReviewProposalStatus = z.infer<typeof goalReviewProposalStatusSchema>;
export type GoalReviewProposalItemKind = z.infer<typeof goalReviewProposalItemKindSchema>;
export type GoalReviewProposalItemDecision = z.infer<typeof goalReviewProposalItemDecisionSchema>;
export type GoalReviewEvidenceRef = z.infer<typeof goalReviewEvidenceRefSchema>;
export type GoalReviewResult = z.infer<typeof goalReviewResultSchema>;
export type GenerateGoalReviewRequest = z.infer<typeof generateGoalReviewBodySchema>;
export type ApplyGoalReviewProposalRequest = z.infer<typeof applyGoalReviewProposalBodySchema>;
export type RejectGoalReviewProposalRequest = z.infer<typeof rejectGoalReviewProposalBodySchema>;
export type GoalReviewQuestion = z.infer<typeof goalReviewQuestionSchema>;
export type AnswerGoalReviewProposalRequest = z.infer<typeof answerGoalReviewProposalBodySchema>;
export type RetryGoalReviewProposalRequest = z.infer<typeof retryGoalReviewProposalBodySchema>;
export type GoalReviewProgressEvent = z.infer<typeof goalReviewProgressEventSchema>;
export type GoalOperationalBrief = z.infer<typeof goalOperationalBriefSchema>;
export type UpdateGoalBriefRequest = z.infer<typeof updateGoalBriefBodySchema>;
