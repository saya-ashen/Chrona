import { z } from "zod";
import { AFFAIR_STATUSES, assessmentSchema, CHAT_ACTIONS, CHAT_PROPOSABLE_ACTIONS, chatIdentitySchema, CONNECTION_KINDS, createAffairSchema, evidenceSchema, PILOT_DENIED_ACTIONS, proposeDelegationSchema, REPLY_REF_PATTERN } from "../steward";

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
export const stewardAssessmentProposalSchema = assessmentSchema.pick({ disposition: true, whatHappened: true, whyItMatters: true, nextStep: true, proposedAction: true }).extend({ affairId: z.string().min(1).max(128).nullable(), followUp: z.object({ note: z.string().min(1).max(4000), dueAt: z.string().datetime({ offset: true }) }).strict().nullable() }).strict();
export const managementStewardPendingSchema = z.object({}).strict();
export const managementStewardAssessmentSchema = z.object({ requestId: z.string().uuid(), eventId: id, proposal: stewardAssessmentProposalSchema }).strict();
export type ManagementStewardCapture = z.infer<typeof managementStewardCaptureSchema>;

// Chat bridge (scope steward:chat). `chat` is filled by the host plugin from the
// authenticated gateway session; the server also checks it against its allowlist.
const quietHours = z.object({ start: z.string().regex(/^\d\d:\d\d$/), end: z.string().regex(/^\d\d:\d\d$/), timezone: z.string().min(1).max(80) }).strict();
export const managementStewardChatProposeSchema = z.object({
  requestId: z.string().uuid(), chat: chatIdentitySchema,
  purpose: z.string().trim().min(1).max(4000),
  /** Existing connection of this kind in the workspace; Chrona never creates or widens a connection from chat. */
  connectionKind: z.enum(CONNECTION_KINDS),
  affairId: id.optional(), newAffairTitle: z.string().trim().min(1).max(200).optional(),
  cadenceSeconds: z.number().int().min(300).max(604800).optional(),
  allowedActions: z.array(z.enum(CHAT_PROPOSABLE_ACTIONS)).min(1).max(CHAT_PROPOSABLE_ACTIONS.length).default(["read_source", "summarize", "notify_user"]),
  notification: z.object({
    mode: z.enum(["immediate", "digest", "silent"]).default("immediate"),
    cooldownMinutes: z.number().int().min(0).max(10080).default(60),
    quietHours: quietHours.nullable().default(null),
    maxNotificationsPerDay: z.number().int().min(0).max(50).default(6),
  }).strict().default({ mode: "immediate", cooldownMinutes: 60, quietHours: null, maxNotificationsPerDay: 6 }),
}).strict().refine(v => !(v.affairId && v.newAffairTitle), "Use affairId or newAffairTitle, not both");
export const managementStewardChatRespondSchema = z.object({
  requestId: z.string().uuid(), chat: chatIdentitySchema,
  ref: z.string().trim().toUpperCase().regex(REPLY_REF_PATTERN), action: z.enum(CHAT_ACTIONS),
  /** Explicit snooze length; a date mentioned in chat is not a snooze or appointment by itself. */
  snoozeHours: z.number().int().min(1).max(168).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();
/** `/chrona <anything else>`: Chrona records one piece of work and the agent handles it; nothing is classified here. */
export const managementStewardChatRequestSchema = z.object({ requestId: z.string().uuid(), chat: chatIdentitySchema, text: z.string().trim().min(1).max(2000) }).strict();
export type ManagementStewardChatRequest = z.infer<typeof managementStewardChatRequestSchema>;
export const managementStewardChatPendingSchema = z.object({ chat: chatIdentitySchema }).strict();
export type ManagementStewardChatPropose = z.infer<typeof managementStewardChatProposeSchema>;
export type ManagementStewardChatRespond = z.infer<typeof managementStewardChatRespondSchema>;
