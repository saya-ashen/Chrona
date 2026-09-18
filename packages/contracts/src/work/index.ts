import { z } from "zod";

export const WORK_SCOPES = ["work:read", "work:write"] as const;
export const WORK_REQUEST_BYTES = 32 * 1024;
const id = z.string().trim().min(1).max(128);
const text = z.string().trim().min(1).max(2000);
export const workLinkSchema = z.string().url().max(2048).refine((value) => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}, "Use an HTTPS link without credentials");
export const workWindowSchema = z.object({
  startsAt: z.string().datetime({ offset: true }).max(40), endsAt: z.string().datetime({ offset: true }).max(40),
  timezone: z.string().min(1).max(80).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
}).strict().refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), "End must follow start");
export const workSourceSchema = z.object({
  kind: z.enum(["email", "calendar", "reference"]), system: id, account: id, externalId: z.string().trim().min(1).max(500),
  label: z.string().trim().min(1).max(200), url: workLinkSchema.optional(), calendarEventId: id.optional(),
}).strict();
const contextFields = {
  organizer: z.string().trim().max(200).default(""), participants: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  joinUrl: workLinkSchema.optional(), agenda: z.string().trim().max(4000).default(""),
};
export const workContextSchema = z.discriminatedUnion("kind", [
  z.object({ ...contextFields, kind: z.literal("general"), window: workWindowSchema.optional() }).strict(),
  z.object({ ...contextFields, kind: z.literal("meeting"), window: workWindowSchema }).strict(),
]);
export const workSignalSchema = z.discriminatedUnion("dimension", [
  z.object({ dimension: z.literal("participation"), value: z.enum(["unknown", "accepted", "declined", "tentative"]) }).strict(),
  z.object({ dimension: z.literal("reply"), value: z.enum(["unknown", "pending", "sent", "failed"]) }).strict(),
  z.object({ dimension: z.literal("calendar"), value: z.enum(["unknown", "pending", "accepted", "declined", "failed"]) }).strict(),
  z.object({ dimension: z.literal("meeting"), value: z.enum(["unknown", "upcoming", "happened"]) }).strict(),
]);
export const workChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reschedule"), window: workWindowSchema, reason: text.max(500) }).strict(),
  z.object({ type: z.literal("cancel"), reason: text.max(500) }).strict(),
]);
export const workCaptureSchema = z.object({
  requestId: z.uuid(), taskId: id.optional(), title: z.string().trim().min(1).max(500), description: z.string().max(5000).optional(),
  context: workContextSchema, sources: z.array(workSourceSchema).max(12).default([]),
  nextAction: z.string().trim().max(1000).default(""),
}).strict();
export const workReadSchema = z.object({ taskId: id, offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(20).default(10) }).strict();
export const workSearchSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(), attentionOnly: z.boolean().default(false),
  source: workSourceSchema.pick({ kind: true, system: true, account: true, externalId: true, calendarEventId: true }).optional(),
  offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(20).default(10),
}).strict();
export const workUpdateSchema = z.object({
  taskId: id, requestId: z.uuid(), expectedRevision: z.string().regex(/^work-v1:[A-Za-z0-9_-]+:\d+$/),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("source"), source: workSourceSchema }).strict(),
    z.object({ type: z.literal("report"), summary: text, signal: workSignalSchema.optional(), receiptRef: z.string().trim().min(1).max(500).optional(),
      sourceId: id.optional(), reportedAt: z.string().datetime({ offset: true }).max(40).optional(), nextAction: z.string().trim().max(1000).optional(), needsAttention: z.boolean().optional() }).strict(),
    z.object({ type: z.literal("propose"), change: workChangeSchema }).strict(),
    z.object({ type: z.literal("resolve"), entryId: id, decision: z.enum(["apply", "dismiss"]), reason: text }).strict(),
  ]),
}).strict();
export type WorkContext = z.infer<typeof workContextSchema>;
export type WorkSourceInput = z.infer<typeof workSourceSchema>;
export type WorkSignal = z.infer<typeof workSignalSchema>;
export type WorkChange = z.infer<typeof workChangeSchema>;
export type WorkCapture = z.infer<typeof workCaptureSchema>;
export type WorkUpdate = z.infer<typeof workUpdateSchema>;
export type WorkSignals = Partial<Record<WorkSignal["dimension"], { value: string; actorKey: string; recordedAt: string }>>;
export type WorkSource = WorkSourceInput & { id: string; actorKey: string; createdAt: string };
export type WorkEntry = { id: string; kind: string; actorKey: string; summary: string; createdAt: string; details: Record<string, unknown>; resolvesId: string | null };
export type WorkSummary = { taskId: string; title: string; taskStatus: string; revision: string; context: WorkContext; signals: WorkSignals; cancelled: boolean;
  nextAction: string; needsAttention: boolean; updatedAt: string; lastActorKey: string };
export type WorkView = { record: WorkSummary | null; sources: WorkSource[]; entries: WorkEntry[]; pendingChanges: WorkEntry[];
  total: number; nextOffset: number | null; canWrite: boolean; canResolve: boolean; schedule: { startsAt: string; endsAt: string } | null };
export type WorkSearch = { items: WorkSummary[]; total: number; nextOffset: number | null };
export type WorkReceipt = { replayed: boolean; receipt: { taskId: string; revision: string; outcome: string; executionStarted: false; taskStatusChanged: false } };
