import { z } from "zod";

// Preserve identity bytes: trimming would turn a near-match into an authorized exact association.
export const id = z.string().min(1).max(128);
export const key = z.string().min(1).max(160);
export const time = z.iso.datetime({ offset: true });
const short = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(1200);
export const status = z.enum(["watching", "acting", "waiting-user", "waiting-external", "done", "dropped"]);
export const priority = z.enum(["low", "normal", "critical"]);
export const escalation = z.enum(["none", "early", "day-before", "final"]);
export const awaitingSchema = z.object({
  source: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/), moduleId: id, event: id, ref: id,
  thread: z.string().max(200), from: z.string().max(200), domain: z.string().max(200),
  textAll: z.array(z.string().min(1).max(100)).max(8).default([]),
}).strict();
export const linkSchema = z.object({ source: id, moduleId: id, ref: id, version: id, checkedAt: time, conclusion: text }).strict();
export const concernSchema = z.object({
  id, revision: z.number().int().positive(), title: short, goal: z.string().max(1200), project: z.string().max(100),
  status, priority, userExplicit: z.boolean(), dueAt: time.nullable(), revisitAt: time.nullable(), silentUntil: time.nullable(),
  expectedProgressAt: time.nullable(), progressAt: time.nullable(), awaiting: z.array(awaitingSchema).max(12), links: z.array(linkSchema).max(20),
  escalation, lastCheckedAt: time.nullable(), lastAssessment: z.object({ at: time, conclusion: text, decisionId: id }).strict().nullable(),
  createdAt: time, updatedAt: time,
}).strict();
export const proposalSchema = z.object({
  id, title: short, goal: z.string().max(1200), project: z.string().max(100), reason: text,
  source: id, moduleId: id.nullable(), signalIds: z.array(id).max(20), status: z.enum(["pending", "accepted", "dismissed"]),
  concernId: id.nullable(), createdAt: time, updatedAt: time,
}).strict();
export const settingsSchema = z.object({
  enabled: z.boolean(), intervalMinutes: z.number().int().min(5).max(120), dailyWakes: z.number().int().min(1).max(24),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid timezone"),
  notifyEnabled: z.boolean(), feedbackMinimum: z.number().int().min(3).max(30), feedbackHalfLifeDays: z.number().int().min(1).max(30),
  waitingRecheckHours: z.number().int().min(1).max(168),
}).strict();
export const DEFAULT_SETTINGS: z.infer<typeof settingsSchema> = {
  enabled: false, intervalMinutes: 15, dailyWakes: 6, dailyTime: "09:00", quietStart: "22:00", quietEnd: "08:00", timezone: "UTC",
  notifyEnabled: false, feedbackMinimum: 5, feedbackHalfLifeDays: 7, waitingRecheckHours: 24,
};
export const signalSchema = z.object({
  id, digest: z.string().length(64), source: id, moduleId: id, eventId: id, event: id, ref: id, version: id,
  thread: z.string().max(200), from: z.string().max(200), domain: z.string().max(200), kind: z.enum(["event", "summary"]),
  text: z.string().max(2000), occurredAt: time, receivedAt: time, progressAt: time.nullable(),
  associations: z.array(id).max(200), reviewed: z.array(id).max(200), dailyReviewedAt: time.nullable(),
}).strict();
export const dimensionsSchema = z.object({ newEvidence: z.boolean(), progress: z.boolean(), internal: z.boolean(), redundant: z.boolean(), unavailable: z.boolean(), userVisible: z.boolean() }).strict();
export const reportResultSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  concerns: z.array(z.object({ id, revision: z.number().int().positive(), conclusion: text, signalIds: z.array(id).max(20) }).strict()).max(20),
  feedback: dimensionsSchema,
}).strict();
export const reportCandidateSchema = z.object({ reportId: z.string().length(64), result: reportResultSchema, verified: z.boolean() }).strict();
export const notificationSchema = z.object({ key, status: z.enum(["pending", "unknown", "accepted", "unavailable"]), body: z.string().max(1200) }).strict();
export const decisionSchema = z.object({
  id, at: time, kind: z.enum(["manual", "daily", "signal", "deadline", "review"]), concernIds: z.array(id).max(20), signalIds: z.array(id).max(40),
  revisions: z.record(id, z.number().int().positive()), sourceKinds: z.array(z.object({ source: id, kind: id }).strict()).max(40),
  phase: z.enum(["prepared", "running", "waiting", "unknown", "completed", "unreported", "failed"]),
  runKey: key, contextId: id.nullable(), runId: id.nullable(), prompt: z.string().min(1).max(100_000), tools: z.array(z.enum(["mind.agenda", "mind.propose", "mind.report"])).length(3),
  cursor: z.string().min(1).nullable().optional(), report: reportCandidateSchema.nullable(), reportCandidates: z.array(reportCandidateSchema).max(8).default([]).optional(), retryAt: time.optional(), finishedAt: time.nullable(), error: z.string().max(500).nullable(),
  interactions: z.array(z.object({ id, title: short, message: z.string().max(2000), expiresAt: time }).strict()).max(12),
  notification: notificationSchema.nullable(),
}).strict();
export const feedbackSchema = z.object({ decisionId: id, source: id, kind: id, at: time, dimensions: dimensionsSchema }).strict();
export const receiptResultSchema = z.union([
  z.object({ concern: concernSchema }).strict(), z.object({ proposal: proposalSchema }).strict(),
  z.object({ signalId: id, associations: z.array(id).max(200), duplicate: z.boolean() }).strict(),
  z.object({ accepted: z.literal(true), reportId: z.string().length(64), decisionId: id, pendingVerification: z.literal(true) }).strict(),
]);
const receiptSchema = z.object({ scope: z.string().min(1).max(300), key, digest: z.string().length(64), result: receiptResultSchema, at: time }).strict();
export const runtimeSchema = z.object({ nextCheckAt: time.nullable(), lastCheckAt: time.nullable(), lastDailyDate: z.string().max(10).nullable(), currentDecisionId: id.nullable(), lastError: z.string().max(500).nullable(), wakeError: z.string().max(500).nullable().default(null) }).strict();
const signalTombstoneSchema = z.object({ moduleId: id, eventId: id, digest: z.string().length(64), signalId: id }).strict();
// Read-only: rows persisted before plan 008 still carry it; never written.
export const sourcesSchema = z.array(z.object({ path: z.string().min(1).max(128), moduleId: id, contractHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), version: z.string().nullable(), error: z.string().max(300).nullable() }).strict()).max(4);
export const sourceInput = z.object({ paths: z.string().max(1000).optional() }).strict();
export const stateSchema = z.object({
  sources: sourcesSchema.default([]).optional(),
  schema: z.literal(1), revision: z.number().int().nonnegative(), settings: settingsSchema,
  concerns: z.array(concernSchema).max(200), proposals: z.array(proposalSchema).max(64), signals: z.array(signalSchema).max(512),
  decisions: z.array(decisionSchema).max(256), feedback: z.array(feedbackSchema).max(1024), receipts: z.array(receiptSchema).max(2048), runtime: runtimeSchema,
  signalTombstones: z.array(signalTombstoneSchema).max(4096).default([]).optional(),
// eslint-disable-next-line complexity -- Cross-record disk invariants stay together in one fail-closed validation pass.
}).strict().superRefine((state, ctx) => {
  for (const field of ["concerns", "proposals", "signals", "decisions"] as const) {
    if (new Set(state[field].map(item => item.id)).size !== state[field].length) ctx.addIssue({ code: "custom", message: `Duplicate ${field} identity` });
  }
  const current = state.decisions.filter(item => !["completed", "unreported", "failed"].includes(item.phase));
  if (current.length > 1 || (current[0]?.id ?? null) !== state.runtime.currentDecisionId) ctx.addIssue({ code: "custom", message: "Invalid outstanding reasoning identity" });
  if (new Set(state.receipts.map(item => JSON.stringify([item.scope, item.key]))).size !== state.receipts.length) ctx.addIssue({ code: "custom", message: "Duplicate receipt identity" });
  const eventIdentities = [...state.signals, ...(state.signalTombstones ?? [])].map(s => JSON.stringify([s.moduleId, s.eventId]));
  if (new Set(eventIdentities).size !== eventIdentities.length) ctx.addIssue({ code: "custom", message: "Duplicate source event identity" });
  for (const decision of state.decisions) {
    const candidates = decision.reportCandidates ?? [];
    if (new Set(candidates.map(c => c.reportId)).size !== candidates.length || candidates.some(c => c.verified)) ctx.addIssue({ code: "custom", message: "Invalid report candidates" });
    if (decision.runKey !== `${decision.id}:run` || new Set(decision.tools).size !== 3
      || new Set(decision.concernIds).size !== decision.concernIds.length || new Set(decision.signalIds).size !== decision.signalIds.length
      || Object.keys(decision.revisions).length !== decision.concernIds.length || decision.concernIds.some(cid => !decision.revisions[cid])
      || (decision.runId !== null && decision.contextId === null)
      || (decision.finishedAt !== null) !== ["completed", "unreported", "failed"].includes(decision.phase)
      || (decision.phase === "completed" && !decision.report?.verified)) ctx.addIssue({ code: "custom", message: "Invalid persisted reasoning contract" });
  }
  for (const signal of state.signals) {
    if (new Set(signal.associations).size !== signal.associations.length || signal.associations.some(cid => !state.concerns.some(c => c.id === cid)) || new Set(signal.reviewed).size !== signal.reviewed.length || signal.reviewed.some(cid => !signal.associations.includes(cid))) ctx.addIssue({ code: "custom", message: "Invalid signal associations" });
  }
});
export function freshState(): z.infer<typeof stateSchema> {
  return { schema: 1, revision: 0, settings: { ...DEFAULT_SETTINGS }, concerns: [], proposals: [], signals: [], signalTombstones: [], decisions: [], feedback: [], receipts: [], runtime: { nextCheckAt: null, lastCheckAt: null, lastDailyDate: null, currentDecisionId: null, lastError: null, wakeError: null } };
}
const clearTime = z.union([time, z.literal("")]);
// Web Input values are decimal strings. Direct local callers may also supply a number.
const scalarInteger = (schema: z.ZodNumber) => z.union([schema, z.string().min(1).max(3).regex(/^\d+$/).transform(Number).pipe(schema)]);
export const inputs = {
  "ui-sources": sourceInput,
  agenda: z.object({ cursor: z.string().max(80).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  "ui-agenda": z.object({ cursor: z.string().max(80).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  decisions: z.object({ cursor: z.string().max(80).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  "ui-dismiss": z.object({ "request-key": key, id }).strict(),
  note: z.object({
    "request-key": key, id: id.optional(), title: short.optional(), goal: z.string().max(1200).optional(), project: z.string().max(100).optional(), status: status.optional(), priority: priority.optional(),
    "user-explicit": z.boolean().optional(), "due-at": clearTime.optional(), "revisit-at": clearTime.optional(), "silent-until": clearTime.optional(),
    "expected-progress-at": clearTime.optional(), "progress-at": clearTime.optional(), awaiting: z.string().max(20_000).optional(), links: z.string().max(32_000).optional(),
    "proposal-id": id.optional(),
  }).strict(),
  propose: z.object({ "request-key": key, title: short, goal: z.string().max(1200).optional(), project: z.string().max(100).optional(), reason: text, "signal-ids": z.string().max(4000).optional() }).strict(),
  signal: z.object({
    "request-key": key, "event-id": id, event: id, ref: id, version: id, thread: z.string().max(200).default(""), from: z.string().max(200).default(""), domain: z.string().max(200).default(""),
    kind: z.enum(["event", "summary"]).default("event"), text: z.string().max(2000).default(""), "occurred-at": time, "progress-at": time.optional(),
  }).strict(),
  report: z.object({ "request-key": key, "decision-id": id, result: z.string().min(1).max(32_000) }).strict(),
  check: z.object({}).strict(),
  "ui-settings": z.object({
    enabled: z.boolean().optional(), "interval-minutes": scalarInteger(settingsSchema.shape.intervalMinutes).optional(), "daily-wakes": scalarInteger(settingsSchema.shape.dailyWakes).optional(),
    "daily-time": settingsSchema.shape.dailyTime.optional(), "quiet-start": settingsSchema.shape.quietStart.optional(), "quiet-end": settingsSchema.shape.quietEnd.optional(), timezone: settingsSchema.shape.timezone.optional(),
    "notify-enabled": z.boolean().optional(), "feedback-minimum": scalarInteger(settingsSchema.shape.feedbackMinimum).optional(), "feedback-half-life-days": scalarInteger(settingsSchema.shape.feedbackHalfLifeDays).optional(), "waiting-recheck-hours": scalarInteger(settingsSchema.shape.waitingRecheckHours).optional(),
  }).strict(),
};
export const statsSchema = z.object({ open: z.number().int().nonnegative(), pendingProposals: z.number().int().nonnegative(), unmatched: z.number().int().nonnegative(), wakes24h: z.number().int().nonnegative(), trustworthyReports: z.number().int().nonnegative() }).strict();
export const publicRuntimeSchema = runtimeSchema.extend({ phase: z.enum(["idle", "prepared", "running", "waiting", "unknown"]), runId: id.nullable(), interactions: decisionSchema.shape.interactions });
const paginationSchema = { cursor: z.string().max(80).nullable(), nextCursor: z.string().max(80).nullable(), limited: z.boolean(), total: z.number().int().nonnegative() };
const agendaOutputSchema = z.object({ concerns: z.array(concernSchema).max(200), proposals: z.array(proposalSchema).max(64), runtime: publicRuntimeSchema, stats: statsSchema, ...paginationSchema }).strict();
const publicDecisionSchema = decisionSchema.pick({ id: true, at: true, kind: true, concernIds: true, signalIds: true, revisions: true, sourceKinds: true, phase: true, contextId: true, runId: true, tools: true, report: true, finishedAt: true, error: true, interactions: true, notification: true });
export const outputs = {
  "ui-sources": z.object({ sources: sourcesSchema, paths: z.string(), errors: z.string() }).strict(),
  agenda: agendaOutputSchema,
  "ui-agenda": agendaOutputSchema,
  decisions: z.object({ decisions: z.array(publicDecisionSchema).max(100), ...paginationSchema }).strict(),
  "ui-dismiss": z.object({ proposal: proposalSchema }).strict(),
  note: z.object({ concern: concernSchema }).strict(),
  propose: z.object({ proposal: proposalSchema }).strict(),
  signal: z.object({ signalId: id, associations: z.array(id).max(200), duplicate: z.boolean() }).strict(),
  report: z.object({ accepted: z.literal(true), reportId: z.string().length(64), decisionId: id, pendingVerification: z.literal(true) }).strict(),
  check: z.object({ runtime: publicRuntimeSchema }).strict(),
  "ui-settings": settingsSchema,
};
