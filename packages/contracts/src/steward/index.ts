/**
 * Chrona shared contract, platform v2. Supervisor-owned.
 * Design: docs/zh/architecture.md. Chrona's features are modules (apps) that keep their files private
 * and interact only through routed calls. Conversations with the Provider are
 * sessions, keyed by the entry that owns them. There are no affairs.
 */
import { z } from "zod";
import { wakeBudgetSchema, routedTargetSchema, pageInput, PUBLIC_CALL_ERRORS, PUBLIC_CALL_REASONS } from "./kernel-api";
import { THINKING_LEVELS } from "./agent";
import { slug, moduleToolSchema } from "./module-tool";
import { moduleEntrySchema } from "./module-entry";
export { moduleEntrySchema, type ModuleEntry } from "./module-entry";
export { slug, TOOL_VISIBILITY, type ModuleTool } from "./module-tool";
import { moduleOriginSchema, moduleCapabilitiesSchema, moduleVersionHashSchema } from "./module-lifecycle";
export * from "./module-lifecycle";
export { moduleToolParameterSchema, type ModuleToolParameter } from "./module-input";
export { moduleOutputSchema, compileModuleOutput } from "./module-output";
import type { ProviderEvents } from "./provider";
export * from "./provider";
export * from "./agent-provider";
export * from "./execution";
export * from "./kernel-execution";
export * from "./execution-events";
export * from "./execution-tools";

const id = z.string().trim().min(1).max(128);
const iso = z.string().datetime({ offset: true }).max(40);
const short = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1);
const hhmm = z.string().regex(/^\d\d:\d\d$/);
/** Relative path inside a content area or session directory: no `..`, no leading slash, not under `.git`. */
export const relativePathSchema = z.string().trim().min(1).max(500)
  .refine(p => !p.startsWith("/") && !p.split("/").some(s => s === ".." || s === "" || s === ".git"), "invalid path");

// ---------------------------------------------------------------- vocab ----

// "reflect": stored history of the removed reflection loop; nothing creates such sessions any more.
export const SESSION_SOURCES = ["web", "qq", "mcp", "rescue", "wake", "module", "build", "reflect"] as const;
export const SESSION_STATUSES = ["active", "ended"] as const;
export const RUN_LANES = ["foreground", "background", "build"] as const;
export const RUN_TRIGGERS = ["message", "schedule", "source", "edit", "approval", "retry", "build"] as const;
export const RUN_STATUSES = ["queued", "running", "finished", "failed", "timed_out", "cancelled", "provider_unavailable"] as const;
/** Private persisted schedule vocabulary; no public schedule creation API. */
export const SCHEDULE_MODES = ["wake", "module"] as const;
export const SCHEDULE_STATUSES = ["active", "paused", "done", "cancelled"] as const;
export const APPROVAL_STATUSES = ["open", "approved", "denied", "expired"] as const;
/** Private approval resolution is once-only. */
export const APPROVAL_SCOPES = ["once"] as const;

/** Approval records for governed module changes and application-requested decisions. */
export const ACTIONS = ["activate_module", "delete_data", "modify_external"] as const;
/** Private policy storage vocabulary; approvals do not create grants. */
export const GRANT_MODES = ["allow", "ask"] as const;
export const DEFAULT_POLICY = {
  activate_module: "ask", delete_data: "ask", modify_external: "ask",
} as const satisfies Record<(typeof ACTIONS)[number], (typeof GRANT_MODES)[number]>;

export const DELIVERY_CHANNELS = ["in_app", "chrona_qqbot"] as const;

