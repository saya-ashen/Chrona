/**
 * Chrona shared contract, platform v2. Supervisor-owned.
 * Design: docs/zh/platform-v2.md. Chrona's features are modules (apps); each module may own a
 * content area the user and the Provider read and edit. Conversations with the Provider are
 * sessions, keyed by the entry that owns them. There are no affairs.
 */
import { z } from "zod";
import type { ProviderEvents } from "./provider";
export * from "./provider";

const id = z.string().trim().min(1).max(128);
const iso = z.string().datetime({ offset: true }).max(40);
const short = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1);
const hhmm = z.string().regex(/^\d\d:\d\d$/);
/** Relative path inside a content area or session directory: no `..`, no leading slash, not under `.git`. */
export const relativePathSchema = z.string().trim().min(1).max(500)
  .refine(p => !p.startsWith("/") && !p.split("/").some(s => s === ".." || s === "" || s === ".git"), "invalid path");

// ---------------------------------------------------------------- vocab ----

export const SESSION_SOURCES = ["web", "qq", "mcp", "rescue", "wake", "module"] as const;
export const SESSION_STATUSES = ["active", "ended"] as const;
export const RUN_LANES = ["foreground", "background", "build"] as const;
export const RUN_TRIGGERS = ["message", "schedule", "source", "edit", "approval", "retry", "build"] as const;
export const RUN_STATUSES = ["queued", "running", "finished", "failed", "timed_out", "cancelled", "provider_unavailable"] as const;
/** `wake` runs the Provider in a fresh session and reports back to the session that created it;
 * `remind` sends stored text without a model call (moves into the built-in remind module in v2-3);
 * `module` rows are created only by Chrona on module activation/rollback. */
export const SCHEDULE_MODES = ["wake", "remind", "module"] as const;
export const SCHEDULE_STATUSES = ["active", "paused", "done", "cancelled"] as const;
export const APPROVAL_STATUSES = ["open", "approved", "denied", "expired"] as const;
/** `always` turns the decision into a grant: scoped to the module the approval is about, else global. */
export const APPROVAL_SCOPES = ["once", "always"] as const;

/** Actions Chrona itself performs for the Provider and therefore gates. Provider-native actions are governed by the Provider runtime/sandbox. */
export const ACTIONS = [
  "notify_user", "schedule", "activate_module", "read_source", "connect_source",
  "send_external_message", "modify_external", "delete_data", "share_third_party", "purchase", "change_credentials", "access_host_path",
] as const;
export const GRANT_MODES = ["auto", "notify_after", "preapproved", "ask", "never"] as const;
export const DEFAULT_POLICY = {
  notify_user: "auto", schedule: "auto", activate_module: "ask", read_source: "auto",
  connect_source: "ask", send_external_message: "ask", modify_external: "ask", delete_data: "ask",
  share_third_party: "ask", purchase: "ask", change_credentials: "never", access_host_path: "ask",
} as const satisfies Record<(typeof ACTIONS)[number], (typeof GRANT_MODES)[number]>;

export const NOTIFY_LEVELS = ["now", "digest", "web"] as const;
export const NOTIFICATION_STATUSES = ["queued", "sent", "failed", "uncertain", "folded", "suppressed", "acknowledged"] as const;
export const DELIVERY_CHANNELS = ["in_app", "chrona_qqbot"] as const;
export const DEFAULT_NOTIFICATION_SETTINGS = { dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, timezone: "Asia/Shanghai", digestAt: "09:00" } as const;

export const CONNECTOR_KINDS = ["email", "chino_service_health", "local_test"] as const;
export const CONNECTOR_STATUSES = ["active", "paused", "needs_authorization", "failing"] as const;
/** What happens to one inbound item. Rules live in the `files` content area at `inbox/<connectorId>/rules.json` (until sources become modules in v2-5) and run without a model. */
export const RULE_ACTIONS = ["wake_now", "batch", "digest_only", "ignore"] as const;
export const INBOUND_STATUSES = ["new", "delivered", "ignored"] as const;

