/**
 * Personal-steward shared contract. Owned by the integration supervisor:
 * engine, routes, adapters, the agent extension and web all build against these shapes.
 * Product goals: docs/zh/steward-goals.md. Architecture and pages: docs/zh/steward-rebuild.md.
 *
 * Everything the user sees is an Affair. Runs, events and assessments are internal records
 * shown only under an affair's technical details.
 */
import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const iso = z.string().datetime({ offset: true }).max(40);
const short = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1);
const hhmm = z.string().regex(/^\d\d:\d\d$/);

// ---------------------------------------------------------------- vocab ----

/** `active` 进行中 · `watching` 照看中 (has a check cadence) · `paused` · `done` 已结束. */
export const AFFAIR_STATUSES = ["active", "watching", "paused", "done"] as const;
/** Runner state, owned by Chrona; `waiting_user` = at least one open question/approval blocks it. */
export const AGENT_STATES = ["idle", "queued", "running", "waiting_user", "failed"] as const;
export const ENTRY_ACTORS = ["user", "chrona", "source"] as const;
export const ENTRY_KINDS = [
  "request", "supplement", "feedback", "answer", "decision",
  "progress", "change", "question", "approval_request", "result", "care", "notification", "status", "note",
] as const;
export const ASK_KINDS = ["question", "approval", "suggestion"] as const;
export const ASK_STATUSES = ["open", "answered", "approved", "denied", "dismissed", "expired"] as const;

/**
 * Closed action vocabulary the policy layer judges. Text from sources, web pages or the
 * model can never add an action or a grant.
 */
export const ACTIONS = [
  "read_source", "web_research", "write_chrona", "set_care", "enable_panel", "run_script",
  "send_external_message", "modify_external", "purchase", "delete_data", "connect_source",
  "share_third_party", "change_credentials",
] as const;
/** 直接做 · 做完告知 · 预先授权后直接做 · 先问再做 · 交还用户（永不做）. */
export const GRANT_MODES = ["auto", "notify_after", "preapproved", "ask", "never"] as const;
/** Built-in defaults (steward-goals §7). A user grant may only narrow `never`. */
export const DEFAULT_POLICY = {
  read_source: "auto", web_research: "auto", write_chrona: "auto",
  set_care: "notify_after", enable_panel: "notify_after",
  run_script: "ask", send_external_message: "ask", modify_external: "ask", purchase: "ask",
  delete_data: "ask", connect_source: "ask", share_third_party: "ask",
  change_credentials: "never",
} as const satisfies Record<(typeof ACTIONS)[number], (typeof GRANT_MODES)[number]>;
/** How long an approval holds when the user picks it in an approval ask. */
export const APPROVAL_SCOPES = ["once", "affair"] as const;

export const NOTIFY_LEVELS = ["now", "digest", "web"] as const;
/** generated ≠ sent ≠ acknowledged. `folded` = moved into the digest by the budget. `uncertain` = channel outcome unknown. */
export const NOTIFICATION_STATUSES = ["queued", "sent", "failed", "uncertain", "folded", "suppressed", "acknowledged"] as const;
export const DEFAULT_NOTIFICATION_SETTINGS = {
  dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, timezone: "Asia/Shanghai", digestAt: "09:00",
} as const;
export const SUGGESTION_COOLDOWN_DAYS = 30;
/** A kind of manual work must recur this many times before Chrona proposes automating it. */
export const AUTOMATION_REPEAT_THRESHOLD = 3;

export const CONNECTION_KINDS = ["local_test", "chino_service_health"] as const;
export const CONNECTION_MODES = ["poll", "webhook", "manual"] as const;
export const CONNECTION_STATUSES = ["active", "paused", "revoked", "needs_authorization", "failing"] as const;
export const EVENT_STATUSES = ["baseline", "pending", "assessed", "failed"] as const;
/** What the assessor recommends for one source event. */
export const DISPOSITIONS = ["ignore", "record", "notify", "wake_affair"] as const;
export const DELIVERY_CHANNELS = ["in_app", "chrona_qqbot"] as const;

export const HANDLING_MODES = ["direct_answer", "result_page", "reuse_tool", "script", "care", "panel", "agent_iteration"] as const;
export const TOOL_KINDS = ["script", "panel"] as const;
/** draft ≠ approved ≠ enabled. A script edit creates a new version that needs approval again. */
export const TOOL_STATES = ["draft", "validation_failed", "approved", "enabled", "disabled", "retired"] as const;