export const RUN_LIMITS = {
  buildTimeoutMs: 60 * 60_000,
  maxChronaToolCalls: 60, maxRunsPerSessionPerDay: 24, maxRunsPerDay: 200, maxFailures: 3,
  jobTimeoutMs: 60_000, jobOutputBytes: 64 * 1024,
  /** Author tests compile frontend dependencies; runtime modules keep their smaller sandbox limit. */
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
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

// ------------------------------------------ private schedule and manifest ---

/** Retained for domain schedule calculations and stored-record parsing across packages. */
export const scheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: iso }).strict(),
  z.object({ kind: z.literal("daily"), time: hhmm }).strict(),
  z.object({ kind: z.literal("weekly"), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), time: hhmm }).strict(),
  z.object({ kind: z.literal("every"), minutes: z.number().int().min(5).max(10080) }).strict(),
]);
/** `network`: the sandbox lets the module reach the network. */
export const MODULE_EFFECTS = ["network"] as const;
/** Application-declared model tier; Agent owns its mapping to exact models. */
export const modelTier = z.string().regex(/^[a-z][a-z0-9-]{1,20}$/);
export const MODULE_LANGUAGES = ["typescript", "python", "shell"] as const;
export const RESERVED_LISTEN_PATHS = ["/api/steward", "/api/workspaces", "/api/health"] as const;
/** `<module>.<tool>`: a module tool other modules call through Chrona. */
export const interfaceRefSchema = z.string().regex(/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/);
const listenPath = z.union([z.literal("/"), z.string().regex(/^\/api\/[a-z][a-z0-9-]{1,40}$/)]);
/** The HTTP paths a module serves (`listen` is one path or several). */
export const listenPaths = (manifest: { listen?: string | readonly string[] }): string[] => manifest.listen === undefined ? [] : typeof manifest.listen === "string" ? [manifest.listen] : [...manifest.listen];
/** Versioned literal runtime parameters; mutable application preferences live with their application. */
export function moduleRuntimeParams(manifest: { params: Record<string, { value: string | number | boolean }> }) {
  return Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value]));
}
const SECRET_NAME_SCHEMA = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
const SECRET_FIELD_NAME = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/);
const secretLabel = z.string().min(1).max(80);
const oauthEndpoint = z.string().url().refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search; }
  catch { return false; }
});
/** v2-16 §2.1: what the page asks the user for. Field names are shown, values never. */
export const secretSpecSchema = z.object({
  name: SECRET_NAME_SCHEMA,
  label: secretLabel.optional(),
  description: z.string().max(500).optional(),
  fields: z.array(z.object({ name: SECRET_FIELD_NAME, label: secretLabel, description: z.string().max(300).optional(), optional: z.boolean().optional(),
    /** Not secret (an id, a username): shown as typed and kept visible on the page. */
    plain: z.boolean().optional() }).strict()).max(20).default([]),
  /** Keys the user names, e.g. one password per account id. */
  extraFields: z.object({ label: secretLabel, valueLabel: secretLabel, description: z.string().max(300).optional() }).strict().optional(),
  /** v2-30 §4: the page offers "authorize" with these scopes; clientId/clientSecret are asked for unless listed in fields. */
  oauth: z.object({
    provider: z.enum(["google", "microsoft"]), scopes: z.array(z.string().min(1).max(200)).min(1).max(20), accounts: z.boolean().optional(),
    authorizationUrl: oauthEndpoint, tokenUrl: oauthEndpoint,
    authorizationParams: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.string().max(2000)).refine(value => !Object.keys(value).some(key => ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method"].includes(key))).optional(),
  }).strict().optional(),
}).strict();
export type SecretSpec = z.infer<typeof secretSpecSchema>;
export const moduleManifestSchema = z.object({
  name: slug,
  /** What the module's toolset offers; callers find its tools by this, like an MCP server's description. */
  description: z.string().min(1).max(300).optional(),
  /** Existing script entry, or a fixed module-local native/interpreted artifact and literal arguments. */
  entry: moduleEntrySchema,
  tools: z.array(moduleToolSchema).max(30).default([]),
  /** Run from activation and restart on exit (long connections); otherwise started per event and stopped when idle. */
  keepAlive: z.boolean().default(false),
  /** Receive on("activated") once per active version and when a module it `uses` changes version (e.g. to call web.page-set). */
  activated: z.boolean().default(false),
  /** A private file directory at `chrona.paths.content`, kept with the module's data (v2-8: no longer shown to the user or the Provider; expose files through tools). */
  content: z.boolean().default(false),
  /**
   * Serves HTTP under this path (v2-4 entry modules): `chrona.serve` binds authenticated HTTP on an ephemeral IPv4 loopback port and reports it over the module channel
   * and Chrona proxies authenticated requests to it, without `Authorization` and `Cookie`. One active module per path;
   * kernel paths (`/api/steward*`, `/api/workspaces`, `/api/health`) are reserved. Requires keepAlive.
   * `"/"` is the web page: every GET/HEAD outside /api, /health and /ready, unauthenticated (pages carry no data;
   * the browser holds the user's key), so its module is an entry module (see isEntryModule).
   * Several paths as an array (v2-8: the web page at "/" and its data API under /api/web).
   */
  listen: z.union([listenPath, z.array(listenPath).min(1).max(4)]).optional(),
  /**
   * Module tools this module calls through Chrona (`chrona.call`); approved with the version like any capability.
   * `"*"`: every tool open to the user (`owner` visibility), for entry modules that offer all apps to the user (web, MCP).
   */
  uses: z.array(z.union([interfaceRefSchema, z.literal("*")])).max(40).default([]),
  /** Explicit owner authority, granted only through checked version activation. */
  authority: z.literal("owner").optional(),
  /**
   * System programs already installed on the host, named by their executable names. Language libraries come from lockfiles instead (package.json + bun.lock, pyproject.toml + uv.lock), which
   * Chrona installs at build time; `node_modules`, `.venv` and `.chrona` are never submitted.
   */
  packages: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,80}$/)).max(20).default([]),
  /**
   * Kernel-held credentials an approved module may read through its declared names. The user sets them on the page or with `chrona admin secret-set`.
   * A name alone, or (v2-16 §2.1) the fields the page should ask for: fixed `fields`, `extraFields` for user-named keys (one per account), `oauth` for a kernel-run authorization (v2-30 §4).
   */
  secrets: z.array(z.union([SECRET_NAME_SCHEMA, secretSpecSchema])).max(50).default([]),
  /** Hard per-event limits for completion runs; Provider owns model selection. */
  model: z.object({ tier: modelTier.optional(), maxCalls: z.number().int().min(1).max(20), maxOutputTokens: z.number().int().min(1).max(32_000) }).strict().optional(),
  effects: z.array(z.enum(MODULE_EFFECTS)).max(MODULE_EFFECTS.length),
  params: z.record(slug, z.object({ type: z.enum(["number", "string", "boolean"]), value: z.union([z.number(), z.string().max(2000), z.boolean()]) }).strict()).default({}),
  data: z.object({ schema: z.number().int().min(1), migrate: z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/).optional() }).strict().default({ schema: 1 }),
  tests: z.array(z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/)).min(1).max(10),
}).strict().superRefine((manifest, ctx) => {
  for (const [key, param] of Object.entries(manifest.params)) {
    if (typeof param.value !== param.type) ctx.addIssue({ code: "custom", path: ["params", key, "value"], message: "Value must match parameter type" });
  }
  if (!manifest.tools.length && !manifest.keepAlive) ctx.addIssue({ code: "custom", path: ["tools"], message: "A module needs a tool or keepAlive" });
  if (new Set(manifest.effects).size !== manifest.effects.length) ctx.addIssue({ code: "custom", path: ["effects"], message: "Effects must be unique" });
  const names = secretNames(manifest);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: ["secrets"], message: "Secret names must be unique" });
  if (SYSTEM_MODULES.includes(manifest.name as (typeof SYSTEM_MODULES)[number])) ctx.addIssue({ code: "custom", path: ["name"], message: "Name is reserved for a Chrona system module" });
}).superRefine((manifest, ctx) => {
  if (new Set(manifest.uses).size !== manifest.uses.length) ctx.addIssue({ code: "custom", path: ["uses"], message: "Uses must be unique" });
  if (manifest.listen && !manifest.keepAlive) ctx.addIssue({ code: "custom", path: ["listen"], message: "listen requires keepAlive" });
  if (listenPaths(manifest).some(own => RESERVED_LISTEN_PATHS.some(path => own === path || own.startsWith(`${path}-`)))) ctx.addIssue({ code: "custom", path: ["listen"], message: "Path is reserved by Chrona" });
  if (new Set(listenPaths(manifest)).size !== listenPaths(manifest).length) ctx.addIssue({ code: "custom", path: ["listen"], message: "Listen paths must be unique" });
  if (manifest.model && !grantedUses(manifest).some(target => target === "agent.run" || target === "*")) ctx.addIssue({ code: "custom", path: ["model"], message: "Model limits require agent.run" });
  const names = new Set<string>();
  manifest.tools.forEach((tool, index) => {
    if (names.has(tool.name)) ctx.addIssue({ code: "custom", path: ["tools", index, "name"], message: "Tool names must be unique" });
    names.add(tool.name);
    if (new Set(tool.visibility).size !== tool.visibility.length) ctx.addIssue({ code: "custom", path: ["tools", index, "visibility"], message: "Visibility must be unique" });
    for (const key of tool.parameters.required) if (!(key in tool.parameters.properties)) ctx.addIssue({ code: "custom", path: ["tools", index, "parameters", "required"], message: `Required parameter ${key} is not in properties` });
  });
});
/** HTTP hosting is independent of owner authority and dependency declarations. */
export const isEntryModule = (manifest: { listen?: string | readonly string[]; authority?: "owner" }) =>
  listenPaths(manifest).length > 0;