export const RUN_LIMITS = {
  foregroundTimeoutMs: 5 * 60_000, backgroundTimeoutMs: 20 * 60_000,
  maxChronaToolCalls: 60, maxRunsPerSessionPerDay: 24, maxRunsPerDay: 200, maxFailures: 3,
  /** Inbound items are delivered to the Provider in batches: wait this long after the first item, then wake once. */
  inboundBatchWindowMs: 5 * 60_000, maxItemsPerBatch: 50,
  jobTimeoutMs: 60_000, jobOutputBytes: 64 * 1024,
  /** Intent-proposal build lane (docs/zh/platform-p4-build-spec.md §5); tentative budget. */
  buildTimeoutMs: 10 * 60_000, maxBuildAttempts: 3, maxBuildRunsPerDay: 6, maxBuildSubmissionsPerRun: 3,
} as const;

export type SessionSource = (typeof SESSION_SOURCES)[number];
export type RunLane = (typeof RUN_LANES)[number];
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
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
  /** What the module's toolset offers; callers find its tools by this, like an MCP server's description. */
  description: z.string().min(1).max(300).optional(),
  entry: z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/),
  triggers: z.array(moduleTriggerSchema).max(10),
  tools: z.array(moduleToolSchema).max(10).default([]),
  /** Run from activation and restart on exit (long connections); otherwise started per event and stopped when idle. */
  keepAlive: z.boolean().default(false),
  /** Owns a content area (pages, panels, files) the user and the Provider can read and edit; the module sees it at /content. */
  content: z.boolean().default(false),
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
  if (!manifest.triggers.length && !manifest.tools.length && !manifest.keepAlive) ctx.addIssue({ code: "custom", path: ["triggers"], message: "A module needs a trigger, a tool or keepAlive" });
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
/**
 * v2 module channel (`/chrona/chrona.sock`, one JSON object per line, both directions).
 * Chrona → module: an event `{ id, event }`; the module answers `{ id, result }` or `{ id, error }`.
 * Module → Chrona: a call `{ id, method, params }`; Chrona answers `{ id, result }` or `{ id, error }`.
 * Events of one module are delivered one at a time; calls made meanwhile belong to that event.
 */
const channelId = z.string().min(1).max(64);
const moduleResultSchema = z.json().optional().refine(value => value === undefined || new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16_384, "result must serialize to at most 16 KiB");
export const moduleEventSchema = z.object({
  trigger: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("schedule"), id: slug, firedAt: iso }).strict(),
    z.object({ kind: z.literal("inbound"), id: slug, firedAt: iso, item: z.object({ externalId: z.string(), from: z.string(), subject: z.string(), receivedAt: iso, body: z.string() }).strict() }).strict(),
    z.object({ kind: z.literal("tool"), id: slug, firedAt: iso, args: z.record(z.string(), z.unknown()) }).strict(),
    /** The user or the Provider changed files in this module's content area (`id` is always "content"). */
    z.object({ kind: z.literal("content_edit"), id: z.literal("content"), firedAt: iso, paths: z.array(relativePathSchema).min(1).max(200), by: z.enum(["user", "provider"]) }).strict(),
  ]),
  now: iso,
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
}).strict();
export const moduleEventMessageSchema = z.object({ id: channelId, event: moduleEventSchema }).strict();
/** `handled: false` hands an inbound item back to the Provider; `result` answers a tool call. */
export const moduleEventReplySchema = z.object({ id: channelId, result: z.object({ handled: z.boolean().optional(), result: moduleResultSchema }).strict().default({}) }).strict()
  .or(z.object({ id: channelId, error: z.string().max(2000) }).strict());
/** Kernel methods and the capability each needs. */
export const MODULE_METHODS = { notify: "notify_user", wakeProvider: "wake_provider" } as const satisfies Record<string, (typeof MODULE_EFFECTS)[number]>;
export const moduleCallSchema = z.discriminatedUnion("method", [
  z.object({ id: channelId, method: z.literal("notify"), params: z.object({ key: z.string().min(1).max(200), level: z.enum(["now", "digest"]), title: text.max(200), body: text.max(4000) }).strict() }).strict(),
  z.object({ id: channelId, method: z.literal("wakeProvider"), params: z.object({ key: z.string().min(1).max(200), prompt: text.max(4000) }).strict() }).strict(),
]);
export const MODULE_CALL_ERRORS = ["undeclared", "invalid", "internal"] as const;
export const moduleCallReplySchema = z.object({ id: channelId, result: z.object({ status: z.enum(["executed", "duplicate"]) }).strict() }).strict()
  .or(z.object({ id: channelId, error: z.object({ code: z.enum(MODULE_CALL_ERRORS), message: z.string().max(500) }).strict() }).strict());
