/**
 * Personal-steward shared contract, v3 (workspace model). Supervisor-owned.
 * Design: docs/zh/steward-workspace.md. The AI is a Provider (Pi first) that brings its own
 * file editing, shell, web and session tools. Chrona only supplies what a Provider cannot:
 * scheduling, triggers, persistence/history, delivery, external connectors and credentials,
 * approvals, resource limits, file intake and rendering.
 *
 * An affair is a git-versioned directory of Markdown files that the Provider organizes freely.
 */
import { z } from "zod";
import type { ProviderEvents } from "./provider";
export * from "./provider";

const id = z.string().trim().min(1).max(128);
const iso = z.string().datetime({ offset: true }).max(40);
const short = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1);
const hhmm = z.string().regex(/^\d\d:\d\d$/);
/** Path inside an affair directory: relative, no `..`, no leading slash, not under `.git`. */
export const affairPathSchema = z.string().trim().min(1).max(500)
  .refine(p => !p.startsWith("/") && !p.split("/").some(s => s === ".." || s === "" || s === ".git"), "invalid path");

// ---------------------------------------------------------------- vocab ----

export const AFFAIR_STATUSES = ["active", "paused", "done"] as const;
export const RUN_LANES = ["foreground", "background"] as const;
export const RUN_TRIGGERS = ["message", "schedule", "source", "edit", "approval", "retry"] as const;
export const RUN_STATUSES = ["queued", "running", "finished", "failed", "timed_out", "cancelled", "provider_unavailable"] as const;
export const ACTIVITY_ACTORS = ["user", "chrona", "source"] as const;
export const ACTIVITY_KINDS = ["message", "edit", "run", "schedule", "approval", "notification", "source", "status", "note"] as const;
/** `wake` runs the Provider; `remind` sends stored text without a model call.
 * `module` rows are created only by Chrona on module activation/rollback. */
export const SCHEDULE_MODES = ["wake", "remind", "module"] as const;
export const SCHEDULE_STATUSES = ["active", "paused", "done", "cancelled"] as const;
export const APPROVAL_STATUSES = ["open", "approved", "denied", "expired"] as const;
export const APPROVAL_SCOPES = ["once", "affair"] as const;

/** Actions Chrona itself performs for the Provider and therefore gates. Provider-native actions are governed by the Provider runtime/sandbox. */
export const ACTIONS = [
  "notify_user", "schedule", "activate_module", "read_source", "connect_source",
  "send_external_message", "modify_external", "delete_data", "share_third_party", "purchase", "change_credentials",
] as const;
export const GRANT_MODES = ["auto", "notify_after", "preapproved", "ask", "never"] as const;
export const DEFAULT_POLICY = {
  notify_user: "auto", schedule: "auto", activate_module: "ask", read_source: "auto",
  connect_source: "ask", send_external_message: "ask", modify_external: "ask", delete_data: "ask",
  share_third_party: "ask", purchase: "ask", change_credentials: "never",
} as const satisfies Record<(typeof ACTIONS)[number], (typeof GRANT_MODES)[number]>;

export const NOTIFY_LEVELS = ["now", "digest", "web"] as const;
export const NOTIFICATION_STATUSES = ["queued", "sent", "failed", "uncertain", "folded", "suppressed", "acknowledged"] as const;
export const DELIVERY_CHANNELS = ["in_app", "chrona_qqbot"] as const;
export const DEFAULT_NOTIFICATION_SETTINGS = { dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, timezone: "Asia/Shanghai", digestAt: "09:00" } as const;

export const CONNECTOR_KINDS = ["email", "chino_service_health", "local_test"] as const;
export const CONNECTOR_STATUSES = ["active", "paused", "needs_authorization", "failing"] as const;
/** What happens to one inbound item. Rules are written by the Provider (`.chrona/rules.json` in the affair dir) and executed by Chrona without a model. */
export const RULE_ACTIONS = ["wake_now", "batch", "digest_only", "ignore"] as const;
export const INBOUND_STATUSES = ["new", "delivered", "ignored"] as const;

