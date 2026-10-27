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

export const SESSION_SOURCES = ["web", "qq", "mcp", "rescue", "wake", "module", "build"] as const;
export const SESSION_STATUSES = ["active", "ended"] as const;
export const RUN_LANES = ["foreground", "background", "build"] as const;
export const RUN_TRIGGERS = ["message", "schedule", "source", "edit", "approval", "retry", "build"] as const;
export const RUN_STATUSES = ["queued", "running", "finished", "failed", "timed_out", "cancelled", "provider_unavailable"] as const;
/** `wake` runs the Provider in a fresh session and reports back to the session that created it;
 * `remind` is accepted as input only: it creates a `module` schedule of the built-in remind module with `payload: { text }`;
 * `module` rows are created only by Chrona on module activation/rollback. */
export const SCHEDULE_MODES = ["wake", "module"] as const;
export const SCHEDULE_STATUSES = ["active", "paused", "done", "cancelled"] as const;
export const APPROVAL_STATUSES = ["open", "approved", "denied", "expired"] as const;
/** `always` turns the decision into a grant: scoped to the module the approval is about, else global. */
export const APPROVAL_SCOPES = ["once", "always"] as const;

/** Actions Chrona itself performs for the Provider and therefore gates. Provider-native actions are governed by the Provider runtime/sandbox. */
export const ACTIONS = [
  "notify_user", "schedule", "activate_module", "read_source", "connect_source",
  "send_external_message", "modify_external", "delete_data", "share_third_party", "purchase", "change_credentials", "access_host_path",
  /** Owner-level policy changes (grants, budgets, moduleModel, notification settings) requested through an entry module. */
  "change_policy",
] as const;
export const GRANT_MODES = ["auto", "notify_after", "preapproved", "ask", "never"] as const;
export const DEFAULT_POLICY = {
  notify_user: "auto", schedule: "auto", activate_module: "ask", read_source: "auto",
  connect_source: "ask", send_external_message: "ask", modify_external: "ask", delete_data: "ask",
  share_third_party: "ask", purchase: "ask", change_credentials: "never", access_host_path: "ask", change_policy: "ask",
} as const satisfies Record<(typeof ACTIONS)[number], (typeof GRANT_MODES)[number]>;

export const NOTIFY_LEVELS = ["now", "digest", "web"] as const;
export const NOTIFICATION_STATUSES = ["queued", "sent", "failed", "uncertain", "folded", "suppressed", "acknowledged"] as const;
export const DELIVERY_CHANNELS = ["in_app", "chrona_qqbot"] as const;
export const DEFAULT_NOTIFICATION_SETTINGS = { dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, timezone: "Asia/Shanghai", digestAt: "09:00" } as const;


export const RUN_LIMITS = {
  foregroundTimeoutMs: 5 * 60_000, backgroundTimeoutMs: 20 * 60_000, buildTimeoutMs: 60 * 60_000,
  maxChronaToolCalls: 60, maxRunsPerSessionPerDay: 24, maxRunsPerDay: 200, maxFailures: 3,
  jobTimeoutMs: 60_000, jobOutputBytes: 64 * 1024,
  /** Author tests compile frontend dependencies; runtime modules keep their smaller sandbox limit. */
  moduleTestMemoryMb: 2048,
  /** Build sessions (v2-13): new ones per day, and module submissions per run. */
  maxBuildRunsPerDay: 20, maxBuildSubmissionsPerRun: 5, maxQueuedBuilds: 10,
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

// ------------------------------------------------------------- schedules ---

export const scheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: iso }).strict(),
  z.object({ kind: z.literal("daily"), time: hhmm }).strict(),
  z.object({ kind: z.literal("weekly"), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), time: hhmm }).strict(),
  z.object({ kind: z.literal("every"), minutes: z.number().int().min(5).max(10080) }).strict(),
]);
/**
 * `network`: the sandbox lets the module reach the network. The others are deprecated (v2-10): they now stand for the
 * system interfaces in `grantedUses`, so versions written before still work; new versions list those in `uses`.
 */
export const MODULE_EFFECTS = ["notify_user", "wake_provider", "network", "model"] as const;
/** Module model tier name (e.g. fast, strong); the user maps tiers to exact models in `moduleModel.models`. */
export const modelTier = z.string().regex(/^[a-z][a-z0-9-]{1,20}$/);
export const MODULE_LANGUAGES = ["typescript", "python", "shell"] as const;
const slug = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
export const RESERVED_LISTEN_PATHS = ["/api/steward", "/api/workspaces", "/api/health"] as const;
const moduleTriggerSchema = z.object({ id: slug, schedule: scheduleRuleSchema }).strict();
const toolParameterSchema = z.union([
  z.object({ type: z.enum(["string", "number", "boolean"]), description: z.string().max(300).optional() }).strict(),
  z.object({ type: z.literal("string"), enum: z.array(z.string().max(100)).min(1).max(20), description: z.string().max(300).optional() }).strict(),
]);
/**
 * Who may call a module tool (an interface): `provider` (m_* tools of runs), `owner` (the user: entry modules with `uses: ["*"]` and the owner API),
 * `modules` (other modules declaring it in `uses`, routed by Chrona) and `kernel` (Chrona itself).
 */