export type ModuleEvent = z.infer<typeof moduleEventSchema>;
export type ModuleCall = z.infer<typeof moduleCallSchema>;
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
export type ModuleEffect = (typeof MODULE_EFFECTS)[number];

export const scheduleSchema = z.object({
  id, mode: z.enum(SCHEDULE_MODES), rule: scheduleRuleSchema,
  /** wake: self-contained instruction for a fresh Provider session; remind: the exact text sent to the user. */
  text: z.string().max(4000),
  /** wake: the session the result is posted back to. */
  originSessionId: id.nullable(),
  moduleId: id.nullable(),
  /** Optional end: after this time the schedule stops. */
  until: iso.nullable(),
  status: z.enum(SCHEDULE_STATUSES), nextAt: iso.nullable(), lastAt: iso.nullable(), lastResult: z.string().max(2000).nullable(),
  /** Short user-facing name shown on pages; `text` of a wake is an internal instruction and is never primary UI. */
  label: z.string().max(80).nullable(),
  createdBy: z.enum(["user", "chrona"]), createdAt: iso,
}).strict();

// ---------------------------------------------------------------- views ----

/** A conversation with the Provider. Entries decide keys (`qq:dm`, `web:<id>`, `rescue`); `wake`/`module` sessions are created per run. */
export const sessionSchema = z.object({
  id, key: z.string().max(200), source: z.enum(SESSION_SOURCES), title: z.string().max(200).nullable(),
  status: z.enum(SESSION_STATUSES), moduleId: id.nullable(), originSessionId: id.nullable(),
  /** Module names whose content areas Provider runs in this session may write. */
  focus: z.array(slug).max(10),
  running: z.boolean(), lastActivityAt: iso, createdAt: iso, endedAt: iso.nullable(),
}).strict();

/** A module as an app: identity, state and whether it has a content area (its pages). */
export const appSchema = z.object({
  id, name: slug, description: z.string().max(300).nullable(), status: z.enum(["active", "paused"]),
  builtin: z.boolean(), content: z.boolean(), activeHash: z.string().max(64).nullable(),
  /** Content page the app opens on (`.chrona/entry`, else README.md); null without content. */
  entry: relativePathSchema.nullable(),
}).strict();

export const fileNodeSchema = z.object({
  path: relativePathSchema, kind: z.enum(["file", "dir"]), size: z.number().int().min(0), updatedAt: iso,
}).strict();
export const fileContentSchema = z.object({
  path: relativePathSchema, content: z.string(), mime: z.string().max(100),
  /** Content hash of this file; pass it back as `baseRevision` when saving. */
  revision: z.string().max(64).nullable(), updatedAt: iso,
}).strict();

export const runSchema = z.object({
  id, sessionId: id.nullable(), lane: z.enum(RUN_LANES), trigger: z.enum(RUN_TRIGGERS), status: z.enum(RUN_STATUSES),
  provider: short, toolCalls: z.array(z.object({ tool: short, at: iso, ok: z.boolean() }).strict()).max(200),
  error: z.string().max(1000).nullable(), startedAt: iso.nullable(), endedAt: iso.nullable(), createdAt: iso,
  /** Short user-facing description (from the schedule or module that started it); null for conversation runs. */
  label: z.string().max(80).nullable(),
}).strict();