export const RUN_LIMITS = {
  foregroundTimeoutMs: 5 * 60_000, backgroundTimeoutMs: 20 * 60_000,
  maxChronaToolCalls: 60, maxRunsPerAffairPerDay: 24, maxFailures: 3,
  /** Inbound items are delivered to the Provider in batches: wait this long after the first item, then wake once. */
  inboundBatchWindowMs: 5 * 60_000, maxItemsPerBatch: 50,
  jobTimeoutMs: 60_000, jobOutputBytes: 64 * 1024,
} as const;

export type AffairStatus = (typeof AFFAIR_STATUSES)[number];
export type RunLane = (typeof RUN_LANES)[number];
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type ActivityActor = (typeof ACTIVITY_ACTORS)[number];
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];
export type Action = (typeof ACTIONS)[number];
export type GrantMode = (typeof GRANT_MODES)[number];
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];

// ------------------------------------------------------------- schedules ---

export const scheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: iso }).strict(),
  z.object({ kind: z.literal("daily"), time: hhmm }).strict(),
  z.object({ kind: z.literal("weekly"), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), time: hhmm }).strict(),
  z.object({ kind: z.literal("every"), minutes: z.number().int().min(5).max(10080) }).strict(),
]);
export const MODULE_EFFECTS = ["notify_user", "wake_provider", "network"] as const;
export const MODULE_LANGUAGES = ["typescript", "python", "shell"] as const;
const slug = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
const moduleTriggerSchema = z.union([
  z.object({ id: slug, schedule: scheduleRuleSchema }).strict(),
  z.object({ id: slug, inbound: z.object({ connector: id, match: z.object({ from: z.string().max(200).optional(), subject: z.string().max(200).optional() }).strict().default({}) }).strict() }).strict(),
]);
const toolParameterSchema = z.union([
  z.object({ type: z.enum(["string", "number", "boolean"]), description: z.string().max(300).optional() }).strict(),
  z.object({ type: z.literal("string"), enum: z.array(z.string().max(100)).min(1).max(20), description: z.string().max(300).optional() }).strict(),
]);
const moduleToolSchema = z.object({
  name: slug, description: z.string().min(1).max(500),
  parameters: z.object({ type: z.literal("object"), properties: z.record(slug, toolParameterSchema).default({}), required: z.array(slug).default([]) }).strict(),
}).strict();
export const moduleManifestSchema = z.object({
  name: slug,
  entry: z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/),
  triggers: z.array(moduleTriggerSchema).min(1).max(10),
  tools: z.array(moduleToolSchema).max(5).default([]),
  effects: z.array(z.enum(MODULE_EFFECTS)).max(MODULE_EFFECTS.length),
  params: z.record(slug, z.object({ type: z.enum(["number", "string", "boolean"]), value: z.union([z.number(), z.string().max(2000), z.boolean()]) }).strict()).default({}),
  data: z.object({ schema: z.number().int().min(1), migrate: z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/).optional() }).strict().default({ schema: 1 }),
  tests: z.array(z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/)).min(1).max(10),
}).strict().superRefine((manifest, ctx) => {
  for (const [key, param] of Object.entries(manifest.params)) {
    if (typeof param.value !== param.type) ctx.addIssue({ code: "custom", path: ["params", key, "value"], message: "Value must match parameter type" });
  }
  const ids = new Set<string>();
  manifest.triggers.forEach((trigger, index) => {
    if (ids.has(trigger.id)) ctx.addIssue({ code: "custom", path: ["triggers", index, "id"], message: "Trigger ids must be unique" });
    ids.add(trigger.id);
  });
  if (new Set(manifest.effects).size !== manifest.effects.length) ctx.addIssue({ code: "custom", path: ["effects"], message: "Effects must be unique" });
  const names = new Set<string>();
  manifest.tools.forEach((tool, index) => {
    if (names.has(tool.name)) ctx.addIssue({ code: "custom", path: ["tools", index, "name"], message: "Tool names must be unique" });
    names.add(tool.name);
    for (const key of tool.parameters.required) if (!(key in tool.parameters.properties)) ctx.addIssue({ code: "custom", path: ["tools", index, "parameters", "required"], message: `Required parameter ${key} is not in properties` });
  });
});
export type ModuleTrigger = z.infer<typeof moduleTriggerSchema>;
export type ModuleTool = z.infer<typeof moduleToolSchema>;
export const moduleOutputSchema = z.object({
  effects: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("notify_user"), key: z.string().min(1).max(200), level: z.enum(["now", "digest"]), title: text.max(200), body: text.max(4000) }).strict(),
    z.object({ type: z.literal("wake_provider"), key: z.string().min(1).max(200), prompt: text.max(4000) }).strict(),
  ])).max(20).default([]),
  handled: z.boolean().optional(),
  result: z.json().optional().refine(value => value === undefined || new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16_384, "result must serialize to at most 16 KiB"),
}).strict();
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
export type ModuleOutput = z.infer<typeof moduleOutputSchema>;
export type ModuleEffect = (typeof MODULE_EFFECTS)[number];