export const TOOL_VISIBILITY = ["provider", "owner", "modules", "kernel"] as const;
const moduleToolSchema = z.object({
  name: slug, description: z.string().min(1).max(500),
  parameters: z.object({ type: z.literal("object"), properties: z.record(slug, toolParameterSchema).default({}), required: z.array(slug).default([]) }).strict(),
  visibility: z.array(z.enum(TOOL_VISIBILITY)).min(1).max(TOOL_VISIBILITY.length).default(["provider", "owner"]),
  /** With `modules` visibility: only these modules may call it (e.g. a delivery adapter only for the notification module). */
  callers: z.array(slug).min(1).max(20).optional(),
  /** Safe to run twice: Chrona redelivers an asynchronous call whose outcome is unknown only when this is true. */
  idempotent: z.boolean().default(false),
}).strict();
/** `<module>.<tool>`: a module tool other modules call through Chrona. */
export const interfaceRefSchema = z.string().regex(/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/);
const listenPath = z.union([z.literal("/"), z.string().regex(/^\/api\/[a-z][a-z0-9-]{1,40}$/)]);
/** The HTTP paths a module serves (`listen` is one path or several). */
export const listenPaths = (manifest: { listen?: string | readonly string[] }): string[] => manifest.listen === undefined ? [] : typeof manifest.listen === "string" ? [manifest.listen] : [...manifest.listen];
export const moduleManifestSchema = z.object({
  name: slug,
  /** What the module's toolset offers; callers find its tools by this, like an MCP server's description. */
  description: z.string().min(1).max(300).optional(),
  entry: z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/),
  triggers: z.array(moduleTriggerSchema).max(10),
  tools: z.array(moduleToolSchema).max(10).default([]),
  /** Run from activation and restart on exit (long connections); otherwise started per event and stopped when idle. */
  keepAlive: z.boolean().default(false),
  /** A private file directory at `chrona.paths.content`, kept with the module's data (v2-8: no longer shown to the user or the Provider; expose files through tools). */
  content: z.boolean().default(false),
  /**
   * Serves HTTP under this path (v2-4 entry modules): the module runs an HTTP server on the Unix socket `CHRONA_HTTP_SOCKET` (SDK `chrona.serve`)
   * and Chrona proxies authenticated requests to it, without `Authorization` and `Cookie`. One active module per path;
   * kernel paths (`/api/steward*`, `/api/workspaces`, `/api/health`) are reserved. Requires keepAlive.
   * `"/"` is the web page: every GET/HEAD outside /api, /health and /ready, unauthenticated (pages carry no data;
   * the browser holds the user's key), so its module is an entry module (see isEntryModule).
   * Several paths as an array (v2-8: the web page at "/" and its data API under /api/web).
   */
  listen: z.union([listenPath, z.array(listenPath).min(1).max(4)]).optional(),
  /** Deprecated and ignored: delivery adapters are module tools called by the notification module. Kept so stored versions parse. */
  channel: z.literal("chrona_qqbot").optional(),
  /**
   * Module tools this module calls through Chrona (`chrona.call`); approved with the version like any capability.
   * `"*"`: every tool open to the user (`owner` visibility), for entry modules that offer all apps to the user (web, MCP).
   */
  uses: z.array(z.union([interfaceRefSchema, z.literal("*")])).max(40).default([]),
  /**
   * System programs (v2-6), named for the host backend: nixpkgs attributes under Nix, the distribution's package names
   * otherwise. Language libraries come from lockfiles instead (package.json + bun.lock, pyproject.toml + uv.lock), which
   * Chrona installs at build time; `node_modules`, `.venv` and `.chrona` are never submitted.
   */
  packages: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,80}$/)).max(20).default([]),
  /**
   * Declarations for other modules (v2-14), keyed by the module that interprets them (e.g. `events`). Chrona keeps them
   * with the version and shows them on the approval card, but does not read them; that module reads them through
   * `modules.contributions`.
   */
  contributes: z.record(slug, z.json()).optional()
    .refine(value => value === undefined || JSON.stringify(value).length <= 32 * 1024, "contributes must be at most 32 KiB"),
  /** Kernel-held credentials this module may read with `secret` (v2-16: any module; qq_bot only entry modules). The user sets them on the page or with `chrona admin secret-set`. */
  secrets: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/)).max(5).default([]),
  /** Receives schedules created at runtime with a payload (e.g. reminders); built-in modules only for now. */
  dynamicSchedules: z.boolean().default(false),
  /** Required with the `model` effect: a tier the user configured in `moduleModel.models`, bounded by its limits. */
  model: z.object({ tier: modelTier, maxCalls: z.number().int().min(1).max(20), maxOutputTokens: z.number().int().min(1).max(32_000) }).strict().optional(),
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
  if (!manifest.triggers.length && !manifest.tools.length && !manifest.keepAlive && !manifest.dynamicSchedules) ctx.addIssue({ code: "custom", path: ["triggers"], message: "A module needs a trigger, a tool, keepAlive or dynamicSchedules" });
  if (new Set(manifest.effects).size !== manifest.effects.length) ctx.addIssue({ code: "custom", path: ["effects"], message: "Effects must be unique" });
  if (manifest.secrets.includes("qq_bot") && !isEntryModule(manifest)) ctx.addIssue({ code: "custom", path: ["secrets"], message: "qq_bot is only for entry modules (chat.*, approvals.* or *)" });
  if (SYSTEM_MODULES.includes(manifest.name as (typeof SYSTEM_MODULES)[number])) ctx.addIssue({ code: "custom", path: ["name"], message: "Name is reserved for a Chrona system module" });
}).superRefine((manifest, ctx) => {
  if (manifest.channel && !manifest.keepAlive) ctx.addIssue({ code: "custom", path: ["channel"], message: "channel requires keepAlive" });
  if (new Set(manifest.uses).size !== manifest.uses.length) ctx.addIssue({ code: "custom", path: ["uses"], message: "Uses must be unique" });
  if (manifest.listen && !manifest.keepAlive) ctx.addIssue({ code: "custom", path: ["listen"], message: "listen requires keepAlive" });
  if (listenPaths(manifest).some(own => RESERVED_LISTEN_PATHS.some(path => own === path || own.startsWith(`${path}-`)))) ctx.addIssue({ code: "custom", path: ["listen"], message: "Path is reserved by Chrona" });
  if (new Set(listenPaths(manifest)).size !== listenPaths(manifest).length) ctx.addIssue({ code: "custom", path: ["listen"], message: "Listen paths must be unique" });
  if (grantedUses(manifest).includes("provider.complete") !== !!manifest.model) ctx.addIssue({ code: "custom", path: ["model"], message: "Declare model limits exactly when the module uses provider.complete" });
  const names = new Set<string>();
  manifest.tools.forEach((tool, index) => {
    if (names.has(tool.name)) ctx.addIssue({ code: "custom", path: ["tools", index, "name"], message: "Tool names must be unique" });
    names.add(tool.name);
    if (new Set(tool.visibility).size !== tool.visibility.length) ctx.addIssue({ code: "custom", path: ["tools", index, "visibility"], message: "Visibility must be unique" });
    if (tool.callers && !tool.visibility.includes("modules")) ctx.addIssue({ code: "custom", path: ["tools", index, "callers"], message: "callers require modules visibility" });
    for (const key of tool.parameters.required) if (!(key in tool.parameters.properties)) ctx.addIssue({ code: "custom", path: ["tools", index, "parameters", "required"], message: `Required parameter ${key} is not in properties` });
  });
});
export type ModuleTrigger = z.infer<typeof moduleTriggerSchema>;
/** Acts as the user, or serves the page holding the user's key: never activated automatically. */
/** v2-16: any module may ask the user to decide something; these do not make it an entry module. */
const MODULE_APPROVAL_TOOLS = ["approvals.request", "approvals.status"];
/**
 * Acts as the user (their conversations, `chat.*`; their approvals, `approvals.*`; every tool open to them, `*`),
 * or serves the page holding the user's key: every version needs the user, never activated automatically.
 */