/** A content file reference: `<module>/<path>` (what the Provider sees under /content). */
export const contentRefSchema = z.string().trim().min(3).max(542).regex(/^[a-z][a-z0-9-]{1,40}\//, "starts with a module name")
  .refine(ref => relativePathSchema.safeParse(ref.slice(ref.indexOf("/") + 1)).success, "invalid path");
export const attachmentSchema = z.object({ name: short, ref: contentRefSchema.nullable(), mime: z.string().max(100), size: z.number().int().min(0) }).strict();
export const messageSchema = z.object({
  id, sessionId: id, direction: z.enum(["in", "out"]), channel: z.enum(DELIVERY_CHANNELS), text: z.string().max(8000),
  attachments: z.array(attachmentSchema).max(10), quotedMessageId: id.nullable(), at: iso,
}).strict();

export const approvalSchema = z.object({
  id, action: z.enum(ACTIONS), moduleId: id.nullable(),
  title: short, detail: z.string().max(4000),
  /** Exactly what will be done, shown to the user (e.g. the email draft). */
  preview: z.string().max(20_000),
  status: z.enum(APPROVAL_STATUSES), createdAt: iso, resolvedAt: iso.nullable(),
}).strict();

export const grantScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("module"), moduleId: id }).strict(),
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
  id, moduleId: id.nullable(), sessionId: id.nullable(), level: z.enum(NOTIFY_LEVELS), channel: z.enum(DELIVERY_CHANNELS), status: z.enum(NOTIFICATION_STATUSES),
  title: short, body: z.string().max(4000), link: z.string().max(2048).nullable(),
  attempts: z.number().int().min(0), lastError: z.string().max(500).nullable(), createdAt: iso, sentAt: iso.nullable(),
  feedback: z.enum(["useful", "not_useful"]).nullable(),
}).strict();

export const ruleSchema = z.object({
  /** All present conditions must match (case-insensitive substring). */
  match: z.object({ from: z.string().max(200).optional(), subject: z.string().max(200).optional(), body: z.string().max(200).optional() }).strict(),
  action: z.enum(RULE_ACTIONS), note: z.string().max(300).default(""),
}).strict();
/** Content of `inbox/<connectorId>/rules.json` in the `files` content area (written by the Provider). */
export const rulesFileSchema = z.object({ rules: z.array(ruleSchema).max(200), default: z.enum(RULE_ACTIONS).default("batch") }).strict();

export const connectorSchema = z.object({
  id, kind: z.enum(CONNECTOR_KINDS), label: short, status: z.enum(CONNECTOR_STATUSES),
  /** Non-secret settings, e.g. email: { address, imapHost, imapPort, smtpHost, smtpPort, folders, sinceDays }. */
  settings: z.record(z.string(), z.unknown()),
  hasCredentials: z.boolean(), canSend: z.boolean(),
  lastSyncAt: iso.nullable(), lastError: z.string().max(500).nullable(), pendingItems: z.number().int().min(0),
  coverageNote: z.string().max(500),
}).strict();
export const inboundItemSchema = z.object({
  id, connectorId: id, externalId: z.string().max(500), from: z.string().max(500), subject: z.string().max(1000),
  /** Item file in the `files` content area (`files/inbox/<connectorId>/…`). */
  receivedAt: iso, ref: contentRefSchema.nullable(), status: z.enum(INBOUND_STATUSES), ruleNote: z.string().max(300).nullable(),
}).strict();

export const notificationSettingsSchema = z.object({ dailyCap: z.number().int().min(0).max(50), quietHours: z.object({ start: hhmm, end: hhmm }).strict().nullable(), timezone: z.string().min(1).max(80), digestAt: hhmm }).strict();
export const settingsSchema = z.object({
  notifications: notificationSettingsSchema,
  chat: z.object({ channel: z.enum(DELIVERY_CHANNELS), bound: z.boolean(), sentToday: z.number().int().min(0) }).strict(),
}).strict();
export const healthSchema = z.object({
  provider: z.object({ name: short, available: z.boolean(), sandboxed: z.boolean(), lastError: z.string().max(500).nullable() }).strict(),
  moduleSandbox: z.boolean(),
  queuedRuns: z.number().int().min(0), runningRuns: z.number().int().min(0), failedRunsToday: z.number().int().min(0),
  dueSchedules: z.number().int().min(0), failingConnectors: z.number().int().min(0),
  queuedNotifications: z.number().int().min(0), failedNotifications: z.number().int().min(0), lastTickAt: iso.nullable(),
}).strict();

export const todayViewSchema = z.object({
  generatedAt: iso,
  approvals: z.array(approvalSchema),
  /** Coming up in the next 7 days, soonest first. Pages show `label` (or a reminder's text), never a wake instruction. */
  upcoming: z.array(z.object({ scheduleId: id, mode: z.enum(SCHEDULE_MODES), label: z.string().max(300).nullable(), at: iso }).strict()).max(50),
  /** Recent notifications, newest first. */
  updates: z.array(notificationSchema).max(20),
  apps: z.array(appSchema).max(200),
  /** Recent user-facing sessions (web, qq, mcp), most recent first. */
  sessions: z.array(sessionSchema).max(20),
  health: healthSchema,
}).strict();

