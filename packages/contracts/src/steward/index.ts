/**
 * Chrona shared contract, platform v2. Supervisor-owned.
 * Design: docs/zh/architecture.md. Chrona's features are modules (apps) that keep their files private
 * and interact only through routed calls. Provider execution contexts belong to their approved application.
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

const id = z.string().trim().min(1).max(128);
const iso = z.string().datetime({ offset: true }).max(40);
const short = z.string().trim().min(1).max(200);
/** Relative path inside a content area or session directory: no `..`, no leading slash, not under `.git`. */
export const relativePathSchema = z.string().trim().min(1).max(500)
  .refine(p => !p.startsWith("/") && !p.split("/").some(s => s === ".." || s === "" || s === ".git"), "invalid path");

// ---------------------------------------------------------------- vocab ----

export const RUN_LANES = ["foreground", "background"] as const;
export const RUN_TRIGGERS = ["message", "schedule", "source", "edit", "approval", "retry"] as const;
export const APPROVAL_STATUSES = ["open", "approved", "denied", "expired"] as const;
/** Private approval resolution is once-only. */
export const APPROVAL_SCOPES = ["once"] as const;

/** Approval records for governed module changes and application-requested decisions. */
export const ACTIONS = ["activate_module", "delete_data", "modify_external"] as const;

export const RUN_LIMITS = {
  maxChronaToolCalls: 60, maxRunsPerSessionPerDay: 24, maxRunsPerDay: 200, maxFailures: 3,
  jobTimeoutMs: 60_000, jobOutputBytes: 64 * 1024,
} as const;

export type RunLane = (typeof RUN_LANES)[number];
export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export type Action = (typeof ACTIONS)[number];

// ------------------------------------------ private schedule and manifest ---

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
  /** Receive activation once per active version and when a declared dependency changes version. */
  activated: z.boolean().default(false),
  /** A private file directory at `chrona.paths.content`, kept with the module's data (v2-8: no longer shown to the user or the Provider; expose files through tools). */
  content: z.boolean().default(false),
  /**
   * Serves HTTP under this path (v2-4 entry modules): `chrona.serve` binds authenticated HTTP on an ephemeral IPv4 loopback port and reports it over the module channel
   * and Chrona forwards requests with an internal transport token. The application authenticates its own clients;
   * Authorization, Cookie and Set-Cookie remain application-owned. One active module per path.
   * Kernel paths (`/api/steward*`, `/api/workspaces`, `/api/health`) are reserved. Requires keepAlive.
   * `"/"` receives GET/HEAD outside /api, /health and /ready. An array declares several listener paths.
   */
  listen: z.union([listenPath, z.array(listenPath).min(1).max(4)]).optional(),
  /**
   * Module tools this module calls through Chrona (`chrona.call`); approved with the version like any capability.
   * `"*"` declares all tools visible to the caller; it never grants owner authority.
   */
  uses: z.array(z.union([interfaceRefSchema, z.literal("*")])).default([]),
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
  tests: z.array(z.string().regex(/^[A-Za-z0-9_-]+\.(ts|py|sh)$/)).max(10).default([]),
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
const moduleResultSchema = z.json().optional();
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
    /**
     * A tool call. `caller` is who called it; `call` is set for routed calls: `key` is the caller's idempotency key
     * (async calls only), `attempt` counts deliveries of the same call, `chain` lists the modules on the call path.
     */
    z.object({ kind: z.literal("tool"), id: slug, firedAt: iso, args: z.record(z.string(), z.unknown()),
      caller: callerSchema.optional(),
      call: z.object({ id: z.string().max(128), key: z.string().max(500).nullable(), attempt: z.number().int().min(1), chain: z.array(slug).max(16), delegate: callerSchema.optional(), executionRunId: z.string().min(1).max(128).optional() }).strict().optional() }).strict(),
    /** The result of an async call this module made with `reply: true` (`id` is always "call"). */
    z.object({ kind: z.literal("call_result"), id: z.literal("call"), firedAt: iso, callId: z.string().max(128), target: routedTargetSchema, key: z.string().max(500),
      status: z.enum(["succeeded", "failed", "unknown"]), output: z.json().optional(), error: z.string().max(2000).optional() }).strict(),
    /** For activated manifests: once per active version and when a declared dependency changes. */
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
/** A result answers the exact tool call. */
export const moduleEventReplySchema = z.object({ id: channelId, result: z.object({ result: moduleResultSchema }).strict().default({}) }).strict()
  .or(z.object({ id: channelId, error: z.string().max(2000), errorCode: z.enum(MODULE_CALL_ERRORS).optional(), errorReason: z.enum(PUBLIC_CALL_REASONS).optional() }).strict());
