import { z } from "zod";
import { effectiveSettings, moduleManifestSchema, moduleSettingSchema, settingValueValid, tierTarget, type ModuleSetting } from "@chrona/contracts/steward";
import { moduleDiagnosticsOutputSchema } from "./module-diagnostics";
import type { StewardPorts } from "./ports";
import { CallError, listSystemModules, normalizedToolInputSchema, type Json } from "./module-calls";
import { createSecrets } from "./secrets";
import { secretView, secretViewSchema } from "./secret-fields";
import { addedCapabilities } from "./module-capabilities";
import { createSettings, modelUsage, moduleModelSettings } from "./settings";
import { createNotificationsView, forwardSettings } from "./notify-user";
import { createModules } from "./modules";
import { listActivity } from "./activity";
import { systemApps } from "./system-apps";
import { audit } from "./audit";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;

/** v2-17: everything about one app's permissions and use, gathered for its page; storage stays where it is. */
export async function modulePermissions(ports: StewardPorts, workspaceId: string, name: string) {
  const { db } = ports, module = await db.module.findFirst({ where: { workspaceId, OR: [{ id: name }, { name }] } });
  if (!module) throw new CallError("not_found", `Module ${name} not found`);
  const version = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data ?? null;
  const saved = new Map((await createSecrets(ports.dataDir).list()).map(row => [row.name, row.updatedAt]));
  const grants = (await db.grant.findMany({ where: { workspaceId, revokedAt: null } })).filter(grant => (grant.scope as { moduleId?: string }).moduleId === module.id && !(grant.once && grant.consumedAt));
  return json({
    module: module.name, activeHash: module.activeHash,
    capabilities: manifest ? addedCapabilities(null, manifest) : [],
    secrets: await Promise.all((manifest?.secrets ?? []).map(async declared => {
      const name = typeof declared === "string" ? declared : declared.name;
      // Field names only (v2-16 §2.1); qq_bot comes from the service environment.
      const value = name === "qq_bot" ? null : await createSecrets(ports.dataDir).read(name).catch(() => null);
      return { name, configured: name === "qq_bot" || saved.has(name), updatedAt: saved.get(name) ?? null, ...secretView(declared, value) };
    })),
    model: manifest?.model ? await moduleModelView(ports, workspaceId, module.name, manifest.model) : null,
    grants: grants.map(grant => ({ id: grant.id, action: grant.action, mode: grant.mode, once: grant.once, createdAt: grant.createdAt.toISOString() })),
    approvals: (await db.approval.findMany({ where: { workspaceId, moduleId: module.id }, orderBy: { createdAt: "desc" }, take: 10 }))
      .map(row => ({ id: row.id, title: row.title, status: row.status, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })),
  });
}
async function moduleModelView(ports: StewardPorts, workspaceId: string, name: string, model: NonNullable<ReturnType<typeof moduleManifestSchema.parse>["model"]>) {
  const workspace = await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }), settings = moduleModelSettings(workspace.settings);
  const tier = settings?.models[model.tier], usage = (await modelUsage(ports.db, workspaceId, workspace.settings, ports.now())).find(row => row.module === name);
  return { tier: model.tier, target: tier === undefined ? null : tierTarget(tier), maxCallsPerEvent: model.maxCalls, dailyCap: settings?.moduleDailyCalls?.[name] ?? null, today: usage ?? { calls: 0, inputTokens: 0, outputTokens: 0 } };
}