// ------------------------------------------------------------- requests ----

/** Without `sessionId`, the active session for `key` is used (created if missing); without both, a new web session. */
export const chatInputSchema = z.object({ text: z.string().max(8000), sessionId: id.optional(), key: z.string().max(200).optional() }).strict();
export const chatReplySchema = z.object({ runId: id.nullable(), sessionId: id, messages: z.array(messageSchema) }).strict();
/** Ends the active session for `key` (QQ `/new`); the next message starts a new one. */
export const newSessionSchema = z.object({ key: z.string().min(1).max(200) }).strict();
export const updateSessionSchema = z.object({ title: short.optional(), status: z.literal("ended").optional() }).strict();
export const saveFileSchema = z.object({ path: relativePathSchema, content: z.string().max(2_000_000), baseRevision: z.string().max(64).nullable() }).strict();
/** Usage signal from a composed page; `feedback` also reaches the Provider in the user's web session. */
export const uiEventSchema = z.object({
  path: relativePathSchema, kind: z.enum(["open", "action", "toggle", "feedback"]),
  name: z.string().max(100).optional(), text: z.string().max(2000).optional(),
}).strict();
export const toggleCheckboxSchema = z.object({ path: relativePathSchema, line: z.number().int().min(1), checked: z.boolean(), baseRevision: z.string().max(64).nullable() }).strict();
export const panelEntrySchema = z.object({ dataPath: relativePathSchema, values: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.null()])) }).strict();
export const createScheduleSchema = z.object({ mode: z.enum(["wake", "remind"]), rule: scheduleRuleSchema, text: z.string().max(4000), label: z.string().trim().min(1).max(80).optional(), until: iso.optional() }).strict();
export const updateScheduleSchema = z.object({ status: z.enum(["active", "paused", "cancelled"]) }).strict();
export const resolveApprovalSchema = z.object({ decision: z.enum(["approve", "deny"]), scope: z.enum(APPROVAL_SCOPES).default("once") }).strict();
export const createGrantSchema = z.object({ action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), scope: grantScopeSchema, expiresAt: iso.optional() }).strict();
export const createPreferenceSchema = z.object({ text: text.max(500) }).strict();
export const updateSettingsSchema = z.object({ notifications: notificationSettingsSchema.partial() }).strict();
export const createConnectorSchema = z.object({
  kind: z.enum(CONNECTOR_KINDS), label: short, settings: z.record(z.string(), z.unknown()).default({}),
  /** Write-only secret (e.g. { password } or app password). Stored by Chrona outside the database, never returned. */
  secret: z.record(z.string(), z.string().max(2000)).optional(),
}).strict();
export const updateConnectorSchema = createConnectorSchema.partial().extend({ status: z.enum(["active", "paused"]).optional() }).strict();