export type AffairStatus = (typeof AFFAIR_STATUSES)[number];
export type AgentState = (typeof AGENT_STATES)[number];
export type EntryActor = (typeof ENTRY_ACTORS)[number];
export type EntryKind = (typeof ENTRY_KINDS)[number];
export type AskKind = (typeof ASK_KINDS)[number];
export type AskStatus = (typeof ASK_STATUSES)[number];
export type Action = (typeof ACTIONS)[number];
export type GrantMode = (typeof GRANT_MODES)[number];
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export type ConnectionMode = (typeof CONNECTION_MODES)[number];
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type Disposition = (typeof DISPOSITIONS)[number];
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type HandlingMode = (typeof HANDLING_MODES)[number];
export type ToolKind = (typeof TOOL_KINDS)[number];
export type ToolState = (typeof TOOL_STATES)[number];

// ---------------------------------------------------------------- views ----

export const handlingSchema = z.object({ mode: z.enum(HANDLING_MODES), rationale: text.max(2000) }).strict();
export const careSchema = z.object({
  cadenceSeconds: z.number().int().min(300).max(604800),
  /** Default level for routine findings of this care; important problems may still be `now`. */
  notify: z.enum(NOTIFY_LEVELS),
  connectionId: id.nullable(),
  lastCheckAt: iso.nullable(), nextCheckAt: iso.nullable(),
}).strict();

export const affairSchema = z.object({
  id, title: short, goal: z.string().max(2000),
  /** "现在怎么样了": maintained by the agent, plain prose. */
  summary: z.string().max(4000), nextStep: z.string().max(1000),
  status: z.enum(AFFAIR_STATUSES), agentState: z.enum(AGENT_STATES),
  handling: handlingSchema.nullable(), care: careSchema.nullable(),
  openAsks: z.number().int().min(0),
  /** Hidden fallback short code for chat (never required in normal use). */
  ref: z.string().max(16).nullable(),
  latestResult: z.object({ version: z.number().int().min(1), title: short, createdAt: iso }).strict().nullable(),
  lastError: z.string().max(500).nullable(),
  createdAt: iso, updatedAt: iso, lastActivityAt: iso,
}).strict();

export const entrySchema = z.object({
  id, affairId: id, at: iso, actor: z.enum(ENTRY_ACTORS), kind: z.enum(ENTRY_KINDS),
  text: z.string().max(8000),
  /** Small structured payload (e.g. findings, result version, event id); never secrets. */
  data: z.record(z.string(), z.unknown()).nullable(),
}).strict();

export const resultSourceSchema = z.object({
  title: text.max(300), url: z.string().url().max(2048), note: z.string().max(500).default(""),
  /** True when the URL was actually fetched/seen in this affair's runs. */
  verified: z.boolean().default(false),
}).strict();
export const resultSchema = z.object({
  id, affairId: id, version: z.number().int().min(1), title: short, summary: z.string().max(2000),
  /** Markdown. Rendered as content, never executed. */
  body: z.string().max(60_000),
  sources: z.array(resultSourceSchema).max(30), limitations: z.string().max(2000), nextSteps: z.array(text.max(500)).max(10),
  createdAt: iso,
}).strict();

export const askSchema = z.object({
  id, affairId: id.nullable(), affairTitle: z.string().max(200).nullable(),
  kind: z.enum(ASK_KINDS), status: z.enum(ASK_STATUSES),
  title: short,
  /** Why this matters / what happens on each answer. */
  detail: z.string().max(2000),
  /** Questions: what is being asked. */
  questions: z.array(z.object({ question: text.max(500), why: z.string().max(500) }).strict()).max(3),
  /** Approvals: the action and a human description of exactly what will be done. */
  action: z.enum(ACTIONS).nullable(),
  /** Suggestions: dedupe/cooldown topic. */
  topic: z.string().max(80).nullable(),
  answer: z.string().max(2000).nullable(),
  /** How it was resolved. `never_again` = status `dismissed` with no cooldown end: the topic is suppressed permanently. */
  decision: z.enum(["answer", "approve", "deny", "dismiss", "accept_suggestion", "never_again"]).nullable(),
  /** Suggestions dismissed with `dismiss`: no new suggestion on this topic until then (SUGGESTION_COOLDOWN_DAYS). */
  cooldownUntil: iso.nullable(),
  ref: z.string().max(16).nullable(),
  createdAt: iso, resolvedAt: iso.nullable(),
}).strict();