/** v2-23: a module's user settings live in Settings under moduleSettings.<name>; a system module keeps its own. */
type Settings = Record<string, unknown>;
const stored = (settings: unknown, name: string) => ((settings as { moduleSettings?: Record<string, unknown> } | null)?.moduleSettings ?? {})[name];
async function workspaceSettings(ports: StewardPorts, workspaceId: string) {
  const value = (await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings;
  return (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Settings;
}
async function activeManifest(ports: StewardPorts, workspaceId: string, name: string) {
  const module = await ports.db.module.findFirst({ where: { workspaceId, OR: [{ id: name }, { name }] } });
  if (!module) return null;
  const version = module.activeHash ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  return { module, manifest: moduleManifestSchema.safeParse(version?.manifest).data ?? null };
}
export async function settingsView(ports: StewardPorts, workspaceId: string, name: string) {
  const settings = await workspaceSettings(ports, workspaceId), system = listSystemModules().find(module => module.name === name);
  if (system) return system.settings ? { declarations: system.settings.declarations, values: system.settings.read(settings) } : { declarations: {}, values: {} };
  const found = await activeManifest(ports, workspaceId, name);
  if (!found) throw new CallError("not_found", `Module ${name} not found`);
  const declarations = found.manifest?.settings ?? {};
  return { declarations, values: effectiveSettings(declarations, stored(settings, found.module.name)) };
}
function validValues(declarations: Record<string, ModuleSetting>, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CallError("invalid", "values must be a JSON object");
  const values = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    const setting = Object.hasOwn(declarations, key) ? declarations[key]! : undefined;
    if (!setting) throw new CallError("invalid", `Unknown setting ${key}`);
    if (!settingValueValid(setting, value)) throw new CallError("invalid", `${setting.label}: value is not allowed`);
  }
  return values;
}
/** `modules.settings-set`: validated against the active version's declarations; a system module applies its own. */
export async function setModuleSettings(ports: StewardPorts, workspaceId: string, name: string, raw: unknown) {
  const system = listSystemModules().find(module => module.name === name);
  const ctx = { db: ports.db, workspaceId, now: ports.now }, notifications = createNotificationsView(ports, workspaceId);
  if (system) {
    if (!system.settings) throw new CallError("invalid", `${name} has no settings`);
    const values = validValues(system.settings.declarations, raw);
    // Through the owner's settings service: the same validation and the settings_updated audit.
    await createSettings(ctx, { status: notifications.status, forward: (tx, value, at) => forwardSettings(tx, ports, workspaceId, value, at) }).update(system.settings.write(values));
    return json(await settingsView(ports, workspaceId, name));
  }
  const found = await activeManifest(ports, workspaceId, name);
  if (!found?.manifest) throw new CallError("not_found", `Module ${name} has no active version`);
  const values = validValues(found.manifest.settings, raw), moduleName = found.module.name;
  await ports.db.$transaction(async tx => {
    const row = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } }), settings = (row.settings && typeof row.settings === "object" ? row.settings : {}) as Settings;
    const all = (settings.moduleSettings ?? {}) as Record<string, Record<string, unknown>>;
    await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...settings, moduleSettings: { ...all, [moduleName]: { ...all[moduleName], ...values } } } as never } });
    await audit(tx, { workspaceId, actor: "user", kind: "module_settings_updated", subjectId: found.module.id, details: { keys: Object.keys(values) } });
  });
  return json(await settingsView(ports, workspaceId, name));
}
/** `modules.overview`: everything about one app for its page, in one read (v2-23). */
export async function moduleOverview(ports: StewardPorts, workspaceId: string, name: string) {
  const activity = async (module: string) => (await listActivity(ports, workspaceId, { module, limit: 30 })).items;
  if (listSystemModules().some(module => module.name === name)) {
    const app = await systemApps(ports, workspaceId, name) as { tools: unknown[] };
    const system = listSystemModules().find(module => module.name === name)!;
    return json({ kind: "system", ...app, tools: system.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: "input" in tool && tool.input ? z.toJSONSchema(tool.input) : normalizedToolInputSchema(tool),
      outputSchema: tool.output ? z.toJSONSchema(tool.output as z.ZodType) : null, examples: "examples" in tool ? tool.examples ?? null : null,
      sideEffects: "sideEffects" in tool ? tool.sideEffects ?? null : null, errors: "errors" in tool ? tool.errors ?? null : null, idempotent: tool.idempotent,
      retry: tool.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.", visibility: tool.visibility })),
      settings: await settingsView(ports, workspaceId, name), activity: await activity(name) });
  }
  const api = createModules(ports, workspaceId), found = await activeManifest(ports, workspaceId, name);
  if (!found) throw new CallError("not_found", `Module ${name} not found`);
  const app = (await api.list() as { id: string }[]).find(item => item.id === found.module.id) ?? null;
  const [diagnostics] = await api.diagnostics(found.module.name) as unknown[];
  return json({ kind: "app", app, tools: (found.manifest?.tools ?? []).filter(tool => tool.visibility.includes("owner") || tool.visibility.includes("modules")).map(tool => ({ name: tool.name, description: tool.description,
    inputSchema: normalizedToolInputSchema(tool), outputSchema: tool.output ?? null, examples: tool.examples ?? null, sideEffects: tool.sideEffects ?? null, errors: tool.errors ?? null,
    idempotent: tool.idempotent, retry: tool.idempotent ? "May be redelivered after an unknown async outcome; target declares idempotent." : "Unknown async outcomes are not redelivered automatically.", visibility: tool.visibility })),
    permissions: await modulePermissions(ports, workspaceId, found.module.name), settings: await settingsView(ports, workspaceId, found.module.name), diagnostics: diagnostics ?? null, activity: await activity(found.module.name) });
}

/** Declared outputs for the build reference (v2-23): what a page may rely on from overview and settings-set. */
const settingValue = z.union([z.number(), z.string(), z.boolean()]);
export const moduleSettingsOutputSchema = z.object({ declarations: z.record(z.string(), moduleSettingSchema), values: z.record(z.string(), settingValue) });
const activitySchema = z.object({ id: z.string(), at: z.string(), kind: z.string(), module: z.string().nullable(), text: z.string(), session: z.object({ id: z.string(), source: z.enum(["reflect", "build"]) }).optional() });
const overviewToolSchema = z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.json()), outputSchema: z.json().nullable(),
  examples: z.array(z.json()).nullable(),
  sideEffects: z.array(z.string()).nullable(), errors: z.array(z.object({ code: z.string(), description: z.string(), recovery: z.string() })).nullable(),
  idempotent: z.boolean(), retry: z.string(), visibility: z.array(z.string()) });
