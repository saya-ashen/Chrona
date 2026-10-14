/**
 * Personal-steward shared contract. Owned by the integration supervisor:
 * engine, routes, adapters and web all build against these shapes.
 * See docs/zh/personal-steward.md for the product direction and loop.
 */
import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const iso = z.string().datetime({ offset: true }).max(40);
const short = z.string().trim().min(1).max(200);
const prose = z.string().trim().min(1).max(4000);

// ---------------------------------------------------------------- vocab ----

export const AFFAIR_STATUSES = ["active", "watching", "paused", "closed"] as const;
export const CONNECTION_KINDS = ["local_test", "reddit_inbox", "chino_service_health"] as const;
/** How events arrive. A callable tool does not imply `webhook`. */
export const CONNECTION_MODES = ["poll", "webhook", "manual"] as const;
export const CONNECTION_STATUSES = ["active", "paused", "revoked", "needs_authorization", "failing"] as const;
export const EVENT_STATUSES = ["baseline", "pending", "assessed", "failed"] as const;
export const LINK_STATUSES = ["unlinked", "suggested", "confirmed", "rejected"] as const;
/** What the steward does with one assessed event. */
export const DISPOSITIONS = ["retain", "digest", "notify_now", "await_decision", "act"] as const;
/**
 * Closed action vocabulary. Permission is decided deterministically against a
 * Delegation; text inside an event can never add an action.
 */
export const STEWARD_ACTIONS = [
  "read_source", "summarize", "notify_user", "create_follow_up", "link_affair",
  "propose_delegation", "propose_tool", "run_tool",
  "reply_external", "mark_read_external", "delete_external",
] as const;
/** Never permitted by any delegation during the read-only pilot. */
export const PILOT_DENIED_ACTIONS = ["reply_external", "mark_read_external", "delete_external"] as const;
export const PERMISSION_OUTCOMES = ["allowed", "ask_first", "denied"] as const;
export const DELEGATION_STATUSES = ["proposed", "active", "paused", "revoked", "expired"] as const;
export const DELEGATION_TRANSITIONS = ["grant", "pause", "resume", "revoke"] as const;
export const CONNECTION_TRANSITIONS = ["pause", "resume", "revoke"] as const;
export const ATTENTION_KINDS = ["decision", "change", "commitment", "suggestion", "result", "failure"] as const;
export const ATTENTION_STATUSES = ["open", "snoozed", "resolved", "dismissed"] as const;
export const ATTENTION_DECISIONS = ["approve", "decline", "snooze", "dismiss", "less_often", "done"] as const;
/** generated ≠ sent ≠ acknowledged. `uncertain` = channel outcome unknown. */
export const NOTIFICATION_STATUSES = ["generated", "queued", "sent", "failed", "uncertain", "suppressed", "acknowledged"] as const;
export const FOLLOW_UP_STATUSES = ["pending", "done", "cancelled"] as const;
/** Lightest-first ways to handle a need; see chooseHandling in @chrona/domain. */
export const HANDLING_MODES = ["direct_answer", "result_page", "reuse_tool", "script", "delegation", "panel", "agent_iteration"] as const;
export const TOOL_KINDS = ["script", "panel"] as const;
/** generated ≠ validated ≠ authorized ≠ enabled. */
export const TOOL_STATES = ["generated", "validation_failed", "validated", "authorized", "enabled", "disabled", "retired"] as const;
export const TOOL_TRANSITIONS = ["validate", "authorize", "enable", "disable", "retire"] as const;
export const SCHEDULE_ITEM_KINDS = ["appointment", "deadline", "steward_check", "follow_up", "unconfirmed_suggestion"] as const;

export type AffairStatus = (typeof AFFAIR_STATUSES)[number];
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export type ConnectionMode = (typeof CONNECTION_MODES)[number];
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type LinkStatus = (typeof LINK_STATUSES)[number];
export type Disposition = (typeof DISPOSITIONS)[number];
export type StewardAction = (typeof STEWARD_ACTIONS)[number];
export type PermissionOutcome = (typeof PERMISSION_OUTCOMES)[number];
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export type HandlingMode = (typeof HANDLING_MODES)[number];
export type ToolState = (typeof TOOL_STATES)[number];

// ---------------------------------------------------------------- views ----

export const evidenceSchema = z.object({
  eventId: id.optional(), label: short, excerpt: z.string().max(1000).default(""),
  url: z.string().url().max(2048).optional(), observedAt: iso.optional(),
}).strict();