export const scheduleSchema = z.object({
  id, affairId: id, mode: z.enum(SCHEDULE_MODES), rule: scheduleRuleSchema,
  /** wake: instruction to the future Provider run; remind: the exact text sent to the user. */
  text: z.string().max(4000),
  /** Optional end: after this time the schedule stops. */
  until: iso.nullable(),
  status: z.enum(SCHEDULE_STATUSES), nextAt: iso.nullable(), lastAt: iso.nullable(), lastResult: z.string().max(2000).nullable(),
  /** Short user-facing name shown on pages; `text` of a wake is an internal instruction and is never primary UI. */
  label: z.string().max(80).nullable(),
  createdBy: z.enum(["user", "chrona"]), createdAt: iso,
}).strict();

// ---------------------------------------------------------------- views ----

export const affairSchema = z.object({
  id, title: short, status: z.enum(AFFAIR_STATUSES),
  /** First paragraph of README.md, as written by the Provider. */
  summary: z.string().max(1000),
  /** `label` is the schedule's label, or a reminder's own text; null for an unlabelled wake/module (its text is internal). */
  nextSchedule: z.object({ at: iso, mode: z.enum(SCHEDULE_MODES), label: z.string().max(300).nullable() }).strict().nullable(),
  running: z.boolean(),
  /** Work Chrona is doing or about to do on this affair right now. */
  work: z.object({ state: z.enum(["queued", "running"]), since: iso, label: z.string().max(80).nullable() }).strict().nullable(),
  openApprovals: z.number().int().min(0),
  lastActivityAt: iso, createdAt: iso,
}).strict();

export const fileNodeSchema = z.object({
  path: affairPathSchema, kind: z.enum(["file", "dir"]), size: z.number().int().min(0), updatedAt: iso,
}).strict();
export const fileContentSchema = z.object({
  path: affairPathSchema, content: z.string(), mime: z.string().max(100),
  /** Commit id of the last change to this file; pass it back as `baseRevision` when saving. */
  revision: z.string().max(64).nullable(), updatedAt: iso,
}).strict();
export const revisionSchema = z.object({
  sha: z.string().max(64), author: z.enum(["user", "chrona"]), message: z.string().max(500), at: iso, paths: z.array(z.string()).max(200),
}).strict();

export const runSchema = z.object({
  id, affairId: id.nullable(), lane: z.enum(RUN_LANES), trigger: z.enum(RUN_TRIGGERS), status: z.enum(RUN_STATUSES),
  provider: short, toolCalls: z.array(z.object({ tool: short, at: iso, ok: z.boolean() }).strict()).max(200),
  error: z.string().max(1000).nullable(), startedAt: iso.nullable(), endedAt: iso.nullable(), createdAt: iso,
  /** Short user-facing description (from the schedule that started it); null for conversation runs. */
  label: z.string().max(80).nullable(),
}).strict();

export const attachmentSchema = z.object({ name: short, path: affairPathSchema.nullable(), mime: z.string().max(100), size: z.number().int().min(0) }).strict();
export const messageSchema = z.object({
  id, direction: z.enum(["in", "out"]), channel: z.enum(DELIVERY_CHANNELS), text: z.string().max(8000),
  attachments: z.array(attachmentSchema).max(10), affairId: id.nullable(), quotedMessageId: id.nullable(), at: iso,
}).strict();