export const runSchema = z.object({
  id, number: z.number().int().min(1),
  wakeReason: z.enum(["new_request", "user_input", "follow_up_due", "care_check", "source_change", "retry"]),
  status: z.enum(["running", "published", "asked", "closed", "progressed", "no_outcome", "timed_out", "budget_exhausted", "agent_unavailable", "cancelled", "lease_expired"]),
  toolCalls: z.array(z.object({ tool: short, at: iso, ok: z.boolean(), note: z.string().max(300) }).strict()).max(80),
  error: z.string().max(500).nullable(), startedAt: iso, endedAt: iso.nullable(),
}).strict();

export const followUpSchema = z.object({
  id, affairId: id, note: text.max(1000), dueAt: iso, status: z.enum(["pending", "done", "cancelled"]), createdAt: iso,
}).strict();

export const grantScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("affair"), affairId: id }).strict(),
  z.object({ kind: z.literal("connection"), connectionId: id }).strict(),
  z.object({ kind: z.literal("tool_version"), toolId: id, version: z.number().int().min(1) }).strict(),
]);
export const grantSchema = z.object({
  id, action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), scope: grantScopeSchema,
  /** `once` grants are consumed by their first use. */
  once: z.boolean(), consumedAt: iso.nullable(), expiresAt: iso.nullable(), createdAt: iso, revokedAt: iso.nullable(),
}).strict();
export const policyDecisionSchema = z.object({
  action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), grantId: id.nullable(), reason: z.string().max(500),
}).strict();

export const preferenceSchema = z.object({
  id, text: text.max(500), origin: z.enum(["said", "learned"]), createdAt: iso, lastUsedAt: iso.nullable(),
}).strict();

export const chatMessageSchema = z.object({
  id, direction: z.enum(["in", "out"]), channel: z.enum(DELIVERY_CHANNELS), text: z.string().max(4000),
  affairId: id.nullable(), at: iso,
}).strict();

export const notificationSchema = z.object({
  id, affairId: id.nullable(), askId: id.nullable(), level: z.enum(NOTIFY_LEVELS),
  channel: z.enum(DELIVERY_CHANNELS), status: z.enum(NOTIFICATION_STATUSES),
  title: short, body: z.string().max(2000),
  attempts: z.number().int().min(0), lastError: z.string().max(500).nullable(), nextAttemptAt: iso.nullable(),
  createdAt: iso, sentAt: iso.nullable(), acknowledgedAt: iso.nullable(),
  /** "没用" feedback from the user; used to downgrade similar notifications. */
  feedback: z.enum(["useful", "not_useful"]).nullable(),
}).strict();

export const connectionSchema = z.object({
  id, kind: z.enum(CONNECTION_KINDS), label: short, mode: z.enum(CONNECTION_MODES), status: z.enum(CONNECTION_STATUSES),
  pollIntervalSeconds: z.number().int().min(60).nullable(),
  baselineAt: iso.nullable(), lastSuccessAt: iso.nullable(), lastFailureAt: iso.nullable(), lastError: z.string().max(500).nullable(),
  nextCheckAt: iso.nullable(),
  /** Honest coverage statement, e.g. "polling only; changes between polls can be missed". */
  coverageNote: z.string().max(500), pendingEvents: z.number().int().min(0), failedEvents: z.number().int().min(0),
}).strict();
export const inboundEventSchema = z.object({
  id, connectionId: id, externalId: z.string().min(1).max(500), status: z.enum(EVENT_STATUSES),
  title: z.string().max(500), body: z.string().max(8000), url: z.string().url().max(2048).nullable(),
  occurredAt: iso, receivedAt: iso, affairId: id.nullable(),
  disposition: z.enum(DISPOSITIONS).nullable(), attempts: z.number().int().min(0), lastError: z.string().max(500).nullable(),
}).strict();

