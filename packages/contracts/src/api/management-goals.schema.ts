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
  view: z.enum(["compact", "brief", "criteria"]).default("compact"),
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

export type GoalDraftProposal = z.infer<typeof goalDraftProposalSchema>;
export type ManagementGoalSearch = z.infer<typeof managementGoalSearchSchema>;
export type ManagementGoalRead = z.infer<typeof managementGoalReadSchema>;
export type ManagementGoalPropose = z.infer<typeof managementGoalProposeSchema>;