export const activitySchema = z.object({
  id, affairId: id, at: iso, actor: z.enum(ACTIVITY_ACTORS), kind: z.enum(ACTIVITY_KINDS), text: z.string().max(4000),
  /** e.g. { commit, paths } for edits, { scheduleId } … */
  data: z.record(z.string(), z.unknown()).nullable(),
}).strict();

export const approvalSchema = z.object({
  id, affairId: id.nullable(), affairTitle: z.string().max(200).nullable(), action: z.enum(ACTIONS),
  title: short, detail: z.string().max(4000),
  /** Exactly what will be done, shown to the user (e.g. the email draft). */
  preview: z.string().max(20_000),
  status: z.enum(APPROVAL_STATUSES), createdAt: iso, resolvedAt: iso.nullable(),
}).strict();

export const grantScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("affair"), affairId: id }).strict(),
  z.object({ kind: z.literal("connector"), connectorId: id }).strict(),
]);
export const grantSchema = z.object({
  id, action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), scope: grantScopeSchema,
  once: z.boolean(), consumedAt: iso.nullable(), expiresAt: iso.nullable(), createdAt: iso, revokedAt: iso.nullable(),
}).strict();
export const policyDecisionSchema = z.object({ action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), grantId: id.nullable(), reason: z.string().max(500) }).strict();

export const PREFERENCE_TOPICS = ["general", "ui"] as const;
export const preferenceSchema = z.object({ id, text: text.max(500), origin: z.enum(["said", "learned"]), topic: z.enum(PREFERENCE_TOPICS), createdAt: iso, lastUsedAt: iso.nullable() }).strict();

export const notificationSchema = z.object({
  id, affairId: id.nullable(), level: z.enum(NOTIFY_LEVELS), channel: z.enum(DELIVERY_CHANNELS), status: z.enum(NOTIFICATION_STATUSES),
  title: short, body: z.string().max(4000), link: z.string().max(2048).nullable(),
  attempts: z.number().int().min(0), lastError: z.string().max(500).nullable(), createdAt: iso, sentAt: iso.nullable(),
  feedback: z.enum(["useful", "not_useful"]).nullable(),
}).strict();

export const ruleSchema = z.object({
  /** All present conditions must match (case-insensitive substring). */
  match: z.object({ from: z.string().max(200).optional(), subject: z.string().max(200).optional(), body: z.string().max(200).optional() }).strict(),
  action: z.enum(RULE_ACTIONS), note: z.string().max(300).default(""),
}).strict();
/** Content of `.chrona/rules.json` in an affair directory (written by the Provider). */
export const rulesFileSchema = z.object({ rules: z.array(ruleSchema).max(200), default: z.enum(RULE_ACTIONS).default("batch") }).strict();

export const connectorSchema = z.object({
  id, kind: z.enum(CONNECTOR_KINDS), label: short, status: z.enum(CONNECTOR_STATUSES),
  /** Affair whose directory receives inbound items (inbox/<date>/<item>.md). */
  affairId: id.nullable(),
  /** Non-secret settings, e.g. email: { address, imapHost, imapPort, smtpHost, smtpPort, folders, sinceDays }. */
  settings: z.record(z.string(), z.unknown()),
  hasCredentials: z.boolean(), canSend: z.boolean(),
  lastSyncAt: iso.nullable(), lastError: z.string().max(500).nullable(), pendingItems: z.number().int().min(0),
  coverageNote: z.string().max(500),
}).strict();
export const inboundItemSchema = z.object({
  id, connectorId: id, externalId: z.string().max(500), from: z.string().max(500), subject: z.string().max(1000),
  receivedAt: iso, path: affairPathSchema.nullable(), status: z.enum(INBOUND_STATUSES), ruleNote: z.string().max(300).nullable(),
}).strict();

