import { z } from "zod";

/** Reserved independently of database initialization. executions is reserved for P1 only. */
export const KERNEL_MODULE_NAMES = ["chat", "modules", "schedules", "provider", "approvals", "settings", "secrets", "activity", "content", "memory", "executions"] as const;
export const RESERVED_ENTRY_NAMES = ["rescue"] as const;
export const BUILTIN_MODULE_NAMES = ["web", "mcp", "files", "notify", "events"] as const;
export const PREINSTALLED_MODULE_NAMES = ["qq", "remind", "mind"] as const;
export const OPTIONAL_EXTERNAL_MODULE_NAMES = ["memory-local", "coding", "editor"] as const;
export const OFFICIAL_EXTERNAL_MODULE_NAMES = [...PREINSTALLED_MODULE_NAMES, ...OPTIONAL_EXTERNAL_MODULE_NAMES] as const;
export const MODULE_CONTRACT_VERSION = "m1-p0-v1";
export const moduleVersionHashSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const moduleOriginSchema = z.enum(["kernel", "builtin", "external"]);
export type ModuleOrigin = z.infer<typeof moduleOriginSchema>;
export const MODULE_OPERATIONS = ["build", "propose", "group", "activate", "update", "rollback", "remove", "install", "enable", "disable", "configure", "diagnose"] as const;
export type ModuleOperation = (typeof MODULE_OPERATIONS)[number];
export const moduleCapabilitiesSchema = z.object({
  build: z.boolean(), propose: z.boolean(), group: z.boolean(), activate: z.boolean(), update: z.boolean(), rollback: z.boolean(), remove: z.boolean(), install: z.boolean(),
  enable: z.boolean(), disable: z.boolean(), configure: z.boolean(), diagnose: z.boolean(),
}).strict();
export type ModuleCapabilities = z.infer<typeof moduleCapabilitiesSchema>;
/** Use existing routed error codes, with stable semantic reasons; never parse a translated message. */
export const MODULE_OPERATION_ERRORS = {
  immutable: { code: "forbidden", reason: "immutable_module" },
  reserved: { code: "forbidden", reason: "reserved_module_name" },
  identity: { code: "conflict", reason: "module_identity_conflict" },
  installed: { code: "conflict", reason: "module_already_installed" },
  missing: { code: "not_found", reason: "release_not_found" },
  invalid: { code: "invalid", reason: "invalid_release" },
  unavailable: { code: "unavailable", reason: "installer_unavailable" },
} as const;
export const moduleInstallRequestSchema = z.object({
  package: z.enum(OFFICIAL_EXTERNAL_MODULE_NAMES),
  mode: z.enum(["install", "update"]),
  requestKey: z.string().trim().min(1).max(120),
}).strict();
export type ModuleInstallRequest = z.infer<typeof moduleInstallRequestSchema>;
export const moduleInstallResultSchema = z.object({
  package: z.enum(OFFICIAL_EXTERNAL_MODULE_NAMES), requestKey: z.string(),
  status: z.enum(["pending", "building", "pending_approval", "installed", "failed", "unavailable"]),
  moduleId: z.string().nullable(), hash: moduleVersionHashSchema.nullable(), approvalId: z.string().nullable(),
  error: z.object({ code: z.enum(["invalid", "forbidden", "conflict", "not_found", "failed", "unavailable"]), reason: z.string(), message: z.string() }).strict().nullable(),
}).strict();
export type ModuleInstallResult = z.infer<typeof moduleInstallResultSchema>;
export const modulePackageCatalogSchema = z.array(z.object({
  name: z.enum(OFFICIAL_EXTERNAL_MODULE_NAMES), description: z.string().nullable(), available: z.boolean(), releaseHash: z.string().nullable(),
  moduleId: z.string().nullable(), installation: moduleInstallResultSchema.nullable(), error: z.string().nullable(),
  git: z.object({ repository: z.string().nullable(), branch: z.string(), commit: z.string().regex(/^[a-f0-9]{40}$/) }).strict().nullable().default(null),
}).strict());
export const moduleInitializationStateSchema = z.object({
  version: z.literal(1), status: z.enum(["pending", "complete"]),
  packages: z.record(z.enum(PREINSTALLED_MODULE_NAMES), z.object({
    requestKey: z.string(), attempts: z.number().int().min(1), status: z.enum(["pending", "building", "pending_approval", "installed", "failed", "unavailable", "skipped"]),
    moduleId: z.string().nullable(), hash: z.string().nullable(), approvalId: z.string().nullable(), error: moduleInstallResultSchema.shape.error,
  }).strict()),
}).strict();
export type ModuleInitializationState = z.infer<typeof moduleInitializationStateSchema>;

export const moduleUpstreamRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), moduleId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("fetch"), moduleId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("merge"), moduleId: z.string().min(1), commit: z.string().regex(/^[a-f0-9]{40}$/), baseHash: moduleVersionHashSchema, requestKey: z.string().trim().min(1).max(200) }).strict(),
]);
export type ModuleUpstreamRequest = z.infer<typeof moduleUpstreamRequestSchema>;