export const isEntryModule = (manifest: { effects: readonly string[]; listen?: string | readonly string[]; uses?: readonly string[] }) =>
  listenPaths(manifest).includes("/") || (manifest.uses ?? []).some(target => target === "*" || target.startsWith("chat.") || (target.startsWith("approvals.") && !MODULE_APPROVAL_TOOLS.includes(target)));
export type ModuleTool = z.infer<typeof moduleToolSchema>;
/**
 * v2 module channel (Unix socket `CHRONA_SOCKET`, one JSON object per line, both directions). Modules import the SDK as
 * `chrona` and find their directories through `chrona.paths`, with or without a sandbox.
 * Chrona → module: an event `{ id, event }`; the module answers `{ id, result }` or `{ id, error }`.
 * Module → Chrona: a call `{ id, method, params }`; Chrona answers `{ id, result }` or `{ id, error }`.
 * Events of one module are delivered one at a time; calls made meanwhile belong to that event.
 */
const channelId = z.string().min(1).max(64);
const moduleResultSchema = z.json().optional().refine(value => value === undefined || new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262_144, "result must serialize to at most 256 KiB");
/** Statuses of a routed call: sync calls finish in place; async ones are stored and delivered by Chrona. */
export const CALL_STATUSES = ["queued", "running", "succeeded", "failed", "unknown"] as const;
/** Who made a call, as Chrona recorded it (never supplied by the caller). `via` names the entry module behind an owner call. */
export const callerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("module"), module: slug, moduleId: z.string().max(128), hash: z.string().max(64) }).strict(),
  z.object({ kind: z.literal("provider"), runId: z.string().max(128) }).strict(),
  z.object({ kind: z.literal("owner"), via: slug.nullable() }).strict(),
  z.object({ kind: z.literal("kernel") }).strict(),
  /** A system module (in-process, part of Chrona, e.g. `chat` pushing a reply). */
  z.object({ kind: z.literal("system"), module: slug }).strict(),
]);
export const moduleEventSchema = z.object({
  trigger: z.discriminatedUnion("kind", [
    /** `scheduleId` and `payload` are set for dynamic schedules (e.g. reminders created through `chrona_schedule`). */
    z.object({ kind: z.literal("schedule"), id: slug, firedAt: iso, scheduleId: z.string().max(128).optional(), payload: z.record(z.string(), z.unknown()).optional() }).strict(),
    /**
     * A tool call. `caller` is who called it; `call` is set for routed calls: `key` is the caller's idempotency key
     * (async calls only), `attempt` counts deliveries of the same call, `chain` lists the modules on the call path.
     */
    z.object({ kind: z.literal("tool"), id: slug, firedAt: iso, args: z.record(z.string(), z.unknown()),
      caller: callerSchema.optional(),
      call: z.object({ id: z.string().max(128), key: z.string().max(500).nullable(), attempt: z.number().int().min(1), chain: z.array(slug).max(16) }).strict().optional() }).strict(),
    /** The result of an async call this module made with `reply: true` (`id` is always "call"). */
    z.object({ kind: z.literal("call_result"), id: z.literal("call"), firedAt: iso, callId: z.string().max(128), target: interfaceRefSchema, key: z.string().max(500),
      status: z.enum(["succeeded", "failed", "unknown"]), output: z.json().optional(), error: z.string().max(2000).optional() }).strict(),
  ]),
  now: iso,
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
}).strict();
export const moduleEventMessageSchema = z.object({ id: channelId, event: moduleEventSchema }).strict();
/** `result` answers a tool call. `handled` is ignored (it handed inbound items back before connectors were removed); kept so older modules still answer. */
export const moduleEventReplySchema = z.object({ id: channelId, result: z.object({ handled: z.boolean().optional(), result: moduleResultSchema }).strict().default({}) }).strict()
  .or(z.object({ id: channelId, error: z.string().max(2000) }).strict());