export const notificationSettingsSchema = z.object({ dailyCap: z.number().int().min(0).max(50), quietHours: z.object({ start: hhmm, end: hhmm }).strict().nullable(), timezone: z.string().min(1).max(80), digestAt: hhmm }).strict();
export const settingsSchema = z.object({
  notifications: notificationSettingsSchema,
  chat: z.object({ channel: z.enum(DELIVERY_CHANNELS), bound: z.boolean(), sentToday: z.number().int().min(0) }).strict(),
}).strict();
export const healthSchema = z.object({
  provider: z.object({ name: short, available: z.boolean(), sandboxed: z.boolean(), lastError: z.string().max(500).nullable() }).strict(),
  git: z.boolean(), moduleSandbox: z.boolean(),
  queuedRuns: z.number().int().min(0), runningRuns: z.number().int().min(0), failedRunsToday: z.number().int().min(0),
  dueSchedules: z.number().int().min(0), failingConnectors: z.number().int().min(0),
  queuedNotifications: z.number().int().min(0), failedNotifications: z.number().int().min(0), lastTickAt: iso.nullable(),
}).strict();

export const todayViewSchema = z.object({
  generatedAt: iso,
  approvals: z.array(approvalSchema),
  /** Coming up in the next 7 days, soonest first. Pages show `label` (or a reminder's text), never a wake instruction. */
  upcoming: z.array(z.object({ scheduleId: id, affairId: id, affairTitle: short, mode: z.enum(SCHEDULE_MODES), label: z.string().max(300).nullable(), at: iso }).strict()).max(50),
  /** What happened, per affair: affairs with current work or activity in the last 7 days, most recent first. */
  progress: z.array(z.object({
    affair: affairSchema,
    /** Latest messages Chrona sent about this affair (notifications), newest first. */
    updates: z.array(z.object({ title: short, body: z.string().max(4000), at: iso }).strict()).max(3),
    /** Distinct pages changed in the last 7 days. */
    changedPages: z.number().int().min(0),
    /** The Provider's Today card for this affair (json-render spec), if it composed one. */
    card: z.record(z.string(), z.unknown()).nullable(),
  }).strict()).max(50),
  /** Optional page the Provider maintains for today (any affair file it marks via `.chrona/today` pointer). */
  todayPage: z.object({ affairId: id, path: affairPathSchema }).strict().nullable(),
  health: healthSchema,
}).strict();

export const affairDetailSchema = z.object({
  affair: affairSchema, files: z.array(fileNodeSchema).max(2000), schedules: z.array(scheduleSchema),
  approvals: z.array(approvalSchema), activity: z.array(activitySchema), runs: z.array(runSchema), revisions: z.array(revisionSchema),
  /** Recent chat messages linked to this affair, oldest first. */
  messages: z.array(messageSchema).max(100),
  /** Page this affair opens on: the Provider's chosen `*.ui.json` entry, else README.md. */
  entry: affairPathSchema,
}).strict();

// ------------------------------------------------------------- requests ----

export const chatInputSchema = z.object({ text: z.string().max(8000), affairId: id.optional() }).strict();
export const chatReplySchema = z.object({ runId: id.nullable(), messages: z.array(messageSchema) }).strict();
export const createAffairSchema = z.object({ title: short, request: z.string().max(8000).default("") }).strict();
export const updateAffairSchema = z.object({ title: short.optional(), status: z.enum(AFFAIR_STATUSES).optional() }).strict();
export const saveFileSchema = z.object({ path: affairPathSchema, content: z.string().max(2_000_000), baseRevision: z.string().max(64).nullable() }).strict();
/** Usage signal from a composed page; `feedback` also reaches the Provider as a chat message about this affair. */
export const uiEventSchema = z.object({
  path: affairPathSchema, kind: z.enum(["open", "action", "toggle", "feedback"]),
  name: z.string().max(100).optional(), text: z.string().max(2000).optional(),
}).strict();
export const toggleCheckboxSchema = z.object({ path: affairPathSchema, line: z.number().int().min(1), checked: z.boolean(), baseRevision: z.string().max(64).nullable() }).strict();
export const panelEntrySchema = z.object({ dataPath: affairPathSchema, values: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.null()])) }).strict();
export const createScheduleSchema = z.object({ mode: z.enum(["wake", "remind"]), rule: scheduleRuleSchema, text: z.string().max(4000), label: z.string().trim().min(1).max(80).optional(), until: iso.optional() }).strict();
export const updateScheduleSchema = z.object({ status: z.enum(["active", "paused", "cancelled"]) }).strict();
export const resolveApprovalSchema = z.object({ decision: z.enum(["approve", "deny"]), scope: z.enum(APPROVAL_SCOPES).default("once") }).strict();
export const createGrantSchema = z.object({ action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), scope: grantScopeSchema, expiresAt: iso.optional() }).strict();
export const createPreferenceSchema = z.object({ text: text.max(500) }).strict();
export const updateSettingsSchema = z.object({ notifications: notificationSettingsSchema.partial() }).strict();
export const createConnectorSchema = z.object({
  kind: z.enum(CONNECTOR_KINDS), label: short, affairId: id.optional(), settings: z.record(z.string(), z.unknown()).default({}),
  /** Write-only secret (e.g. { password } or app password). Stored by Chrona outside the database, never returned. */
  secret: z.record(z.string(), z.string().max(2000)).optional(),
}).strict();
export const updateConnectorSchema = createConnectorSchema.partial().extend({ status: z.enum(["active", "paused"]).optional() }).strict();