// ------------------------------------------------------------ HTTP map -----
/**
 * All under /api/steward, owner-only, `?workspaceId=` on every request. Lists return `{ items: T[] }`.
 *   GET  /today                                   -> TodayView
 *   POST /chat (ChatInput)                        -> ChatReply (waits for the foreground run's replies, up to ~2 min)
 *   GET  /sessions?source=&status= | POST /sessions/new (NewSession) -> {items: Session[]} | Session
 *   GET  /sessions/:id | PATCH (UpdateSession)    -> Session
 *   GET  /sessions/:id/messages?limit=            -> {items: Message[]}
 *   GET  /apps                                    -> {items: App[]}
 *   GET  /apps/:id/tree                           -> {items: FileNode[]} (content area)
 *   GET  /apps/:id/file?path=                     -> FileContent
 *   PUT  /apps/:id/file (SaveFile)                -> FileContent (409 on stale baseRevision; sends content_edit)
 *   POST /apps/:id/checkbox (ToggleCheckbox)      -> FileContent
 *   POST /apps/:id/ui-event (UiEvent)             -> {ok: true}
 *   POST /apps/:id/panel-entry (PanelEntry)       -> FileContent of the data file
 *   POST /apps/:id/upload (multipart file, dir)   -> FileNode
 *   GET  /apps/:id/raw?path=                      -> file bytes (download)
 *   GET  /schedules | POST (CreateSchedule, wake origin = ?sessionId) ; PATCH /schedules/:id (UpdateSchedule)
 *   GET  /approvals?status= ; POST /approvals/:id/resolve (ResolveApproval) -> Approval
 *   GET  /settings | PATCH ; GET /grants | POST ; POST /grants/:id/revoke ; GET /preferences | POST | DELETE /preferences/:id
 *   GET  /notifications ; POST /notifications/:id/feedback ; POST /notifications/:id/retry
 *   GET  /connectors | POST ; PATCH /connectors/:id ; POST /connectors/:id/test ; POST /connectors/:id/sync ; GET /connectors/:id/items
 *   GET  /provider/runs?sessionId=                -> {items: ProviderRunView[]} (recent runs, owner-scoped)
 *   POST /provider/interactions/:id/answer        -> {ok: true} (ProviderAnswer, no grants/replay)
 *   POST /provider/runs/:id/cancel                -> {ok: true} (no automatic retry)
 *   GET  /health
 * There are no HTTP module routes: activation and rollback go through approvals and Provider tools; module
 * versions and module tools are reached through the owner MCP (`chrona_modules`, `m_*` tools).
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
  chrona_reply: z.object({ text: text.max(8000), files: z.array(contentRefSchema).max(10).default([]).describe("Content files to attach, as <module>/<path> (see /content)") }).strict(),
  /** Proactive message outside a conversation (background runs). Subject to the notification budget. */
  chrona_notify: z.object({ level: z.enum(["now", "digest"]), title: text.max(200), body: text.max(4000), file: contentRefSchema.optional() }).strict(),
  chrona_schedule: createScheduleSchema.extend({ label: z.string().trim().min(1).max(80).describe("Short user-facing name shown on pages, in the user's language, e.g. 准备第2天材料") })
    .describe("wake: at the time, a fresh session runs `text` as its whole instruction (write it self-contained: goal, files under /content, what to report) and posts the result back to this session. remind: sends `text` to the user without a model."),
  chrona_propose: z.object({
    dir: relativePathSchema.optional().describe("Module directory relative to the session directory"),
    request: z.object({ name: slug, goal: text.max(4000), examples: z.array(text.max(1000)).max(10).default([]) }).strict().optional(),
    intent: z.object({ changes: z.array(text.max(500)).min(1).max(20), preserves: z.array(text.max(500)).max(20).default([]) }).strict(),
  }).strict().refine(input => (input.dir === undefined) !== (input.request === undefined), "Pass exactly one of dir or request").describe('Or pass request {name,goal,examples} instead of dir: a budgeted build run writes it. Submit module dir → building → hash-bound approval or repair wake. module.json {name,description?,entry,triggers,keepAlive?,content?,effects,params?:{k:{type,value}},data?:{schema,migrate?},tools?,tests}. trigger {id,schedule}|{id,inbound:{connector,match?:{from?,subject?}}}; tool {name,description,parameters:{type:"object",properties,required}}. name/ids/keys [a-z][a-z0-9-]{1,40} (titles go in notify text); files x.ts|py|sh; schedule: chrona_schedule rule, every>=5min; effects notify_user|wake_provider|network; params number|string|boolean. Invalid: rejected+report.errors. Entry is a long-running process using the SDK: import {on, chrona} from "/chrona/sdk.ts"; on("schedule"|"inbound"|"tool", async ev => ...) where ev {id,kind,firedAt,item?,args?,now,params}; return {handled?:true,result?} (inbound stays with the Provider unless handled:true; result <=16KiB answers a tool); call await chrona.notify({key,level,title,body}) / chrona.wakeProvider({key,prompt}) only for declared effects; keys are idempotency keys, derive them from the event. Keep state only in /data (process may restart); /module ro; keepAlive:true for long connections. Tests: import {startModule} from "/chrona/testing.ts" (fake kernel, records calls), offline, exit 0. Build smoke-starts every trigger and tool and probes keys; schema upgrade with data needs migrate (one-shot script, stdin {migrate:{from,to},now}). If the user allowed it for the module, updates with no new effects, no migration and passing checks auto-activate.'),
  chrona_modules: z.object({}).strict().describe("List modules (apps), versions, approval status and recent runs."),
  chrona_module_checkout: z.object({ moduleId: id, hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), dir: relativePathSchema }).strict().describe("Copy module files into an empty directory of the session directory for editing; hash defaults to the active version."),
  chrona_module_rollback: z.object({ moduleId: id, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().describe('Roll back to a previously approved module hash. May return { status: "pending_approval", approvalId } when restoring a data snapshot needs user approval. Accepts no force/restore flag.'),
  chrona_schedules: z.object({}).strict(),
  chrona_schedule_cancel: z.object({ scheduleId: id }).strict(),
  /** Choose which apps' content areas this session may write (others stay read-only under /content); takes effect from the next run. */
  chrona_focus: z.object({ modules: z.array(slug).min(1).max(10) }).strict(),
  /** Full-text search over past sessions' messages; returns matching sessions with snippets. */
  chrona_session_search: z.object({ query: text.max(200), limit: z.number().int().min(1).max(10).default(3) }).strict(),
  chrona_request_approval: z.object({ action: z.enum(ACTIONS), title: text.max(200), detail: text.max(4000), preview: text.max(20_000) }).strict(),
  chrona_request_path_access: z.object({ path: text.max(4096), reason: text.max(2000) }).strict().describe("Ask the user to mount an absolute host directory or file (read-write) into later runs of this session. The current run cannot see it; after approval, schedule a wake to continue."),
  chrona_send_email: z.object({ connectorId: id, to: z.array(z.string().email()).min(1).max(20), subject: text.max(500), body: text.max(50_000), inReplyTo: z.string().max(500).optional() }).strict(),
  chrona_inbound: z.object({ connectorId: id.optional(), status: z.enum(INBOUND_STATUSES).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(),
  chrona_remember: z.object({ text: text.max(500), topic: z.enum(PREFERENCE_TOPICS).default("general").describe("ui for how the user likes pages laid out") }).strict(),
  chrona_ui_guide: z.object({}).strict(),
  chrona_ui_set: z.object({
    module: slug.describe("App whose content area receives the page; must be focused"),
    path: relativePathSchema.refine(path => path.endsWith(".ui.json"), "Page files end with .ui.json"),
    spec: z.union([z.record(z.string(), z.unknown()), z.string().max(200_000)]).describe("json-render spec {root, elements, state}, or its JSONL patch stream"),
    role: z.enum(["page", "entry"]).default("page").describe("entry: the page this app opens on"),
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
export type DeliveryMessage = { idempotencyKey: string; title: string; body: string; link: string | null; recipient: string | null; files?: { name: string; path: string }[];
  /** An open approval this message asks about; chat channels may offer approve/deny buttons (scoped: an "always" scope is available). */
  approval?: { id: string; scoped: boolean } };
export type DeliveryOutcome = { outcome: "accepted"; receiptRef: string | null } | { outcome: "rejected"; retryable: boolean; error: string } | { outcome: "uncertain"; error: string };
export type DeliveryAdapter = { channel: DeliveryChannel; send(message: DeliveryMessage): Promise<DeliveryOutcome> };

/** Provider adapter (Pi first). Chrona owns when and where a run happens; the Provider owns how it works. */
export type ProviderRunInput = {
  runId: string; token: string; lane: RunLane; cwd: string; sessionDir: string; sessionId: string | null;
  prompt: string; images?: { mime: string; base64: string }[]; deadline: Date;
  /** Module tool names (m_*) declared up front; Providers with tool allowlists must admit them. */
  extraTools?: string[];
  /** The catalog also has deferred module tools (m_*); Providers should admit them behind their tool search. */
  searchTools?: boolean;
  /** Absolute host paths the user approved for this run (read-write). */
  hostPaths?: string[];
  /** Module content areas mounted at /content/<name>; only focused ones are writable. */
  content?: { name: string; dir: string; writable: boolean }[];
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
export type Session = z.infer<typeof sessionSchema>;
export type App = z.infer<typeof appSchema>;
export type FileNode = z.infer<typeof fileNodeSchema>;
export type FileContent = z.infer<typeof fileContentSchema>;
export type Run = z.infer<typeof runSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Message = z.infer<typeof messageSchema>;
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
export type UiEvent = z.infer<typeof uiEventSchema>;
export type ChatReply = z.infer<typeof chatReplySchema>;