/**
 * v2-10 names of the `provider` system module's tools (v2-11). Approved versions are hash-bound, so their `uses` and calls
 * keep these names. shortcut: aliases stay until every module version naming `ai.*` is rebuilt; then delete this map.
 */
const LEGACY_TARGETS: Record<string, string> = { "ai.complete": "provider.complete", "ai.wake": "provider.wake" };
/** A call target or `uses` entry under its current name. */
export const currentTarget = (target: string) => LEGACY_TARGETS[target] ?? target;
/**
 * What a module may call: its `uses` (current names), plus what deprecated declarations stand for (v2-10) — `effects` `model`,
 * `wake_provider` and `notify_user` for `provider.complete`, `provider.wake` and `notify.send`, and listed `secrets` for `secrets.get`.
 */
export function grantedUses(manifest: { effects: readonly string[]; uses?: readonly string[]; secrets?: readonly string[] }): string[] {
  const implied = { model: "provider.complete", wake_provider: "provider.wake", notify_user: "notify.send" } as Record<string, string>;
  return [...new Set([...(manifest.uses ?? []).map(currentTarget), ...manifest.effects.flatMap(effect => implied[effect] ? [implied[effect]] : []), ...(manifest.secrets?.length ? ["secrets.get"] : [])])];
}
/** The interface `chrona.notify` and Chrona's own notifications go to. */
export const NOTIFY_INTERFACE = "notify.send";
/** Chrona's in-process system modules: reached by routed calls like modules, but part of Chrona (not proposable, not sandboxed). */
export const SYSTEM_MODULES = ["chat", "approvals", "modules", "settings", "schedules", "provider", "secrets", "activity"] as const;
/** Longest call path; synchronous calls are refused when the target is already on their path (it is waiting). */
export const MAX_CALL_DEPTH = 6;
export const moduleCallSchema = z.discriminatedUnion("method", [
  /**
   * A routed call to another module's tool (`target` must be in `uses`). `sync` waits for the result (bounded by
   * `timeoutMs`); a timeout or crash after delivery is `unknown`, never retried. `async` stores the call under the
   * caller's idempotency `key` (a repeat returns the same call) and returns at once; Chrona delivers it, retrying only
   * deliveries that never reached the target, or `idempotent` targets. `reply` sends a `call_result` event back.
   */
  z.object({ id: channelId, method: z.literal("call"), params: z.object({
    target: interfaceRefSchema, args: z.record(z.string(), z.json()).default({}), mode: z.enum(["sync", "async"]).default("sync"),
    key: z.string().min(1).max(200).optional(), reply: z.boolean().default(false), timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  }).strict().refine(params => params.mode === "sync" || params.key !== undefined, "async calls need a key") }).strict(),
  /** State of an async call this module made. */
  z.object({ id: channelId, method: z.literal("callStatus"), params: z.object({ callId: z.string().min(1).max(128) }).strict() }).strict(),
]);
export const MODULE_CALL_ERRORS = ["undeclared", "invalid", "internal",
  /** Routed calls: refused by the target's visibility/callers, unknown target, would wait on itself, outcome unknown, the target failed or never got it. */
  "forbidden", "not_found", "conflict", "cycle", "unknown", "failed", "unavailable"] as const;