/**
 * v2 module channel (`CHRONA_IPC_ENDPOINT` + `CHRONA_IPC_TOKEN`, authenticated TCP loopback, JSON lines; see docs/module-wire.md). Modules import the SDK as
 * `chrona` and find their directories through `chrona.paths`, with or without a sandbox.
 * Chrona → module: an event `{ id, event }`; the module answers `{ id, result }` or `{ id, error }`.
 * Module → Chrona: a call `{ id, method, params }`; Chrona answers `{ id, result }` or `{ id, error }`.
 * Events of one module are delivered one at a time; calls made meanwhile belong to that event.
 */
const channelId = z.string().min(1).max(64);
const moduleResultSchema = z.json().optional().refine(value => value === undefined || new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262_144, "result must serialize to at most 256 KiB");
/** Statuses of a routed call: sync calls finish in place; async ones are stored and delivered by Chrona. */
export const CALL_STATUSES = ["queued", "running", "waiting", "succeeded", "failed", "unknown"] as const;
/** Who made a call, as Chrona recorded it (never supplied by the caller). `via` names the entry module behind an owner call. */
export const callerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("module"), module: slug, moduleId: z.string().max(128), hash: z.string().max(64) }).strict(),
  z.object({ kind: z.literal("provider"), runId: z.string().max(128) }).strict(),
  z.object({ kind: z.literal("owner"), via: slug.nullable() }).strict(),
  z.object({ kind: z.literal("kernel") }).strict(),
  /** A kernel service invoked internally. */
  z.object({ kind: z.literal("system"), module: slug }).strict(),
]);
export const moduleEventSchema = z.object({
  trigger: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("timer"), id: z.string().min(1).max(120), eventId: z.string(), timerId: z.string(), timerRevision: z.string(), scheduledAt: iso, firedAt: iso, payload: z.json() }).strict(),
    /** Retained private schedule delivery; no public schedule creation API. */
    z.object({ kind: z.literal("schedule"), id: slug, firedAt: iso, scheduleId: z.string().max(128).optional(), payload: z.record(z.string(), z.unknown()).optional() }).strict(),
    /**
     * A tool call. `caller` is who called it; `call` is set for routed calls: `key` is the caller's idempotency key
     * (async calls only), `attempt` counts deliveries of the same call, `chain` lists the modules on the call path.
     */
    z.object({ kind: z.literal("tool"), id: slug, firedAt: iso, args: z.record(z.string(), z.unknown()),
      caller: callerSchema.optional(),
      call: z.object({ id: z.string().max(128), key: z.string().max(500).nullable(), attempt: z.number().int().min(1), chain: z.array(slug).max(16) }).strict().optional() }).strict(),
    /** The result of an async call this module made with `reply: true` (`id` is always "call"). */
    z.object({ kind: z.literal("call_result"), id: z.literal("call"), firedAt: iso, callId: z.string().max(128), target: routedTargetSchema, key: z.string().max(500),
      status: z.enum(["succeeded", "failed", "unknown"]), output: z.json().optional(), error: z.string().max(2000).optional() }).strict(),
    /** For manifests with `activated`: once per active version, and again when a module this one `uses` changes version (e.g. to call web.page-set). */
    z.object({ kind: z.literal("activated"), id: z.literal("activated"), firedAt: iso }).strict(),
  ]),
  now: iso,
  bindings: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
}).strict();
export const moduleEventMessageSchema = z.object({ id: channelId, event: moduleEventSchema }).strict();
export const MODULE_CALL_ERRORS = ["undeclared", "invalid", "internal",
  /** Routed calls: visibility, unknown target, cycles, uncertain outcomes and target errors. */
  "forbidden", "not_found", "conflict", "cycle", "unknown", "failed", "unavailable", "reauthorize",
  "unauthorized", "cursor_expired", "too_large", "capacity", "unsupported_version", "unsupported",
  /** Agent model failures propagated by the module SDK, including an unconfirmed completion deadline. */
  "unconfigured", "budget_exceeded", "provider_error", "timeout"] as const;