export const affairSchema = z.object({
  id, title: short, summary: z.string().max(4000), goal: z.string().max(2000),
  status: z.enum(AFFAIR_STATUSES), keywords: z.array(short).max(20),
  taskId: id.nullable(), openAttentionCount: z.number().int().min(0),
  createdAt: iso, updatedAt: iso,
}).strict();

export const connectionSchema = z.object({
  id, kind: z.enum(CONNECTION_KINDS), label: short, mode: z.enum(CONNECTION_MODES),
  status: z.enum(CONNECTION_STATUSES),
  readScopes: z.array(short).max(20), writeScopes: z.array(short).max(20),
  pollIntervalSeconds: z.number().int().min(60).nullable(),
  baselineAt: iso.nullable(), lastSuccessAt: iso.nullable(), lastFailureAt: iso.nullable(),
  lastError: z.string().max(500).nullable(), nextCheckAt: iso.nullable(),
  /** Honest coverage statement, e.g. "polling only; items older than baseline are not processed". */
  coverageNote: z.string().max(500), pendingEvents: z.number().int().min(0), failedEvents: z.number().int().min(0),
}).strict();

export const inboundEventSchema = z.object({
  id, connectionId: id, externalId: z.string().min(1).max(500), status: z.enum(EVENT_STATUSES),
  title: z.string().max(500), body: z.string().max(8000), author: z.string().max(200),
  url: z.string().url().max(2048).nullable(), occurredAt: iso, receivedAt: iso,
  affairId: id.nullable(), linkStatus: z.enum(LINK_STATUSES),
  attempts: z.number().int().min(0), lastError: z.string().max(500).nullable(), nextAttemptAt: iso.nullable(),
}).strict();

export const notificationPolicySchema = z.object({
  mode: z.enum(["immediate", "digest", "silent"]).default("digest"),
  cooldownMinutes: z.number().int().min(0).max(10080).default(60),
  /** Local "HH:MM" bounds; null disables quiet hours. */
  quietHours: z.object({ start: z.string().regex(/^\d\d:\d\d$/), end: z.string().regex(/^\d\d:\d\d$/), timezone: z.string().min(1).max(80) }).strict().nullable().default(null),
  /** "in_app" = visible in Chrona itself; the only channel that needs no external account. */
  channel: short.default("in_app"),
}).strict();

export const delegationSchema = z.object({
  id, revision: z.number().int().min(1), status: z.enum(DELEGATION_STATUSES),
  affairId: id.nullable(), connectionId: id.nullable(),
  purpose: prose, originalWording: z.string().max(4000),
  cadenceSeconds: z.number().int().min(60).nullable(),
  allowedActions: z.array(z.enum(STEWARD_ACTIONS)), askFirstActions: z.array(z.enum(STEWARD_ACTIONS)),
  notification: notificationPolicySchema,
  limits: z.object({ maxEventsPerCheck: z.number().int().min(1).max(500).default(50), maxNotificationsPerDay: z.number().int().min(0).max(200).default(10) }).strict(),
  grantedAt: iso.nullable(), expiresAt: iso.nullable(),
  lastCheckAt: iso.nullable(), lastSuccessAt: iso.nullable(), lastFailureAt: iso.nullable(), lastError: z.string().max(500).nullable(),
  createdAt: iso, updatedAt: iso,
}).strict();

export const permissionDecisionSchema = z.object({
  action: z.enum(STEWARD_ACTIONS), outcome: z.enum(PERMISSION_OUTCOMES),
  delegationId: id.nullable(), delegationRevision: z.number().int().nullable(), reason: z.string().max(500),
}).strict();

export const assessmentSchema = z.object({
  id, eventId: id, assessor: short, disposition: z.enum(DISPOSITIONS),
  whatHappened: prose, whyItMatters: z.string().max(4000), nextStep: z.string().max(2000),
  proposedAction: z.enum(STEWARD_ACTIONS).nullable(), permission: permissionDecisionSchema.nullable(),
  createdAt: iso,
}).strict();