export const moduleCallReplySchema = z.object({ id: channelId, result: z.union([
  /** Sync `call` replies: the target's result. */
  z.object({ output: z.json() }).strict(),
  /** Async `call` and `callStatus` replies. */
  z.object({ callId: z.string().max(128), status: z.enum(CALL_STATUSES), duplicate: z.boolean().optional(), output: z.json().optional(), error: z.string().max(2000).optional() }).strict(),
]) }).strict()
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
  /** Module names whose tools runs in this session get directly (others through tool search); new sessions: files. */
  focus: z.array(slug).max(10),
  running: z.boolean(), lastActivityAt: iso, createdAt: iso, endedAt: iso.nullable(),
}).strict();

/** A module as an app: identity and state. */
export const appSchema = z.object({
  id, name: slug, description: z.string().max(300).nullable(), status: z.enum(["active", "paused"]), builtin: z.boolean(), activeHash: z.string().max(64).nullable(),
}).strict();

export const runSchema = z.object({
  id, sessionId: id.nullable(), lane: z.enum(RUN_LANES), trigger: z.enum(RUN_TRIGGERS), status: z.enum(RUN_STATUSES),
  provider: short, toolCalls: z.array(z.object({ tool: short, at: iso, ok: z.boolean() }).strict()).max(200),
  error: z.string().max(1000).nullable(), startedAt: iso.nullable(), endedAt: iso.nullable(), createdAt: iso,
  /** Short user-facing description (from the schedule or module that started it); null for conversation runs. */
  label: z.string().max(80).nullable(),
}).strict();

/** A file reference `<owner>/<path>`; attachments are `chat/<file>` (the Provider sees them under content/chat/ in its working directory). */
export const contentRefSchema = z.string().trim().min(3).max(542).regex(/^[a-z][a-z0-9-]{1,40}\//, "starts with a module name")
  .refine(ref => relativePathSchema.safeParse(ref.slice(ref.indexOf("/") + 1)).success, "invalid path");
export const attachmentSchema = z.object({ name: short, ref: contentRefSchema.nullable(), mime: z.string().max(100), size: z.number().int().min(0) }).strict();
export const messageSchema = z.object({
  id, sessionId: id, direction: z.enum(["in", "out"]), channel: z.enum(DELIVERY_CHANNELS), text: z.string().max(8000),
  attachments: z.array(attachmentSchema).max(10), quotedMessageId: id.nullable(), at: iso,
}).strict();

/** v2-17: computed by the kernel from facts. green needs no one; yellow asks; red asks on the page only, never as a standing grant. */
export const APPROVAL_LEVELS = ["green", "yellow", "red"] as const;
/** The short card: one-sentence headline, what approving adds, and whether it can be undone. `reviewed`: AI review outcome (v2-17 §3). */
export const approvalBriefSchema = z.object({
  headline: z.string().max(300), added: z.array(z.string().max(200)).max(20), reversible: z.boolean().nullable(),
  reviewed: z.enum(["passed", "escalated", "unavailable"]).nullable(), reason: z.string().max(500).nullable(),
}).strict();
export const approvalSchema = z.object({
  id, action: z.enum(ACTIONS), moduleId: id.nullable(),
  title: short, detail: z.string().max(4000),
  /** Exactly what will be done, shown to the user (e.g. the email draft). */
  preview: z.string().max(20_000),
  level: z.enum(APPROVAL_LEVELS), brief: approvalBriefSchema.nullable(),
  status: z.enum(APPROVAL_STATUSES), createdAt: iso, resolvedAt: iso.nullable(),
}).strict();

export const grantScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }).strict(),
  z.object({ kind: z.literal("module"), moduleId: id }).strict(),
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