/** `result` answers a tool call. `handled` is ignored (it handed inbound items back before connectors were removed); kept so older modules still answer. */
export const moduleEventReplySchema = z.object({ id: channelId, result: z.object({ handled: z.boolean().optional(), result: moduleResultSchema }).strict().default({}) }).strict()
  .or(z.object({ id: channelId, error: z.string().max(2000), errorCode: z.enum(MODULE_CALL_ERRORS).optional(), errorReason: z.enum(PUBLIC_CALL_REASONS).optional() }).strict());
/** The credential names a manifest declares, whichever form each entry takes. */
export const secretNames = (manifest: { secrets?: readonly (string | { name: string })[] }) => (manifest.secrets ?? []).map(secret => typeof secret === "string" ? secret : secret.name);
export const SECRET_TARGETS = ["secrets.get", "secrets.authorize", "secrets.token"];
/** What a module calls: its `uses`, plus `secrets.get`, `secrets.authorize` and `secrets.token` when it lists `secrets` (v2-30 §4). */
export function grantedUses(manifest: { uses?: readonly string[]; secrets?: readonly unknown[] }): string[] {
  return [...new Set([...(manifest.uses ?? []), ...(manifest.secrets?.length ? SECRET_TARGETS : [])])];
}
/** Default notification application target; no kernel routing privilege. */
export const NOTIFY_INTERFACE = "notify.send";
/** Chrona's in-process system modules: reached by routed calls like modules, but part of Chrona (not proposable, not sandboxed). */
export const SYSTEM_MODULES = ["approvals", "modules", "settings", "secrets", "activity", "timers", "agent"] as const;
/** Longest call path; synchronous calls are refused when the target is already on their path (it is waiting). */
export const MAX_CALL_DEPTH = 6;
/** A saved registration may only call this exact app identity and tool contract; this grants no access. */
export const expectedModuleTargetSchema = z.object({ moduleId: z.string().min(1), contractHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ExpectedModuleTarget = z.infer<typeof expectedModuleTargetSchema>;
export const moduleCallSchema = z.discriminatedUnion("method", [
  /**
   * A routed call to another module's tool (`target` must be in `uses`). `sync` waits for the result (bounded by
   * `timeoutMs`); a timeout or crash after delivery is `unknown`, never retried. `async` stores the call under the
   * caller's idempotency `key` (a repeat returns the same call) and returns at once; Chrona delivers it, retrying only
   * deliveries that never reached the target, or `idempotent` targets. `reply` sends a `call_result` event back.
   */
  z.object({ id: channelId, method: z.literal("call"), params: z.object({
    target: routedTargetSchema, args: z.record(z.string(), z.json()).default({}), mode: z.enum(["sync", "async"]).default("sync"),
    key: z.string().min(1).max(200).optional(), reply: z.boolean().default(false), timeoutMs: z.number().int().min(1000).max(600_000).optional(), expectedTarget: expectedModuleTargetSchema.optional(),
  }).strict().refine(params => params.mode === "sync" || params.key !== undefined, "async calls need a key") }).strict(),
  /** State of an async call this module made. */
  z.object({ id: channelId, method: z.literal("callStatus"), params: z.union([z.object({ callId: z.string().min(1).max(128) }).strict(), z.object({ target: routedTargetSchema, key: z.string().min(1).max(200) }).strict()]) }).strict(),
]);
export const moduleCallReplySchema = z.object({ id: channelId, result: z.union([
  /** Sync `call` replies: the target's result. */
  z.object({ output: z.json() }).strict(),
  /** Async `call` and `callStatus` replies. */
  z.object({ callId: z.string().max(128), status: z.enum(CALL_STATUSES), duplicate: z.boolean().optional(), output: z.json().optional(), error: z.string().max(2000).optional() }).strict(),
]) }).strict()
  .or(z.object({ id: channelId, error: z.object({ code: z.enum(PUBLIC_CALL_ERRORS), reason: z.enum(PUBLIC_CALL_REASONS).optional(), message: z.string().max(500) }).strict() }).strict());
export type ModuleEvent = z.infer<typeof moduleEventSchema>;
export type ModuleCall = z.infer<typeof moduleCallSchema>;
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
export type ModuleEffect = (typeof MODULE_EFFECTS)[number];

export const scheduleSchema = z.object({
  id, mode: z.enum(SCHEDULE_MODES), rule: scheduleRuleSchema,
  /** Stored instruction for a private wake or module schedule. */
  text: z.string().max(4000),
  /** wake: the session the result is posted back to. */
  originSessionId: id.nullable(),
  moduleId: id.nullable(),
  /** Optional end: after this time the schedule stops. */
  until: iso.nullable(),
  status: z.enum(SCHEDULE_STATUSES), nextAt: iso.nullable(), lastAt: iso.nullable(), lastResult: z.string().max(2000).nullable(),
  /** Short user-facing name shown on pages; `text` of a wake is an internal instruction and is never primary UI. */
  label: z.string().max(80).nullable(),
  createdBy: z.enum(["user", "chrona", "module"]), createdAt: iso,
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
  origin: moduleOriginSchema, capabilities: moduleCapabilitiesSchema,
}).strict();

export const runSchema = z.object({
  id, sessionId: id.nullable(), lane: z.enum(RUN_LANES), trigger: z.enum(RUN_TRIGGERS), status: z.enum(RUN_STATUSES),
  provider: short, toolCalls: z.array(z.object({ tool: short, at: iso, ok: z.boolean() }).strict()).max(200),
  error: z.string().max(1000).nullable(), startedAt: iso.nullable(), endedAt: iso.nullable(), createdAt: iso,
  /** Short user-facing description (from the schedule or module that started it); null for conversation runs. */
  label: z.string().max(80).nullable(),
}).strict();

/** A file reference names its owning application; the reader verifies the actual origin identity. */
export const contentRefSchema = z.string().trim().min(3).max(542).regex(/^[a-z][a-z0-9-]{1,40}\//, "starts with an application name")
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
]);
export const grantSchema = z.object({
  id, action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), scope: grantScopeSchema,
  once: z.boolean(), consumedAt: iso.nullable(), expiresAt: iso.nullable(), createdAt: iso, revokedAt: iso.nullable(),
}).strict();
export const policyDecisionSchema = z.object({ action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), grantId: id.nullable(), reason: z.string().max(500) }).strict();