export const toolSchema = z.object({
  id, affairId: id.nullable(), kind: z.enum(TOOL_KINDS), name: short, purpose: text.max(2000), rationale: z.string().max(2000),
  version: z.number().int().min(1), state: z.enum(TOOL_STATES), approvedVersion: z.number().int().nullable(),
  /** Script tools: language + source of the current version; panels: declarative spec. Never executed outside the sandbox. */
  script: z.object({ language: z.enum(["python", "typescript", "shell"]), source: z.string().max(20_000), usage: z.string().max(2000) }).strict().nullable(),
  spec: z.unknown().nullable(),
  lastRunAt: iso.nullable(), lastRunOk: z.boolean().nullable(), createdAt: iso, updatedAt: iso,
}).strict();

/** One row a user (or the agent, on the user's behalf) filled into a panel. Values are keyed by the panel spec's field keys. */
export const panelEntrySchema = z.object({
  id, toolId: id, values: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.null()])), createdAt: iso,
}).strict();
export const toolRunViewSchema = z.object({
  id, toolId: id, version: z.number().int().min(1), status: z.enum(["running", "succeeded", "failed", "timed_out", "unavailable"]),
  output: z.string().max(20_000), error: z.string().max(2000).nullable(), startedAt: iso, endedAt: iso.nullable(),
}).strict();
export const toolDetailSchema = z.object({
  tool: z.lazy(() => toolSchema), entries: z.array(panelEntrySchema).max(500), runs: z.array(toolRunViewSchema).max(20),
}).strict();

export const notificationSettingsSchema = z.object({
  dailyCap: z.number().int().min(0).max(50),
  quietHours: z.object({ start: hhmm, end: hhmm }).strict().nullable(),
  timezone: z.string().min(1).max(80),
  digestAt: hhmm,
}).strict();
export const settingsSchema = z.object({
  notifications: notificationSettingsSchema,
  chat: z.object({ channel: z.enum(DELIVERY_CHANNELS), bound: z.boolean(), sentToday: z.number().int().min(0) }).strict(),
}).strict();

export const healthSchema = z.object({
  agent: z.object({ available: z.boolean(), name: short, lastError: z.string().max(500).nullable() }).strict(),
  queuedAffairs: z.number().int().min(0), runningAffairs: z.number().int().min(0), failedAffairs: z.number().int().min(0),
  pendingEvents: z.number().int().min(0), failingConnections: z.number().int().min(0),
  queuedNotifications: z.number().int().min(0), failedNotifications: z.number().int().min(0),
  /** Script sandbox: available only when bubblewrap is configured and at least one interpreter exists. */
  sandbox: z.object({ available: z.boolean(), languages: z.array(z.enum(["python", "typescript", "shell"])) }).strict(),
  lastTickAt: iso.nullable(),
}).strict();

export const upcomingSchema = z.object({
  kind: z.enum(["follow_up", "care_check"]), affairId: id, affairTitle: short, note: z.string().max(1000), at: iso,
}).strict();
export const todayViewSchema = z.object({
  generatedAt: iso,
  counts: z.object({ active: z.number().int(), watching: z.number().int(), waiting: z.number().int(), newResults: z.number().int() }).strict(),
  /** Open questions and approvals, oldest first. */
  decisions: z.array(askSchema),
  /** Important source/agent changes since the user last looked (≤ 48 h). */
  changes: z.array(entrySchema.extend({ affairTitle: short })),
  results: z.array(resultSchema.pick({ id: true, affairId: true, version: true, title: true, summary: true, createdAt: true }).extend({ affairTitle: short })),
  upcoming: z.array(upcomingSchema),
  suggestions: z.array(askSchema),
  health: healthSchema,
}).strict();

export const affairDetailSchema = z.object({
  affair: affairSchema,
  asks: z.array(askSchema),
  /** Full latest result; older versions via the result endpoint. */
  latestResult: resultSchema.nullable(),
  resultVersions: z.array(z.object({ version: z.number().int().min(1), title: short, createdAt: iso }).strict()),
  entries: z.array(entrySchema),
  followUps: z.array(followUpSchema),
  tools: z.array(toolSchema),
  grants: z.array(grantSchema),
  runs: z.array(runSchema),
  events: z.array(inboundEventSchema),
}).strict();

// ------------------------------------------------------------- requests ----