export const attentionItemSchema = z.object({
  id, kind: z.enum(ATTENTION_KINDS), status: z.enum(ATTENTION_STATUSES),
  affairId: id.nullable(), affairTitle: z.string().max(200).nullable(), eventId: id.nullable(), delegationId: id.nullable(),
  title: short, whatHappened: prose, whyItMatters: z.string().max(4000), nextStep: z.string().max(2000),
  evidence: z.array(evidenceSchema).max(20), dueAt: iso.nullable(), snoozedUntil: iso.nullable(),
  decision: z.enum(ATTENTION_DECISIONS).nullable(), decidedAt: iso.nullable(), createdAt: iso, updatedAt: iso,
}).strict();

export const notificationSchema = z.object({
  id, attentionItemId: id.nullable(), channel: short, status: z.enum(NOTIFICATION_STATUSES),
  title: short, body: z.string().max(2000), link: z.string().max(2048).nullable(),
  attempts: z.number().int().min(0), lastError: z.string().max(500).nullable(), nextAttemptAt: iso.nullable(),
  generatedAt: iso, sentAt: iso.nullable(), acknowledgedAt: iso.nullable(),
}).strict();

export const followUpSchema = z.object({
  id, affairId: id.nullable(), attentionItemId: id.nullable(), note: prose, dueAt: iso,
  status: z.enum(FOLLOW_UP_STATUSES), createdAt: iso,
}).strict();

export const managedToolSchema = z.object({
  id, affairId: id.nullable(), kind: z.enum(TOOL_KINDS), name: short, purpose: prose,
  handlingMode: z.enum(HANDLING_MODES), selectionRationale: z.string().max(2000),
  dataScopes: z.array(short).max(20), version: z.number().int().min(1), state: z.enum(TOOL_STATES),
  validationSummary: z.string().max(2000).nullable(), validatedVersion: z.number().int().nullable(),
  authorizedAt: iso.nullable(), enabledAt: iso.nullable(),
  lastRunAt: iso.nullable(), lastSuccessAt: iso.nullable(), lastFailureAt: iso.nullable(), createdAt: iso, updatedAt: iso,
}).strict();

export const scheduleItemSchema = z.object({
  id, kind: z.enum(SCHEDULE_ITEM_KINDS), title: short, startsAt: iso, endsAt: iso.nullable(),
  affairId: id.nullable(), sourceRef: z.string().max(200).nullable(), confirmed: z.boolean(),
}).strict();

export const stewardHealthSchema = z.object({
  assessor: z.object({ available: z.boolean(), name: short, lastError: z.string().max(500).nullable() }).strict(),
  pendingEvents: z.number().int().min(0), failedEvents: z.number().int().min(0), oldestPendingAt: iso.nullable(),
  queuedNotifications: z.number().int().min(0), failedNotifications: z.number().int().min(0),
  failingConnections: z.number().int().min(0), lastTickAt: iso.nullable(),
}).strict();

/** One published version from the existing results layer; `href` is app-relative without the locale prefix. */
export const resultSummarySchema = z.object({
  id, taskId: id, taskTitle: z.string().max(500), title: z.string().max(500), version: z.number().int().min(1),
  /** Review state as recorded by the results layer; publication is not acceptance. */
  reviewState: z.string().max(40), publishedAt: iso, href: z.string().max(2048),
}).strict();

export const todayViewSchema = z.object({
  generatedAt: iso,
  decisions: z.array(attentionItemSchema), changes: z.array(attentionItemSchema),
  commitments: z.array(attentionItemSchema), suggestions: z.array(attentionItemSchema),
  results: z.array(attentionItemSchema), upcoming: z.array(scheduleItemSchema),
  /** Newest published result versions, read-only; empty when the workspace has none. */
  recentResults: z.array(resultSummarySchema).max(20).default([]),
  health: stewardHealthSchema,
}).strict();

export const affairDetailSchema = z.object({
  affair: affairSchema, attention: z.array(attentionItemSchema), events: z.array(inboundEventSchema),
  suggestedEvents: z.array(inboundEventSchema), delegations: z.array(delegationSchema),
  followUps: z.array(followUpSchema), tools: z.array(managedToolSchema),
}).strict();

// ------------------------------------------------------------- requests ----