export const PREFERENCE_TOPICS = ["general", "ui"] as const;
export const preferenceSchema = z.object({ id, text: text.max(500), origin: z.enum(["said", "learned"]), topic: z.enum(PREFERENCE_TOPICS), createdAt: iso, lastUsedAt: iso.nullable() }).strict();

export const moduleModelSettingsSchema = z.object({
  maxCallsPerEvent: z.number().int().min(1).max(20), maxOutputTokens: z.number().int().min(1).max(32_000),
  /** All modules together per local day; `moduleDailyCalls` caps single modules (v2-17), absent ones only by this. */
  dailyCalls: z.number().int().min(1).max(10_000), eventTimeoutMs: z.number().int().min(5_000).max(600_000),
  moduleDailyCalls: z.record(slug, z.number().int().min(0).max(10_000)).optional(),
}).strict();
export const buildSettingsSchema = z.object({
  dailyLimit: z.number().int().min(0).max(200),
  timeoutMinutes: z.number().int().min(5).max(120),
  maxSubmissions: z.number().int().min(1).max(20),
}).strict();
export const settingsSchema = z.object({
  timezone: z.string().min(1).max(80),
  wake: wakeBudgetSchema.default({ minIntervalMs: 60_000, dailyLimit: 1000, moduleDailyLimit: 100 }),
  /** null: ordinary foreground/background Runs have no total execution deadline. */
  runTimeoutMinutes: z.number().int().min(1).max(525_600).nullable().default(null),
  /** null: modules cannot use the `model` effect (builds declaring it fail). */
  moduleModel: moduleModelSettingsSchema.nullable(),
}).strict();
export const healthSchema = z.object({
  provider: z.object({ name: short, available: z.boolean(), sandboxed: z.boolean(), lastError: z.string().max(500).nullable() }).strict(),
  /** Modules and the Provider run inside bubblewrap; false means they run unisolated as the Chrona user. */
  moduleSandbox: z.boolean(),
  queuedRuns: z.number().int().min(0), runningRuns: z.number().int().min(0), failedRunsToday: z.number().int().min(0),
  lastTickAt: iso.nullable(),
}).strict();