export const createAffairSchema = z.object({ request: text.max(4000), title: short.optional() }).strict();
export const updateAffairSchema = z.object({
  title: short.optional(), goal: z.string().max(2000).optional(),
  status: z.enum(["active", "paused", "done"]).optional(),
  care: z.object({ cadenceSeconds: z.number().int().min(300).max(604800), notify: z.enum(NOTIFY_LEVELS) }).strict().nullable().optional(),
}).strict();
export const addEntrySchema = z.object({ kind: z.enum(["supplement", "feedback"]), text: text.max(4000) }).strict();
export const resolveAskSchema = z.object({
  decision: z.enum(["answer", "approve", "deny", "dismiss", "accept_suggestion", "never_again"]),
  text: z.string().max(2000).optional(),
  /** Approvals only. */
  scope: z.enum(APPROVAL_SCOPES).optional(),
}).strict();
export const chatInputSchema = z.object({ text: text.max(4000) }).strict();
export const chatReplySchema = z.object({
  reply: z.string().max(4000), affairId: id.nullable(),
  effects: z.array(z.object({ kind: short, affairId: id.nullable(), label: z.string().max(300) }).strict()).max(10),
}).strict();
export const createGrantSchema = z.object({ action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), scope: grantScopeSchema, expiresAt: iso.optional() }).strict();
export const createPreferenceSchema = z.object({ text: text.max(500) }).strict();
export const updateSettingsSchema = z.object({ notifications: notificationSettingsSchema.partial() }).strict();
export const notificationFeedbackSchema = z.object({ feedback: z.enum(["useful", "not_useful"]) }).strict();
export const createConnectionSchema = z.object({ kind: z.enum(CONNECTION_KINDS), label: short, pollIntervalSeconds: z.number().int().min(60).max(86400).optional() }).strict();
export const connectionTransitionSchema = z.object({ action: z.enum(["pause", "resume", "revoke"]) }).strict();
export const addPanelEntrySchema = z.object({ values: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.null()])) }).strict();
export const toolTransitionSchema = z.object({ action: z.enum(["approve", "enable", "disable", "retire"]), expectedVersion: z.number().int().min(1) }).strict();

// ------------------------------------------------------------ HTTP map -----
/**
 * All under /api/steward, owner-only, `?workspaceId=` on every request. Lists return `{ items: T[] }`.
 *
 *   GET  /today                              -> TodayView
 *   POST /chat (ChatInput)                   -> ChatReply   (same concierge as the QQ bot)
 *   GET  /chat/messages?limit=               -> {items: ChatMessage[]}
 *   GET  /affairs?status=                    -> {items: Affair[]}
 *   POST /affairs (CreateAffair)             -> Affair      (skips the concierge; queued for the agent)
 *   GET  /affairs/:id                        -> AffairDetail
 *   PATCH /affairs/:id (UpdateAffair)        -> Affair
 *   POST /affairs/:id/entries (AddEntry)     -> Entry       (wakes the agent)
 *   GET  /affairs/:id/results/:version       -> Result
 *   POST /asks/:id/resolve (ResolveAsk)      -> Ask
 *   GET  /settings | PATCH (UpdateSettings)  -> Settings
 *   GET  /grants | POST (CreateGrant)        -> {items: Grant[]} | Grant ; POST /grants/:id/revoke -> Grant
 *   GET  /preferences | POST | DELETE /preferences/:id
 *   GET  /notifications ; POST /notifications/:id/feedback ; POST /notifications/:id/retry
 *   GET  /connections | POST ; POST /connections/:id/transition ; POST /connections/:id/sync
 *   GET  /tools ; POST /tools/:id/transition
 *   GET  /tools/:id                          -> ToolDetail (panel entries newest first, last runs)
 *   POST /tools/:id/entries (AddPanelEntry)  -> PanelEntry (validated against the enabled panel spec)
 *   DELETE /tools/:id/entries/:entryId       -> 204
 *   GET  /health
 */
/** Fallback short codes: 4 characters, no 0/O/1/I/L. */
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REF_PATTERN = /^[2-9A-HJKMNP-Z]{4}$/;

export const STEWARD_API_BASE = "/api/steward";

// ------------------------------------------------------- agent protocol ----
/**
 * Two Pi roles, both through Chrona-scoped tools only (capability token per run):
 *  - concierge: one short run per incoming chat/web message; understands and routes, must end with `concierge_reply`.
 *  - affair agent: multi-step work on one affair; must end with a terminal tool.
 * Chrona owns every state change; model prose never changes state.
 */