// ------------------------------------------------------------ HTTP map -----
/**
 * All under /api/steward, owner-only, `?workspaceId=` on every request. Lists return `{ items: T[] }`.
 *   GET  /today                                   -> TodayView
 *   POST /chat (ChatInput)                        -> ChatReply (waits for the foreground run's replies, up to ~2 min)
 *   GET  /chat/messages?limit=                    -> {items: Message[]}
 *   GET  /affairs?status= | POST (CreateAffair)   -> {items: Affair[]} | Affair
 *   GET  /affairs/:id | PATCH (UpdateAffair)      -> AffairDetail | Affair
 *   GET  /affairs/:id/file?path=                  -> FileContent
 *   PUT  /affairs/:id/file (SaveFile)             -> FileContent (409 on stale baseRevision; commits as user; wakes the Provider)
 *   POST /affairs/:id/checkbox (ToggleCheckbox)   -> FileContent
 *   POST /affairs/:id/ui-event (UiEvent)         -> {ok: true} (feedback is also sent to the Provider)
 *   POST /affairs/:id/panel-entry (PanelEntry)    -> FileContent of the data file
 *   POST /affairs/:id/upload (multipart file, dir)-> FileNode
 *   GET  /affairs/:id/raw?path=                   -> file bytes (download)
 *   GET  /affairs/:id/revisions?path=             -> {items: Revision[]}
 *   GET  /affairs/:id/revisions/:sha/diff         -> { diff: string }
 *   POST /affairs/:id/revisions/:sha/revert       -> Revision
 *   GET  /affairs/:id/schedules | POST (CreateSchedule) ; PATCH /schedules/:id (UpdateSchedule)
 *   GET  /approvals?status= ; POST /approvals/:id/resolve (ResolveApproval) -> Approval
 *   GET  /settings | PATCH ; GET /grants | POST ; POST /grants/:id/revoke ; GET /preferences | POST | DELETE /preferences/:id
 *   GET  /notifications ; POST /notifications/:id/feedback ; POST /notifications/:id/retry
 *   GET  /connectors | POST ; PATCH /connectors/:id ; POST /connectors/:id/test ; POST /connectors/:id/sync ; GET /connectors/:id/items
 *   GET  /provider/runs?affairId=                 -> {items: ProviderRunView[]} (recent runs, owner-scoped)
 *   POST /provider/interactions/:id/answer        -> {ok: true} (ProviderAnswer, no grants/replay)
 *   POST /provider/runs/:id/cancel                -> {ok: true} (no automatic retry)
 *   GET  /health
 */
/** Short codes (e.g. QQ binding codes): no 0/O/1/I/L. */
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const STEWARD_API_BASE = "/api/steward";

// ---------------------------------------------------------- Chrona tools ---
/**
 * Tools Chrona exposes to the Provider (Pi: through the Chrona extension bridge; MCP later).
 * Everything else (files, shell, web) is the Provider's own.
 */