// ------------------------------------------------------------- requests ----

export const resolveApprovalSchema = z.object({ decision: z.enum(["approve", "deny"]), scope: z.enum(APPROVAL_SCOPES).default("once") }).strict();
export const createGrantSchema = z.object({ action: z.enum(ACTIONS), mode: z.enum(GRANT_MODES), scope: grantScopeSchema, expiresAt: iso.optional() }).strict();
export const updateSettingsSchema = z.object({ wake: wakeBudgetSchema.optional(), timezone: z.string().min(1).max(80).optional(), runTimeoutMinutes: settingsSchema.shape.runTimeoutMinutes.removeDefault().optional(), moduleModel: moduleModelSettingsSchema.nullable().optional() }).strict();

/** Short codes (e.g. QQ binding codes): no 0/O/1/I/L. */
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// ---------------------------------------------------------- Chrona tools ---
/**
 * Tools Chrona exposes to the Provider (Pi: through the Chrona extension bridge; MCP later).
 * Everything else (files, shell, web) is the Provider's own.
 */
export const chronaToolInputSchemas = {
  /** Internal build result; application conversations use their own routed tools. */
  chrona_reply: z.object({ text: text.max(8000), files: z.array(relativePathSchema).max(10).default([]).describe("Files written in this build's actual working directory, copied into the receiving application's content; at most 20 MiB each.") }).strict(),
} as const;
/** Shared inputs used by the public modules router; candidate inputs are exported separately. */
export const modulesToolInputSchemas = {
  describe: pageInput.extend({ target: routedTargetSchema.optional(), query: z.string().optional(), audience: z.enum(["caller", "user"]).default("caller") }),
  rollback: z.object({ moduleId: z.string().min(1), hash: moduleVersionHashSchema, reason: z.string().min(1) }).strict(),
} as const;
export const CHRONA_TOOLS = Object.keys(chronaToolInputSchemas) as (keyof typeof chronaToolInputSchemas)[];