export const RUN_LIMITS = {
  affairTimeoutMs: 6 * 60_000, conciergeTimeoutMs: 90_000,
  maxToolCalls: 40, maxWebCalls: 12, conciergeMaxWebCalls: 4,
  maxFailures: 3, maxRunsPerAffairPerDay: 12,
} as const;
export const WEB_TOOLS = ["web_search", "fetch_content"] as const;

const agentQuestion = z.object({ question: text.max(500), why: text.max(500) }).strict();
export const affairToolInputSchemas = {
  chrona_get_context: z.object({}).strict(),
  chrona_read_source: z.object({ connectionKind: z.enum(CONNECTION_KINDS), limit: z.number().int().min(1).max(20).default(10) }).strict(),
  chrona_save_progress: z.object({
    summary: text.max(2000), nextStep: z.string().max(500).default(""),
    findings: z.array(text.max(1000)).max(10).default([]),
    title: text.max(200).optional(), goal: text.max(2000).optional(), handling: handlingSchema.optional(),
  }).strict(),
  chrona_ask_user: z.object({ questions: z.array(agentQuestion).min(1).max(3), partialSummary: z.string().max(2000).default("") }).strict(),
  chrona_request_approval: z.object({ action: z.enum(ACTIONS), what: text.max(1000), why: text.max(1000) }).strict(),
  chrona_publish_result: z.object({
    title: text.max(200), summary: text.max(2000), body: text.max(60_000),
    sources: z.array(resultSourceSchema.omit({ verified: true })).max(30).default([]),
    limitations: z.string().max(2000).default(""), nextSteps: z.array(text.max(500)).max(10).default([]),
    handling: handlingSchema,
  }).strict(),
  chrona_set_care: z.object({
    cadenceMinutes: z.number().int().min(5).max(10080), notify: z.enum(NOTIFY_LEVELS).default("digest"),
    connectionKind: z.enum(CONNECTION_KINDS).optional(), why: text.max(1000),
  }).strict(),
  chrona_follow_up: z.object({ note: text.max(1000), dueAt: iso, reason: text.max(500) }).strict(),
  chrona_suggest: z.object({ topic: text.max(80), title: text.max(200), why: text.max(1000), nextStep: text.max(500) }).strict(),
  chrona_notify: z.object({ level: z.enum(["now", "digest"]), title: text.max(200), body: text.max(1500), why: text.max(500) }).strict(),
  chrona_remember: z.object({ text: text.max(500) }).strict(),
  chrona_draft_tool: z.object({
    kind: z.enum(TOOL_KINDS), name: text.max(200), purpose: text.max(2000), rationale: text.max(2000),
    spec: z.unknown().optional(),
    script: z.object({ language: z.enum(["python", "typescript", "shell"]), source: text.max(20_000), usage: text.max(2000) }).strict().optional(),
  }).strict(),
  /** Record values the user gave (e.g. in chat) into an enabled panel of this affair. */
  chrona_add_panel_entry: z.object({ toolId: id, values: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.null()])) }).strict(),
  chrona_run_tool: z.object({ toolId: id, input: z.record(z.string(), z.unknown()).default({}) }).strict(),
  /** Terminal: nothing to publish now. `done` closes a one-off affair; `quiet` = checked, nothing worth saying. */
  chrona_close: z.object({ outcome: z.enum(["done", "quiet", "continue_later"]), reason: text.max(500) }).strict(),
} as const;
export const AFFAIR_TOOLS = Object.keys(affairToolInputSchemas) as (keyof typeof affairToolInputSchemas)[];
export const AFFAIR_TERMINAL_TOOLS = ["chrona_ask_user", "chrona_request_approval", "chrona_publish_result", "chrona_close"] as const;