export const permissionsSchema = z.object({
  module: z.string(), activeHash: z.string().nullable(), capabilities: z.array(z.string()),
  secrets: z.array(z.object({ name: z.string(), configured: z.boolean(), updatedAt: z.string().nullable() }).extend(secretViewSchema.shape)),
  model: z.object({ tier: z.string(), target: z.unknown(), maxCallsPerEvent: z.number().optional(), dailyCap: z.number().nullable(), today: z.object({ calls: z.number(), inputTokens: z.number(), outputTokens: z.number() }).passthrough() }).nullable(),
  grants: z.array(z.object({ id: z.string(), action: z.string(), mode: z.string(), once: z.boolean(), createdAt: z.string() })),
  approvals: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), createdAt: z.string(), resolvedAt: z.string().nullable() })),
});
export const moduleOverviewOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app"), app: z.record(z.string(), z.unknown()).nullable(), tools: z.array(overviewToolSchema), permissions: permissionsSchema, settings: moduleSettingsOutputSchema, diagnostics: moduleDiagnosticsOutputSchema.element.nullable(), activity: z.array(activitySchema).max(30) }),
  z.object({ kind: z.literal("system"), name: z.string(), description: z.string(), sessions: z.string().nullable(),
    tools: z.array(overviewToolSchema),
    work: z.array(z.object({ id: z.string(), title: z.string().nullable(), status: z.string(), createdAt: z.string(), endedAt: z.string().nullable() })),
    settings: moduleSettingsOutputSchema, activity: z.array(activitySchema).max(30) }),
]);
export const MODULE_OVERVIEW_DOCUMENTATION = "One read for an app's page. kind \"app\": app is the modules.list item (null if not listed), tools are owner-visible declared interfaces with the same schemas and descriptive metadata as modules.reference, permissions is modules.permissions, settings the app's declared settings with effective values, diagnostics the modules.diagnostics entry or null, activity the latest 30 activity.list items. kind \"system\": the system app entry with its tools, work conversations, settings and activity. settings.values hold the stored value when it still fits the active declaration, else the default; both are {} when nothing is declared. Unknown name yields not_found. Examples are synthetic fixtures, never production data.";
export const MODULE_SETTINGS_SET_DOCUMENTATION = "values is a JSON object string of setting name to value; a partial object changes only those names. Every name and value is checked against the active version's declarations (system modules: their own) before anything is saved; one bad entry rejects the whole call with invalid (\"Unknown setting X\", \"<label>: value is not allowed\", values not an object, system module without settings). Unknown module or no active version yields not_found. On success returns the settings re-read after saving, same shape as overview.settings; compare it with what was sent. Audited by name only (module_settings_updated).";
const fixtureSettings = () => moduleSettingsOutputSchema.parse({ declarations: { interval: { type: "number", label: "Interval (minutes)", default: 30, min: 5, max: 1440 }, enabled: { type: "boolean", label: "Enabled", default: true } }, values: { interval: 60, enabled: true } });
export function moduleSettingsExamples() { return [json(fixtureSettings()), json(moduleSettingsOutputSchema.parse({ declarations: {}, values: {} }))]; }
export function moduleOverviewExamples() {
  const at = "2026-01-01T00:00:00.000Z", activity = [{ id: "fixture-activity", at, kind: "module_settings_updated", module: "example", text: "Synthetic: settings changed" }];
  return [
    moduleOverviewOutputSchema.parse({ kind: "app", app: { id: "fixture-module", name: "example", status: "active", activeHash: "a".repeat(64) },
      tools: [], permissions: { module: "example", activeHash: "a".repeat(64), capabilities: ["Synthetic capability"], secrets: [{ name: "example_token", configured: false, updatedAt: null, label: "Example API key", description: null, fields: [{ name: "apiKey", label: "API key", description: null, optional: false, plain: false, saved: false }], extraFields: null, savedFields: null, oauth: null }], model: null, grants: [], approvals: [] },
      settings: fixtureSettings(), diagnostics: null, activity }),
    moduleOverviewOutputSchema.parse({ kind: "system", name: "memory", description: "Synthetic system module", sessions: null, tools: [{ name: "recall", description: "Synthetic", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false }, outputSchema: null, examples: null, sideEffects: null, errors: null,
      idempotent: false, retry: "Unknown async outcomes are not redelivered automatically.", visibility: ["modules"] }], work: [],
      settings: { declarations: { provider: { type: "string", label: "Provider", default: "" } }, values: { provider: "" } }, activity: [] }),
  ].map(json);
}
