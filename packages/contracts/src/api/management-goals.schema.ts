import { z } from "zod";
import { goalStatusSchema } from "./goals.schema";

export const managementGoalSearchSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  status: goalStatusSchema.optional(),
  page: z.number().int().min(1).max(1_000).default(1),
  pageSize: z.number().int().min(1).max(20).default(10),
}).strict();

export const managementGoalReadSchema = z.object({
  goalId: z.string().trim().min(1).max(128),
  view: z.enum(["compact", "brief", "criteria", "history"]).default("compact"),
  page: z.number().int().min(1).max(1_000).optional(),
  pageSize: z.number().int().min(1).max(20).optional(),
}).strict();

/** A proposed commitment, never a policy grant or an activation command. */
export const goalDraftProposalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).optional(),
  rationale: z.string().trim().min(1).max(2_000),
  firstStep: z.string().trim().min(1).max(2_000),
  expectedOutcome: z.string().trim().min(1).max(2_000),
  permissionRequest: z.string().trim().min(1).max(2_000).describe("Requested natural-language boundaries, NOT granted or enforced permissions. No execution is authorized by this text."),
  sourceSummary: z.string().trim().min(1).max(1_000).describe("Minimal user-approved provenance summary. Do not include full chat transcripts, secrets or unrelated personal data."),
}).strict();

export const managementGoalProposeSchema = goalDraftProposalSchema.extend({
  requestId: z.string().uuid(),
  dryRun: z.boolean().default(false),
}).strict();

const goalText = z.string().trim().min(1).max(2_000);
const criterionId = z.string().trim().min(1).max(128);
export const managementGoalNoteSchema = z.object({
  kind: z.enum(["progress", "finding", "decision"]),
  text: goalText,
}).strict();
export const managementGoalPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5_000).nullable().optional(),
  brief: z.object({
    outcome: goalText.optional(), currentFocus: goalText.optional(),
    strategy: z.string().trim().max(2_000).optional(),
    constraints: z.array(goalText).max(16).optional().describe("Requested boundaries only, never permission grants."),
  }).strict().refine((value) => Object.keys(value).length > 0, "Provide a brief field").optional(),
  criteria: z.array(z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("add"), id: criterionId, description: goalText }).strict(),
    z.object({ operation: z.literal("revise"), id: criterionId, description: goalText }).strict(),
    z.object({ operation: z.literal("remove"), id: criterionId }).strict(),
  ])).min(1).max(20).refine((items) => new Set(items.map((item) => item.id)).size === items.length, "One operation per criterion ID").optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field");

export const managementGoalUpdateSchema = z.object({
  requestId: z.string().uuid(), goalId: criterionId,
  expectedRevision: z.string().max(64).regex(/^goal-config-v1:[1-9]\d*$/),
  reason: goalText.describe("Why this user-requested or previously authorized change is needed; not proof of consent or a grant."),
  patch: managementGoalPatchSchema.optional(),
  note: managementGoalNoteSchema.optional().describe("Append an attributed observation; never confirms evidence or success."),
  dryRun: z.boolean().default(false),
}).strict().refine((value) => value.patch !== undefined || value.note !== undefined, "Provide a patch or note");

export type ManagementGoalUpdate = z.infer<typeof managementGoalUpdateSchema>;
export type GoalDraftProposal = z.infer<typeof goalDraftProposalSchema>;
export type ManagementGoalSearch = z.infer<typeof managementGoalSearchSchema>;
export type ManagementGoalRead = z.infer<typeof managementGoalReadSchema>;
export type ManagementGoalPropose = z.infer<typeof managementGoalProposeSchema>;