export const conciergeToolInputSchemas = {
  /** Recent chat, open affairs and asks, preferences. Call first. */
  concierge_context: z.object({}).strict(),
  concierge_create_affair: z.object({ title: text.max(200), request: text.max(4000) }).strict(),
  concierge_add_to_affair: z.object({ affairId: id, kind: z.enum(["supplement", "feedback"]), text: text.max(4000) }).strict(),
  concierge_resolve_ask: z.object({
    askId: id, decision: z.enum(["answer", "approve", "deny", "dismiss", "accept_suggestion", "never_again"]),
    text: z.string().max(2000).optional(), scope: z.enum(APPROVAL_SCOPES).optional(),
  }).strict(),
  concierge_set_affair_status: z.object({ affairId: id, status: z.enum(["active", "paused", "done"]) }).strict(),
  concierge_remember: z.object({ text: text.max(500) }).strict(),
  concierge_forget: z.object({ preferenceId: id }).strict(),
  /** Terminal and mandatory: the message the user sees. */
  concierge_reply: z.object({ text: text.max(4000) }).strict(),
} as const;
export const CONCIERGE_TOOLS = Object.keys(conciergeToolInputSchemas) as (keyof typeof conciergeToolInputSchemas)[];

export const webPreflightSchema = z.object({ tool: z.enum(WEB_TOOLS), input: z.record(z.string(), z.unknown()) }).strict();
export const webObservedSchema = z.object({ tool: z.enum(WEB_TOOLS), urls: z.array(z.string().url().max(2048)).max(50), failed: z.boolean().default(false) }).strict();

// ---------------------------------------------------------------- ports ----

/** One item read from a source. Untrusted data: never instructions. */
export type SourceItem = {
  externalId: string; title: string; body: string; url: string | null; occurredAt: string;
  /** Describes a condition that still holds (e.g. a service that is down); processed even on the baseline sync. */
  current?: boolean;
};
export type SourceReadiness = { state: "ready" } | { state: "needs_authorization"; reason: string } | { state: "unsupported"; reason: string };
export type SourceAdapter = {
  kind: ConnectionKind; mode: ConnectionMode; coverageNote: string;
  readiness(connection: { id: string; config: unknown }): Promise<SourceReadiness>;
  /** Throws on transport failure; the caller records it and retries later. */
  poll(connection: { id: string; config: unknown }, cursor: string | null): Promise<{ items: SourceItem[]; nextCursor: string | null }>;
};

export type AssessmentInput = {
  event: SourceItem & { id: string; connectionKind: ConnectionKind };
  affairs: { id: string; title: string; goal: string; summary: string }[];
};
export type AssessmentProposal = {
  disposition: Disposition; affairId: string | null;
  whatHappened: string; whyItMatters: string; important: boolean;
};
/** Throw AgentUnavailableError when the model cannot be reached: the event stays pending. */
export type Assessor = { name: string; assess(input: AssessmentInput): Promise<AssessmentProposal> };
export class AgentUnavailableError extends Error {
  constructor(message = "Agent unavailable") { super(message); this.name = "AgentUnavailableError"; }
}

export type DeliveryMessage = { idempotencyKey: string; title: string; body: string; link: string | null; recipient: string | null };
export type DeliveryOutcome =
  | { outcome: "accepted"; receiptRef: string | null }
  | { outcome: "rejected"; retryable: boolean; error: string }
  | { outcome: "uncertain"; error: string };
export type DeliveryAdapter = { channel: DeliveryChannel; send(message: DeliveryMessage): Promise<DeliveryOutcome> };

// ---------------------------------------------------------------- types ----

export type Handling = z.infer<typeof handlingSchema>;
export type Care = z.infer<typeof careSchema>;
export type Affair = z.infer<typeof affairSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type ResultSource = z.infer<typeof resultSourceSchema>;
export type AffairResult = z.infer<typeof resultSchema>;
export type Ask = z.infer<typeof askSchema>;
export type Run = z.infer<typeof runSchema>;
export type FollowUp = z.infer<typeof followUpSchema>;
export type GrantScope = z.infer<typeof grantScopeSchema>;
export type Grant = z.infer<typeof grantSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
export type Preference = z.infer<typeof preferenceSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type StewardNotification = z.infer<typeof notificationSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type InboundEvent = z.infer<typeof inboundEventSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Health = z.infer<typeof healthSchema>;
export type Upcoming = z.infer<typeof upcomingSchema>;
export type TodayView = z.infer<typeof todayViewSchema>;
export type AffairDetail = z.infer<typeof affairDetailSchema>;
export type ChatReply = z.infer<typeof chatReplySchema>;
export type PanelEntry = z.infer<typeof panelEntrySchema>;
export type ToolRunView = z.infer<typeof toolRunViewSchema>;
export type ToolDetail = z.infer<typeof toolDetailSchema>;
