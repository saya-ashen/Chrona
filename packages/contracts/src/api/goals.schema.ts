import { z } from "zod";

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
});

export const goalIdParamSchema = z.object({
  goalId: z.string().trim().min(1),
});
export const createGoalTaskBodySchema = z.object({
  kind: z.enum(["task", "review"]),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10_000).nullable().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("High"),
  autoPlanGeneration: z.boolean().default(false),
});

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
  z.object({ action: z.literal("review") }),
  z.object({
    action: z.literal("achieve"),
    confirmation: z.string().trim().min(1).max(2_000),
    evidenceArtifactIds: z.array(z.string().trim().min(1)).min(1),
  }),
]);

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
export type UpdateGoalRequest = z.infer<typeof updateGoalBodySchema>;
export type GoalActionRequest = z.infer<typeof goalActionBodySchema>;
export type PromoteTaskToGoalRequest = z.infer<typeof promoteTaskToGoalBodySchema>;
export type CreateGoalTaskRequest = z.infer<typeof createGoalTaskBodySchema>;