export const notificationSettingsSchema = z.object({ dailyCap: z.number().int().min(0).max(50), quietHours: z.object({ start: hhmm, end: hhmm }).strict().nullable(), timezone: z.string().min(1).max(80), digestAt: hhmm }).strict();
/** The exact models modules may call, by tier (L1, user-only). No automatic fallback to another model or tier. */
/** Pi's thinking levels (`pi --thinking`). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const modelId = z.string().trim().min(1).max(200);
/** v2-17: a tier is a model and a thinking level; a bare model id (before v2-17) uses Pi's default level. */
export const modelTierTargetSchema = z.union([modelId, z.object({ model: modelId, thinking: z.enum(THINKING_LEVELS).optional() }).strict()]);
type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/** A tier's model and thinking level; Pi's `model:level` shorthand in a bare id is split, as Pi reports the model without it. */
export function tierTarget(value: z.infer<typeof modelTierTargetSchema>): { model: string; thinking?: ThinkingLevel } {
  if (typeof value !== "string") return value;
  const at = value.lastIndexOf(":"), level = value.slice(at + 1);
  return at > 0 && (THINKING_LEVELS as readonly string[]).includes(level) ? { model: value.slice(0, at), thinking: level as ThinkingLevel } : { model: value };
}
export const moduleModelSettingsSchema = z.object({
  models: z.record(modelTier, modelTierTargetSchema).refine(models => Object.keys(models).length >= 1 && Object.keys(models).length <= 10, "Configure 1-10 model tiers")
    .describe("Tier name → { model: exact provider/model id passed to Pi, thinking?: off..max }, e.g. { fast: { model: \"openai/gpt-6-luna\", thinking: \"low\" }, strong: { model: \"openai/gpt-6.1-sol\", thinking: \"high\" } }"),
  maxCallsPerEvent: z.number().int().min(1).max(20), maxOutputTokens: z.number().int().min(1).max(32_000),
  /** All modules together per local day; `moduleDailyCalls` caps single modules (v2-17), absent ones only by this. */
  dailyCalls: z.number().int().min(1).max(10_000), timeoutMs: z.number().int().min(5_000).max(600_000),
  moduleDailyCalls: z.record(slug, z.number().int().min(0).max(10_000)).optional(),
  /** v2-17: the approval review's own tier and daily calls (default: strong, else the first tier; 30 a day). */
  review: z.object({ tier: modelTier, dailyCalls: z.number().int().min(0).max(1_000) }).strict().optional(),
}).strict();
export const buildSettingsSchema = z.object({
  dailyLimit: z.number().int().min(0).max(200),
  timeoutMinutes: z.number().int().min(5).max(120),
  maxSubmissions: z.number().int().min(1).max(20),
}).strict();
export const settingsSchema = z.object({
  notifications: notificationSettingsSchema,
  builds: buildSettingsSchema,
  buildUsage: z.object({ date: z.string(), timezone: z.string(), used: z.number().int().min(0), remaining: z.number().int().min(0) }).strict(),
  /** v2-17: today's module model calls (local day), per module. */
  modelUsage: z.array(z.object({ module: z.string(), calls: z.number().int().min(0), inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) }).strict()),
  /** null: modules cannot use the `model` effect (builds declaring it fail). */
  moduleModel: moduleModelSettingsSchema.nullable(),
  chat: z.object({ channel: z.enum(DELIVERY_CHANNELS), bound: z.boolean(), sentToday: z.number().int().min(0) }).strict(),
}).strict();
export const healthSchema = z.object({
  provider: z.object({ name: short, available: z.boolean(), sandboxed: z.boolean(), lastError: z.string().max(500).nullable() }).strict(),
  /** Modules and the Provider run inside bubblewrap; false means they run unisolated as the Chrona user. */
  moduleSandbox: z.boolean(),
  queuedRuns: z.number().int().min(0), runningRuns: z.number().int().min(0), failedRunsToday: z.number().int().min(0),
  dueSchedules: z.number().int().min(0),
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

export const chatReplySchema = z.object({ runId: id.nullable(), sessionId: id, messages: z.array(messageSchema) }).strict();
/** Ends the active session for `key` (QQ `/new`); the next message starts a new one. */
export const newSessionSchema = z.object({ key: z.string().min(1).max(200) }).strict();
export const updateSessionSchema = z.object({ title: short.optional(), status: z.literal("ended").optional() }).strict();
export const createScheduleSchema = z.object({ mode: z.enum(["wake", "remind"]), rule: scheduleRuleSchema, text: z.string().max(4000), label: z.string().trim().min(1).max(80).optional(), until: iso.optional() }).strict();
export const updateScheduleSchema = z.object({ status: z.enum(["active", "paused", "cancelled"]) }).strict();
export const resolveApprovalSchema = z.object({ decision: z.enum(["approve", "deny"]), scope: z.enum(APPROVAL_SCOPES).default("once") }).strict();
export const createGrantSchema = z.object({ action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), scope: grantScopeSchema, expiresAt: iso.optional() }).strict();
export const updateSettingsSchema = z.object({ notifications: notificationSettingsSchema.partial().optional(), moduleModel: moduleModelSettingsSchema.nullable().optional(), builds: buildSettingsSchema.partial().optional() }).strict();

// ------------------------------------------------------------ HTTP map -----
/**
 * Kernel HTTP (v2-9): `/health`, `/ready` and `/api/steward-agent` (the Provider's tool bridge, run capability tokens).
 * There is no owner API: the user reaches Chrona through entry modules (`listen`, e.g. the web page's /api/web and the
 * owner MCP's /api/mcp), which make routed calls; `/api/*` requests need the API key before Chrona forwards them.
 * Rescue console (v2-4 §5): separate listener (`CHRONA_RESCUE_PORT`, loopback by default), `Authorization: Bearer <RESCUE_KEY>`,
 * never proxied to a module:  GET / (static page) · POST /api/chat {text} -> ChatReply (session key "rescue") ·
 *   GET /api/messages -> {items: Message[]} · GET /api/approvals -> {items: Approval[]} (open) ·
 *   POST /api/approvals/:id/resolve (ResolveApproval) -> Approval.
 */
/** Short codes (e.g. QQ binding codes): no 0/O/1/I/L. */
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// ---------------------------------------------------------- Chrona tools ---
/**
 * Tools Chrona exposes to the Provider (Pi: through the Chrona extension bridge; MCP later).
 * Everything else (files, shell, web) is the Provider's own.
 */
export const chronaToolInputSchemas = {
  /** Reply to the user in the current conversation (foreground runs). May be called several times. */
  chrona_reply: z.object({ text: text.max(8000), files: z.array(relativePathSchema).max(10).default([]).describe("Files to attach: paths in your working directory (write them there first), or received attachments under content/chat/") }).strict(),
  /** Proactive message outside a conversation (background runs). Subject to the notification budget. */
  chrona_notify: z.object({ level: z.enum(["now", "digest"]), title: text.max(200), body: text.max(4000) }).strict(),
  chrona_schedule: createScheduleSchema.extend({ label: z.string().trim().min(1).max(80).describe("Short user-facing name shown on pages, in the user's language, e.g. 准备第2天材料") })
    .describe("wake: at the time, a fresh session runs `text` as its whole instruction (write it self-contained: goal, files under content/, what to report) and posts the result back to this session. remind: sends `text` to the user without a model."),
  chrona_schedules: z.object({}).strict(),
  chrona_schedule_cancel: z.object({ scheduleId: id }).strict(),
  /** Full-text search over past sessions' messages; returns matching sessions with snippets. */
  chrona_session_search: z.object({ query: text.max(200), limit: z.number().int().min(1).max(10).default(3) }).strict(),
  chrona_request_approval: z.object({ action: z.enum(ACTIONS), title: text.max(200), detail: text.max(4000), preview: text.max(20_000) }).strict(),
  chrona_request_path_access: z.object({ path: text.max(4096), reason: text.max(2000) }).strict().describe("Ask the user to mount an absolute host directory or file (read-write) into later runs of this session. The current run cannot see it; after the decision Chrona continues this conversation in a new run."),
  chrona_remember: z.object({ text: text.max(500), topic: z.enum(PREFERENCE_TOPICS).default("general").describe("ui for how the user likes pages laid out") }).strict(),
  chrona_forget: z.object({ preferenceId: id }).strict(),
  chrona_preferences: z.object({}).strict(),
} as const;
const moduleIntent = z.object({ changes: z.array(text.max(500)).min(1).max(20), preserves: z.array(text.max(500)).max(20).default([]) }).strict()
  .describe("What this version changes and what it keeps (shown on the approval card)");
/** Inputs of the `modules` system module's tools for the Provider (v2-13), reached as m_modules_<tool>. */
export const modulesToolInputSchemas = {
  reference: z.object({ target: z.string().regex(/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/).optional() }).strict()
    .describe("Read development reference only: without target, list available interfaces; with <module>.<tool>, get its input schema, declared output schema/examples and admission rules. Never executes the target or reads its business data. Undeclared outputs are explicitly unknown, not inferred from empty results."),
  check: z.object({ module: slug, hash: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("Defaults to the newest version"),
    wait: z.number().int().min(0).max(600).default(0).describe("Seconds to wait while it is still being checked (set timeoutSeconds at least as long)") }).strict()
    .describe("A module version's status and check report (tests, errors, data continuity, key probe); waits while it is building or testing."),
  checkout: z.object({ module: slug, hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), dir: relativePathSchema,
    source: z.enum(["stored", "builtin"]).optional().describe("stored (default): active or specified stored version; builtin: reference shipped with the running release, never activation") }).strict()
    .refine(input => input.source !== "builtin" || input.hash === undefined, "A built-in reference cannot select a stored version hash")
    .describe("Copy source into an empty directory in your working directory. Defaults to the active stored version; source builtin reads the running release's reference even when customization prevented registering that built-in. Returns the exact content hash; does not submit or activate it."),
  propose: z.object({ dir: relativePathSchema.describe("Module directory in your working directory"), intent: moduleIntent }).strict()
    .describe('Submit a module. Returns { moduleId, hash, status }; Chrona builds and checks it, then m_modules_check shows the result; activation needs the user\'s hash-bound approval. module.json {name,description?,entry,triggers,keepAlive?,content?,effects,model?:{tier,maxCalls,maxOutputTokens},params?:{k:{type,value}},data?:{schema,migrate?},tools?,tests}. trigger {id,schedule}; tool {name,description,parameters:{type:"object",properties,required},visibility?:["provider","owner","modules","kernel"] (default provider+owner),callers?:[module names],idempotent?}; uses?:["<module>.<tool>"] tools of other modules this module calls. contributes?:{<module>:json} declarations another module reads (v2-14), e.g. events: {"events":{"emits":[{name,description,payload:<JSON Schema object>}]}}; emit one with chrona.emit(name,payload,{key}) (uses ["events.emit"]); receive one by adding a tool with callers:["events"] and string parameters event, from, payload, then chrona.call("events.subscribe",{event:"<module>.<name>",tool}) (uses ["events.subscribe"]). name/ids/keys [a-z][a-z0-9-]{1,40} ; files x.ts|py|sh; schedule: chrona_schedule rule, every>=5min; effects: only network (other effects are deprecated); capabilities are uses: notify.send, provider.wake, provider.complete (with model); params number|string|boolean. Entry is a long-running process using the SDK: import {on, chrona} from "chrona"; on("schedule"|"tool", async ev => ...) where ev {id,kind,firedAt,args?,now,params}; return {result?} (result <=16KiB answers a tool); tell the user with chrona.call("notify.send",{key,level,title,body},{mode:"async",key}) (uses ["notify.send"]; the notify module applies the budget); other tools with chrona.call(target,args,{mode:"sync"|"async",key,reply}) (sync→result; async→{callId,status}, on("call_result") or chrona.callStatus(id)); wakeProvider({key,prompt}) (uses ["provider.wake"]) / model({system?,prompt,maxOutputTokens})→{text} (uses ["provider.complete"]); keys are idempotency keys, derive them from the event. Keep state only in chrona.paths.data (process may restart); keepAlive:true for long connections. Tests: import {startModule} from "chrona/testing" (fake kernel, records calls), offline, exit 0. Build smoke-starts every trigger and tool and probes keys; schema upgrade with data needs migrate (one-shot script, stdin {migrate:{from,to},now}). If the user allowed it and modules run sandboxed, updates with no new effects, no migration and passing checks auto-activate.'),
  rollback: z.object({ module: slug, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
    .describe('Roll back to a previously approved version. May return { status: "pending_approval", approvalId } when restoring a data snapshot needs user approval.'),
  "request-group": z.object({ versions: z.array(z.object({ module: slug, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(2).max(4) }).strict()
    .describe("v2-15, build conversations that declared several modules: once every declared module has a candidate that passed its checks (pending_review), ask for one approval that activates them all together. Versions needing a data migration are refused; build and approve that module on its own first."),
  "stop-build": z.object({ session: id }).strict()
    .describe("Stop a module build conversation's queued/running work; keep its files and history. Already submitted versions and approvals are not withdrawn."),
  "revise-build": z.object({ session: id, requirements: text.max(4000),
    files: z.array(relativePathSchema).max(10).optional().describe("Additional required references from the calling Provider's cwd or content/chat/. Provider only; owner requests cannot supply filesystem paths.") }).strict()
    .describe("Stop the old module build run and queue a revision at the tail in the same conversation, preserving files and history. Providers may supplement references via files; missing files fail before stopping the old run. Existing approval decisions are unchanged. Returns runId and queuePosition; no automatic retry."),
  build: z.object({ name: slug.optional().describe("The one module to write or change (or use modules)"),
    modules: z.array(slug).min(1).max(4).optional().describe("v2-15: every module this one change touches (1-4), built together and activated together after one approval"),
    goal: text.max(4000), examples: z.array(text.max(1000)).max(10).default([]),
    files: z.array(relativePathSchema).max(10).default([]).describe("Reference files (e.g. screenshots the user sent): attachments under content/chat/ or files in your working directory"),
    intent: moduleIntent }).strict()
    .refine(input => (input.name === undefined) !== (input.modules === undefined), "Give either name or modules")
    .refine(input => !input.modules || new Set(input.modules).size === input.modules.length, "modules must not repeat")
    .describe("Queue a build conversation: a separate session writes, tests and submits the module(s), then reports back here. A change that spans several modules is one build with modules: [...], not several builds the user must activate in order. FIFO, one running and up to 10 waiting per workspace; waiting makes no model calls. Returns status (build_queued/build_running), sessionId, runId, queuePosition and aheadCount. Identical outstanding requests from this conversation reuse the build. Daily new-session allowance is charged at admission; runtime limits start at claim. No dependency ordering beyond FIFO and no automatic retry."),
} as const;
export const CHRONA_TOOLS = Object.keys(chronaToolInputSchemas) as (keyof typeof chronaToolInputSchemas)[];

// ---------------------------------------------------------------- ports ----

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
  /** Directories mounted at <cwd>/content/<name> (v2-8: only `chat`, the conversations' attachments, read-only). */
  content?: { name: string; dir: string; writable: boolean }[];
  /** Safe summaries and explicit, run-bound UI requests; never raw thinking or tool payloads. */
  events?: ProviderEvents;
};
export type ProviderAdapter = {
  name: string;
  health(): Promise<{ available: boolean; sandboxed: boolean; error: string | null }>;
  /** One completion with `model`: no tools, session or fallback model (`provider.complete`). Absent: unconfigured. */
  complete?(input: { model: string; thinking?: (typeof THINKING_LEVELS)[number]; system?: string; prompt: string; maxOutputTokens: number; timeoutMs: number }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;
  /** Starts a run; returns a handle that can receive messages while running. */
  start(input: ProviderRunInput): { inject(message: string, images?: { mime: string; base64: string }[]): Promise<void>; abort(): Promise<void>; done: Promise<{ outcome: "finished" | "failed" | "timed_out" | "unavailable"; sessionId: string | null; error: string | null }> };
};

// ---------------------------------------------------------------- types ----

export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type App = z.infer<typeof appSchema>;
export type Run = z.infer<typeof runSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type GrantScope = z.infer<typeof grantScopeSchema>;
export type Grant = z.infer<typeof grantSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
export type Preference = z.infer<typeof preferenceSchema>;
export type StewardNotification = z.infer<typeof notificationSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Health = z.infer<typeof healthSchema>;
export type TodayView = z.infer<typeof todayViewSchema>;
export type ChatReply = z.infer<typeof chatReplySchema>;