export const chronaToolInputSchemas = {
  /** Reply to the user in the current conversation (foreground runs). May be called several times. */
  chrona_reply: z.object({ text: text.max(8000), files: z.array(affairPathSchema).max(10).default([]) }).strict(),
  /** Proactive message outside a conversation (background runs). Subject to the notification budget. */
  chrona_notify: z.object({ level: z.enum(["now", "digest"]), title: text.max(200), body: text.max(4000), file: affairPathSchema.optional() }).strict(),
  chrona_schedule: createScheduleSchema.extend({ affairId: id.optional(), label: z.string().trim().min(1).max(80).describe("Short user-facing name shown on the affair page, in the user's language, e.g. 准备第2天材料") }),
  chrona_propose: z.object({
    affairId: id.optional(), dir: affairPathSchema,
    intent: z.object({ changes: z.array(text.max(500)).min(1).max(20), preserves: z.array(text.max(500)).max(20).default([]) }).strict(),
  }).strict().describe('Submit module dir → building → hash-bound approval or repair wake. module.json {name,entry,triggers,effects,params?:{k:{type,value}},data?:{schema,migrate?},tools?,tests}. trigger {id,schedule}|{id,inbound:{connector,match?:{from?,subject?}}}; tool {name,description,parameters:{type:"object",properties,required}}. name/ids/keys [a-z][a-z0-9-]{1,40} (titles go in notify text); files x.ts|py|sh; schedule: chrona_schedule rule, every>=5min; effects notify_user|wake_provider|network; params number|string|boolean. Invalid: rejected+report.errors. stdin {trigger:{id,kind:schedule|inbound|tool,firedAt,item?,args?},now,params}; stdout {effects:[{type:"notify_user",key,level,title,body}|{type:"wake_provider",key,prompt}],handled?,result?} <=20/64KiB. /module ro, /data rw; tests offline, exit 0. Review runs once on a data copy; schema upgrade with data needs migrate (stdin {migrate:{from,to},now}). In authorized affairs, updates with no new effects, no migration and identical simulation auto-activate.'),
  chrona_modules: z.object({ affairId: id.optional() }).strict().describe("List modules, versions, approval status and recent runs; defaults to this affair, or all workspace modules at the root."),
  chrona_module_checkout: z.object({ moduleId: id, hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), dir: affairPathSchema }).strict().describe("Copy module files into an empty affair directory for editing; hash defaults to the active version."),
  chrona_module_rollback: z.object({ moduleId: id, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().describe('Roll back to a previously approved module hash. May return { status: "pending_approval", approvalId } when restoring a data snapshot needs user approval. Accepts no force/restore flag.'),
  chrona_schedules: z.object({ affairId: id.optional() }).strict(),
  chrona_schedule_cancel: z.object({ scheduleId: id }).strict(),
  chrona_affairs: z.object({ status: z.enum(AFFAIR_STATUSES).optional() }).strict(),
  /** Create an affair (directory) and return its path; later runs for it start inside that directory. */
  chrona_affair_create: z.object({ title: text.max(200), readme: z.string().max(20_000).default("") }).strict(),
  chrona_affair_update: z.object({ affairId: id, title: text.max(200).optional(), status: z.enum(AFFAIR_STATUSES).optional() }).strict(),
  /** Mark which affair this conversation is about, so later messages and the web view connect to it. */
  chrona_focus: z.object({ affairId: id }).strict(),
  chrona_request_approval: z.object({ action: z.enum(ACTIONS), title: text.max(200), detail: text.max(4000), preview: text.max(20_000) }).strict(),
  chrona_send_email: z.object({ connectorId: id, to: z.array(z.string().email()).min(1).max(20), subject: text.max(500), body: text.max(50_000), inReplyTo: z.string().max(500).optional() }).strict(),
  chrona_inbound: z.object({ connectorId: id.optional(), status: z.enum(INBOUND_STATUSES).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  chrona_remember: z.object({ text: text.max(500), topic: z.enum(PREFERENCE_TOPICS).default("general").describe("ui for how the user likes pages laid out") }).strict(),
  chrona_ui_guide: z.object({ affairId: id.optional() }).strict(),
  chrona_ui_set: z.object({
    affairId: id.optional(),
    path: affairPathSchema.refine(path => path.endsWith(".ui.json"), "Page files end with .ui.json"),
    spec: z.union([z.record(z.string(), z.unknown()), z.string().max(200_000)]).describe("json-render spec {root, elements, state}, or its JSONL patch stream"),
    role: z.enum(["page", "entry", "card"]).default("page").describe("entry: the page this affair opens on; card: this affair's card on Today"),
  }).strict(),
  chrona_forget: z.object({ preferenceId: id }).strict(),
  chrona_preferences: z.object({}).strict(),
} as const;
export const CHRONA_TOOLS = Object.keys(chronaToolInputSchemas) as (keyof typeof chronaToolInputSchemas)[];

// ---------------------------------------------------------------- ports ----

export type SourceItem = { externalId: string; from: string; subject: string; body: string; receivedAt: string; url: string | null; attachments?: { name: string; mime: string; bytes: Uint8Array }[] };
export type ConnectorAdapter = {
  kind: ConnectorKind; coverageNote: string;
  test(settings: Record<string, unknown>, secret: Record<string, string> | null): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Throws on transport failure; the caller records it and retries later. */
  poll(input: { settings: Record<string, unknown>; secret: Record<string, string> | null; cursor: string | null }): Promise<{ items: SourceItem[]; cursor: string | null }>;
  send?(input: { settings: Record<string, unknown>; secret: Record<string, string> | null; to: string[]; subject: string; body: string; inReplyTo?: string }): Promise<{ ok: true; messageId: string | null } | { ok: false; retryable: boolean; error: string }>;
};
export type DeliveryMessage = { idempotencyKey: string; title: string; body: string; link: string | null; recipient: string | null; files?: { name: string; path: string }[] };
export type DeliveryOutcome = { outcome: "accepted"; receiptRef: string | null } | { outcome: "rejected"; retryable: boolean; error: string } | { outcome: "uncertain"; error: string };
export type DeliveryAdapter = { channel: DeliveryChannel; send(message: DeliveryMessage): Promise<DeliveryOutcome> };

/** Provider adapter (Pi first). Chrona owns when and where a run happens; the Provider owns how it works. */
export type ProviderRunInput = {
  runId: string; token: string; lane: RunLane; cwd: string; sessionDir: string; sessionId: string | null;
  prompt: string; images?: { mime: string; base64: string }[]; deadline: Date;
  /** Safe summaries and explicit, run-bound UI requests; never raw thinking or tool payloads. */
  events?: ProviderEvents;
};
export type ProviderAdapter = {
  name: string;
  health(): Promise<{ available: boolean; sandboxed: boolean; error: string | null }>;
  /** Starts a run; returns a handle that can receive messages while running. */
  start(input: ProviderRunInput): { inject(message: string, images?: { mime: string; base64: string }[]): Promise<void>; abort(): Promise<void>; done: Promise<{ outcome: "finished" | "failed" | "timed_out" | "unavailable"; sessionId: string | null; error: string | null }> };
};

// ---------------------------------------------------------------- types ----

export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Affair = z.infer<typeof affairSchema>;
export type FileNode = z.infer<typeof fileNodeSchema>;
export type FileContent = z.infer<typeof fileContentSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type Run = z.infer<typeof runSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type GrantScope = z.infer<typeof grantScopeSchema>;
export type Grant = z.infer<typeof grantSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
export type Preference = z.infer<typeof preferenceSchema>;
export type StewardNotification = z.infer<typeof notificationSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type RulesFile = z.infer<typeof rulesFileSchema>;
export type Connector = z.infer<typeof connectorSchema>;
export type InboundItem = z.infer<typeof inboundItemSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Health = z.infer<typeof healthSchema>;
export type TodayView = z.infer<typeof todayViewSchema>;
export type AffairDetail = z.infer<typeof affairDetailSchema>;
export type UiEvent = z.infer<typeof uiEventSchema>;
export type ChatReply = z.infer<typeof chatReplySchema>;
