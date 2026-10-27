import { effectiveSettings, moduleManifestSchema, settingValueValid, tierTarget, type ModuleSetting } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError, listSystemModules, type Json } from "./module-calls";
import { createSecrets } from "./secrets";
import { addedCapabilities } from "./approval-level";
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
    secrets: (manifest?.secrets ?? []).map(secret => ({ name: secret, configured: secret === "qq_bot" || saved.has(secret), updatedAt: saved.get(secret) ?? null })),
    model: manifest?.model ? await moduleModelView(ports, workspaceId, module.name, manifest.model) : null,
    grants: grants.map(grant => ({ id: grant.id, action: grant.action, mode: grant.mode, once: grant.once, createdAt: grant.createdAt.toISOString() })),
    approvals: (await db.approval.findMany({ where: { workspaceId, moduleId: module.id }, orderBy: { createdAt: "desc" }, take: 10 }))
      .map(row => ({ id: row.id, title: row.title, level: row.level, status: row.status, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })),
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
async function settingsView(ports: StewardPorts, workspaceId: string, name: string) {
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
    return json({ kind: "system", ...(await systemApps(ports, workspaceId, name) as object), settings: await settingsView(ports, workspaceId, name), activity: await activity(name) });
  }
  const api = createModules(ports, workspaceId), found = await activeManifest(ports, workspaceId, name);
  if (!found) throw new CallError("not_found", `Module ${name} not found`);
  const app = (await api.list() as { id: string }[]).find(item => item.id === found.module.id) ?? null;
  const [diagnostics] = await api.diagnostics(found.module.name) as unknown[];
  return json({ kind: "app", app, permissions: await modulePermissions(ports, workspaceId, found.module.name), settings: await settingsView(ports, workspaceId, found.module.name),
    diagnostics: diagnostics ?? null, activity: await activity(found.module.name) });
}