export * from "./local-runtime";

// ---------------------------------------------------------------- ports ----

/** Provider adapter (Pi first). Chrona owns when and where a run happens; the Provider owns how it works. */
export type ProviderRunInput = {
  runId: string; token: string; lane: RunLane; cwd: string; sessionDir: string; sessionId: string | null;
  prompt: string; images?: { mime: string; base64: string }[]; deadline: Date | null;
  /** Trusted platform instructions; module/user task text belongs in prompt, never here. */
  systemPrompt: string;
  /** Legacy resource hint; user-selected Provider resources remain available. */
  resources: "configured" | "minimal";
  /** Backend-specific options; cannot change kernel-bound Run identity or authority. */
  providerOptions?: Record<string, unknown>;
  /** Exact provider/model for an owner-authorized build; must be verified before any prompt. */
  model?: string;
  /** Module tool names (m_*) declared up front; Providers with tool allowlists must admit them. */
  extraTools?: string[];
  /** The catalog also has deferred module tools (m_*); Providers should admit them behind their tool search. */
  searchTools?: boolean;
  /** Absolute host paths the user approved for this run (read-write). */
  hostPaths?: string[];
  /** Provider-owned read-only content snapshots mounted at <cwd>/content/<name>. */
  content?: { name: string; dir: string; writable: boolean }[];
  /** Safe summaries and explicit, run-bound UI requests; never raw thinking or tool payloads. */
  events?: ProviderEvents;
  /** F binds this execution and its trusted principal before handing details to the Provider. */
  execution?: import("./execution").ExecutionRef;
  detail?: import("./execution-events").ExecutionDetailSink;
  /** Enforced by the existing Pi extension before native tool execution, never prompt-only. */
  executionBudget?: { maxToolCalls: number };
};
export type ProviderTranscriptItem =
  | { at: string; kind: "text"; text: string }
  | { at: string; kind: "tool"; tool: string; args: string }
  | { at: string; kind: "result"; tool: string; text: string; error: boolean };
export type ProviderAdapter = {
  name: string;
  supportsRunModel?: boolean;
  health(): Promise<{ available: boolean; sandboxed: boolean; error: string | null }>;
  /** Internal adapter completion: no tools, session or fallback model. Public callers use agent.run with kind: completion. */
  complete?(input: { model: string; thinking?: (typeof THINKING_LEVELS)[number]; system?: string; prompt: string; maxOutputTokens: number; timeoutMs: number }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;
  /** Read normalized session history without exposing backend file formats to the kernel. */
  transcript?(input: { sessionDir: string; limit: number }): Promise<ProviderTranscriptItem[]>;
  /** Starts a run; returns a handle that can receive messages while running. */
  start(input: ProviderRunInput): { native?(request: Record<string, unknown>): Promise<Record<string, unknown>>; inject(message: string, images?: { mime: string; base64: string }[]): Promise<void>; abort(): Promise<void>; done: Promise<{ outcome: "finished" | "failed" | "timed_out" | "unavailable"; sessionId: string | null; error: string | null }> };
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
export type Settings = z.infer<typeof settingsSchema>;
export type Health = z.infer<typeof healthSchema>;

export * from "./module-candidates";

export * from "./agent";

export * from "./kernel-api";