export const createAffairSchema = z.object({ title: short, summary: z.string().max(4000).default(""), goal: z.string().max(2000).default(""), keywords: z.array(short).max(20).default([]), taskId: id.optional() }).strict();
export const updateAffairSchema = createAffairSchema.partial().extend({ status: z.enum(AFFAIR_STATUSES).optional() }).strict();
export const createConnectionSchema = z.object({ kind: z.enum(CONNECTION_KINDS), label: short, pollIntervalSeconds: z.number().int().min(60).max(86400).optional() }).strict();
export const connectionTransitionSchema = z.object({ action: z.enum(CONNECTION_TRANSITIONS) }).strict();
export const proposeDelegationSchema = z.object({
  affairId: id.optional(), connectionId: id.optional(), purpose: prose, originalWording: z.string().max(4000).default(""),
  cadenceSeconds: z.number().int().min(60).max(604800).optional(),
  allowedActions: z.array(z.enum(STEWARD_ACTIONS)).max(STEWARD_ACTIONS.length),
  askFirstActions: z.array(z.enum(STEWARD_ACTIONS)).max(STEWARD_ACTIONS.length).default([]),
  notification: notificationPolicySchema.optional(), expiresAt: iso.optional(),
}).strict();
export const delegationTransitionSchema = z.object({ action: z.enum(DELEGATION_TRANSITIONS), expectedRevision: z.number().int().min(1) }).strict();
export const attentionDecisionSchema = z.object({ decision: z.enum(ATTENTION_DECISIONS), snoozeUntil: iso.optional(), note: z.string().max(1000).optional() }).strict();
export const eventLinkSchema = z.object({ decision: z.enum(["confirm", "reject"]), affairId: id.optional() }).strict();
export const syncResultSchema = z.object({ received: z.number().int().min(0), duplicates: z.number().int().min(0), baseline: z.boolean() }).strict();
export const toolTransitionSchema = z.object({ action: z.enum(TOOL_TRANSITIONS), expectedVersion: z.number().int().min(1) }).strict();

export const handlingSignalsSchema = z.object({
  repeatsExpected: z.enum(["once", "few", "recurring"]), rulesStable: z.boolean(), needsOngoingObservation: z.boolean(),
  needsUserInteraction: z.enum(["none", "read", "compare_or_fill"]), ambiguity: z.enum(["clear", "fuzzy"]),
  existingToolFits: z.boolean(), risk: z.enum(["low", "high"]), valueWorthKeeping: z.boolean(),
}).strict();
export const handlingChoiceSchema = z.object({ mode: z.enum(HANDLING_MODES), rationale: z.string().max(2000), escalatesFrom: z.enum(HANDLING_MODES).optional() }).strict();
/** `spec` is validated by toolSpecSchema in @chrona/domain; it is declarative data, never code. */
export const generateToolSchema = z.object({ affairId: id.optional(), name: short, purpose: prose, dataScopes: z.array(short).max(20).default([]), signals: handlingSignalsSchema, spec: z.unknown() }).strict();
export const generatedToolSchema = z.object({ created: z.boolean(), choice: handlingChoiceSchema, tool: managedToolSchema.optional() }).strict();
export const runToolSchema = z.object({ events: z.array(z.object({ title: z.string().max(500), body: z.string().max(8000), author: z.string().max(200), connectionKind: z.enum(CONNECTION_KINDS).optional() }).strict()).max(500).default([]) }).strict();
export const toolRunResultSchema = z.object({
  matches: z.array(z.object({ index: z.number().int(), matched: z.boolean(), disposition: z.string().optional(), note: z.string().optional() })),
  rows: z.array(z.record(z.string(), z.string())),
}).strict();

// ------------------------------------------------------------ HTTP map -----
/**
 * All under /api/steward. Owner-only (single local owner, same check as
 * work-records). Every request carries `?workspaceId=` naming an existing
 * workspace; all rows are scoped to it. List endpoints return `{ items: T[] }`.
 *
 *   GET  /today                         -> TodayView
 *   GET  /health                        -> StewardHealth
 *   GET  /affairs | POST /affairs       -> {items: Affair[]} | Affair
 *   GET  /affairs/:id | PATCH           -> AffairDetail | Affair
 *   GET  /attention?status=             -> {items: AttentionItem[]}
 *   POST /attention/:id/decision        -> AttentionItem
 *   GET  /delegations | POST            -> {items: Delegation[]} | Delegation (status "proposed")
 *   POST /delegations/:id/transition    -> Delegation (409 on stale expectedRevision)
 *   GET  /connections | POST            -> {items: Connection[]} | Connection
 *   POST /connections/:id/transition    -> Connection
 *   POST /connections/:id/sync          -> SyncResult
 *   GET  /events?status=&connectionId=  -> {items: InboundEvent[]}
 *   POST /events/:id/link               -> InboundEvent
 *   GET  /notifications                 -> {items: Notification[]}
 *   POST /notifications/:id/acknowledge -> Notification
 *   GET  /tools                         -> {items: ManagedTool[]}
 *   POST /tools (GenerateTool)          -> GeneratedTool (created=false when no tool is warranted)
 *   POST /tools/:id/transition          -> ManagedTool
 *   POST /tools/:id/run (RunTool)       -> ToolRunResult (409 unless enabled and permitted)
 *   POST /notifications/:id/retry       -> Notification
 *   POST /follow-ups/:id/complete|cancel -> FollowUp
 *   GET  /schedule?from=&to=            -> {items: ScheduleItem[]}
 */