/** The credential names a manifest declares, whichever form each entry takes. */
export const secretNames = (manifest: { secrets?: readonly (string | { name: string })[] }) => (manifest.secrets ?? []).map(secret => typeof secret === "string" ? secret : secret.name);
export const SECRET_TARGETS = ["secrets.get", "secrets.authorize", "secrets.token"];
/** What a module calls: its `uses`, plus `secrets.get`, `secrets.authorize` and `secrets.token` when it lists `secrets` (v2-30 §4). */
export function grantedUses(manifest: { uses?: readonly string[]; secrets?: readonly unknown[] }): string[] {
  return [...new Set([...(manifest.uses ?? []), ...(manifest.secrets?.length ? SECRET_TARGETS : [])])];
}
/** Default notification application target; no kernel routing privilege. */
/** Chrona's in-process system modules: reached by routed calls like modules, but part of Chrona (not proposable, not sandboxed). */
export const SYSTEM_MODULES = ["approvals", "modules", "settings", "secrets", "activity", "timers", "agent"] as const;
/** Longest call path; synchronous calls are refused when the target is already on their path (it is waiting). */
export const MAX_CALL_DEPTH = 6;
/** A saved registration may bind an exact app version as well as identity; this grants no access. */
export const expectedModuleTargetSchema = z.object({ moduleId: z.string().min(1), hash: z.string().min(1).optional() }).strict();
export type ExpectedModuleTarget = z.infer<typeof expectedModuleTargetSchema>;
export const moduleCallSchema = z.discriminatedUnion("method", [
  /**
   * A routed call to another module's tool (`target` must be in `uses`). `sync` waits for the result (bounded by
   * `timeoutMs`); a timeout or crash after delivery is `unknown`, never retried. `async` stores the call under the
   * caller's idempotency `key` (a repeat returns the same call) and returns at once; Chrona delivers it, retrying only
   * deliveries that never reached the target, or `idempotent` targets. `reply` sends a `call_result` event back.
   */
  z.object({ id: channelId, eventId: channelId.optional(), method: z.literal("call"), params: z.object({
    target: routedTargetSchema, args: z.record(z.string(), z.json()).default({}), mode: z.enum(["sync", "async"]).default("sync"),
    key: z.string().min(1).max(200).optional(), reply: z.boolean().default(false), timeoutMs: z.number().int().min(1000).max(600_000).optional(), expectedTarget: expectedModuleTargetSchema.optional(),
    delegations: z.record(z.string().min(1).max(120), routedTargetSchema).refine(value => Object.keys(value).length <= 100).optional(),
  }).strict().refine(params => params.mode === "sync" || params.delegations === undefined, "tool delegation requires a synchronous call").refine(params => params.mode === "sync" || params.key !== undefined, "async calls need a key") }).strict(),
  /** State of an async call this module made. */
  z.object({ id: channelId, eventId: channelId.optional(), method: z.literal("callStatus"), params: z.union([z.object({ callId: z.string().min(1).max(128) }).strict(), z.object({ target: routedTargetSchema, key: z.string().min(1).max(200) }).strict()]) }).strict(),
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

// ---------------------------------------------------------------- views ----

/** A module as an app: identity and state. */
export const appSchema = z.object({
  id, name: slug, description: z.string().max(300).nullable(), status: z.enum(["active", "paused"]), activeHash: z.string().max(64).nullable(),
  origin: moduleOriginSchema, capabilities: moduleCapabilitiesSchema,
}).strict();

/** A file reference names its owning application; the reader verifies the actual origin identity. */
export const contentRefSchema = z.string().trim().min(3).max(542).regex(/^[a-z][a-z0-9-]{1,40}\//, "starts with an application name")
  .refine(ref => relativePathSchema.safeParse(ref.slice(ref.indexOf("/") + 1)).success, "invalid path");
export const approvalSchema = z.object({
  id, action: z.enum(ACTIONS), moduleId: id.nullable(),
  title: short, detail: z.string().max(4000),
  /** Exactly what will be done, shown to the user (e.g. the email draft). */
  preview: z.string().max(20_000),
  status: z.enum(APPROVAL_STATUSES), createdAt: iso, resolvedAt: iso.nullable(),
}).strict();

export const moduleModelSettingsSchema = z.object({
  maxCallsPerEvent: z.number().int().min(1).max(20), maxOutputTokens: z.number().int().min(1).max(32_000),
  /** All modules together per local day; `moduleDailyCalls` caps single modules (v2-17), absent ones only by this. */
  dailyCalls: z.number().int().min(1).max(10_000), eventTimeoutMs: z.number().int().min(5_000).max(600_000),
  moduleDailyCalls: z.record(slug, z.number().int().min(0).max(10_000)).optional(),
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
export const updateSettingsSchema = z.object({ wake: wakeBudgetSchema.optional(), timezone: z.string().min(1).max(80).optional(), runTimeoutMinutes: settingsSchema.shape.runTimeoutMinutes.removeDefault().optional(), moduleModel: moduleModelSettingsSchema.nullable().optional() }).strict();

/** Shared inputs used by the public modules router; candidate inputs are exported separately. */
export const modulesToolInputSchemas = {
  describe: pageInput.extend({ target: routedTargetSchema.optional(), query: z.string().optional(), audience: z.enum(["caller", "user"]).default("caller") }),
  rollback: z.object({ moduleId: z.string().min(1), hash: moduleVersionHashSchema, reason: z.string().min(1) }).strict(),
} as const;

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
  tools?: import("./local-runtime").RuntimeStart["tools"];
  callTool?: (request: import("zod").infer<typeof import("./local-runtime").runtimeToolCallSchema>) => Promise<unknown>;
  /** The catalog also has deferred module tools (m_*); Providers should admit them behind their tool search. */
  searchTools?: boolean;
  /** Absolute host paths the user approved for this run (read-write). */
  hostPaths?: string[];
  /** Provider-owned read-only content snapshots mounted at <cwd>/content/<name>. */
  content?: { name: string; dir: string; writable: boolean }[];
  /** Safe summaries and explicit, run-bound UI requests; never raw thinking or tool payloads. */
  events?: ProviderEvents;
};
export type ProviderTranscriptItem =
  | { id?: string; at: string; kind: "text"; text: string; partial?: true }
  | { id?: string; at: string; kind: "tool"; tool: string; args: string; callId?: string }
  | { id?: string; at: string; kind: "result"; tool: string; text: string; error: boolean; callId?: string };
export type ProviderAdapter = {
  name: string;
  supportsRunModel?: boolean;
  health(): Promise<{ available: boolean; sandboxed: boolean; error: string | null }>;
  /** Internal adapter completion: no tools, session or fallback model. Public callers use agent.run with kind: completion. */
  complete?(input: { model: string; thinking?: (typeof THINKING_LEVELS)[number]; system?: string; prompt: string; maxOutputTokens: number; timeoutMs: number }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;
  /** Read normalized session history without exposing backend file formats to the kernel. */
  transcript?(input: { sessionDir: string; limit: number; runId?: string }): Promise<ProviderTranscriptItem[]>;
  /** Starts a run; returns a handle that can receive messages while running. */
  start(input: ProviderRunInput): { contextUsage?(): Promise<{ windowTokens: number | null; usedTokens: number | null }>; native?(request: Record<string, unknown>): Promise<Record<string, unknown>>; inject(message: string, images?: { mime: string; base64: string }[]): Promise<void>; abort(): Promise<void>; done: Promise<{ outcome: "finished" | "failed" | "timed_out" | "unavailable"; sessionId: string | null; error: string | null }> };
};

// ---------------------------------------------------------------- types ----

export type App = z.infer<typeof appSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Health = z.infer<typeof healthSchema>;

export * from "./module-candidates";

export * from "./agent";

export * from "./kernel-api";
