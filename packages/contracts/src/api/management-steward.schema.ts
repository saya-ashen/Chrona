import { z } from "zod";
import { AFFAIR_STATUSES, createAffairSchema, evidenceSchema, PILOT_DENIED_ACTIONS, proposeDelegationSchema } from "../steward";

const id = z.string().trim().min(1).max(128);
export const managementStewardTodaySchema = z.object({}).strict();
export const managementStewardSearchSchema = z.object({ query: z.string().trim().min(1).max(200).optional(), status: z.enum(AFFAIR_STATUSES).optional(), limit: z.number().int().min(1).max(20).default(20) }).strict();
export const managementStewardReadSchema = z.object({ affairId: id }).strict();
export const managementStewardCaptureSchema = z.object({
  requestId: z.string().uuid(), dryRun: z.boolean().default(false),
  affairId: id.optional(), newAffair: createAffairSchema.omit({ taskId: true }).optional(),
  note: z.string().trim().min(1).max(4000),
  followUp: z.object({ note: z.string().trim().min(1).max(4000), dueAt: z.string().datetime({ offset: true }).max(40) }).strict().optional(),
  source: evidenceSchema.omit({ eventId: true, observedAt: true }),
}).strict().refine(v => !(v.affairId && v.newAffair), "Use affairId or newAffair, not both");
export const managementStewardDelegationSchema = proposeDelegationSchema.extend({ requestId: z.string().uuid(), dryRun: z.boolean().default(false) }).strict().superRefine((value, ctx) => {
  for (const field of ["allowedActions", "askFirstActions"] as const) {
    if (value[field].some(action => (PILOT_DENIED_ACTIONS as readonly string[]).includes(action))) ctx.addIssue({ code: "custom", path: [field], message: "Pilot-denied actions cannot be proposed: reply_external, mark_read_external, delete_external" });
  }
});
export type ManagementStewardCapture = z.infer<typeof managementStewardCaptureSchema>;