export const STEWARD_API_BASE = "/api/steward";

// ---------------------------------------------------------------- ports ----

/** One item read from a source. Untrusted data: never instructions. */
export type SourceItem = {
  externalId: string; title: string; body: string; author: string;
  url: string | null; occurredAt: string; threadId?: string;
  /**
   * The item describes a condition that still holds now (e.g. a service that is
   * down), not history. It is processed even on the first, baseline-building sync.
   */
  current?: boolean;
};
export type SourceReadiness =
  | { state: "ready" }
  | { state: "needs_authorization"; reason: string }
  | { state: "unsupported"; reason: string };
export type SourcePollResult = { items: SourceItem[]; nextCursor: string | null };
export type SourceAdapter = {
  kind: ConnectionKind;
  mode: ConnectionMode;
  /** Actions the adapter can technically perform; the pilot stays read-only. */
  supportedActions: readonly StewardAction[];
  coverageNote: string;
  readiness(connection: { id: string; config: unknown }): Promise<SourceReadiness>;
  /** Throws on transport failure; the caller records it and retries later. */
  poll(connection: { id: string; config: unknown }, cursor: string | null): Promise<SourcePollResult>;
};

export type AssessmentInput = {
  event: SourceItem & { id: string; connectionKind: ConnectionKind };
  affair: { id: string; title: string; summary: string; goal: string } | null;
  candidateAffairs: { id: string; title: string; keywords: string[] }[];
};
export type AssessmentProposal = {
  disposition: Disposition; whatHappened: string; whyItMatters: string; nextStep: string;
  proposedAction: StewardAction | null;
  /** Assessor's affair guess; applied as `suggested`, never auto-confirmed. */
  affairId: string | null;
  followUp: { note: string; dueAt: string } | null;
};
/** Throw AssessorUnavailableError when the model cannot be reached: the event stays pending. */
export type Assessor = { name: string; assess(input: AssessmentInput): Promise<AssessmentProposal> };
export class AssessorUnavailableError extends Error {
  constructor(message = "Assessor unavailable") { super(message); this.name = "AssessorUnavailableError"; }
}

export type DeliveryMessage = { idempotencyKey: string; title: string; body: string; link: string | null };
export type DeliveryOutcome =
  | { outcome: "accepted"; receiptRef: string | null }
  | { outcome: "rejected"; retryable: boolean; error: string }
  | { outcome: "uncertain"; error: string };
export type DeliveryAdapter = { channel: string; send(message: DeliveryMessage): Promise<DeliveryOutcome> };

// ---------------------------------------------------------------- types ----

export type Evidence = z.infer<typeof evidenceSchema>;
export type Affair = z.infer<typeof affairSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type InboundEvent = z.infer<typeof inboundEventSchema>;
export type NotificationPolicy = z.infer<typeof notificationPolicySchema>;
export type Delegation = z.infer<typeof delegationSchema>;
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type StewardNotification = z.infer<typeof notificationSchema>;
export type FollowUp = z.infer<typeof followUpSchema>;
export type ManagedTool = z.infer<typeof managedToolSchema>;
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
export type StewardHealth = z.infer<typeof stewardHealthSchema>;
export type ResultSummary = z.infer<typeof resultSummarySchema>;
export type TodayView = z.infer<typeof todayViewSchema>;
export type HandlingSignalsInput = z.infer<typeof handlingSignalsSchema>;
export type GeneratedTool = z.infer<typeof generatedToolSchema>;
export type ToolRunResult = z.infer<typeof toolRunResultSchema>;
export type SyncResult = z.infer<typeof syncResultSchema>;
export type AffairDetail = z.infer<typeof affairDetailSchema>;
