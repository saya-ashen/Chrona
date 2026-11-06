import { moduleInitializationStateSchema, PREINSTALLED_MODULE_NAMES, type ModuleInitializationState } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { installExternal, refreshInstallationReceipts } from "./module-install";
import { redactSensitiveText } from "@chrona/logging/redaction";

const KEY = "moduleInitialization";
const settingsObject = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
async function read(tx: Prisma.TransactionClient, workspaceId: string) {
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const settings = settingsObject(workspace.settings);
  // Corrupt persisted state fails closed: never silently reset and resurrect removed apps.
  return { settings, state: settings[KEY] === undefined ? null : moduleInitializationStateSchema.parse(settings[KEY]) };
}
async function save(ports: StewardPorts, workspaceId: string, state: ModuleInitializationState) {
  await ports.db.$transaction(async tx => {
    const { settings } = await read(tx, workspaceId);
    await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...settings, [KEY]: state } as Prisma.InputJsonValue } });
  });
}
const inflight = new WeakMap<StewardPorts["db"], Map<string, Promise<ModuleInitializationState>>>();
/** Persist the fixed preinstall list before enqueueing. This only calls a bounded queue adapter, never runs a build. */
export function ensureWorkspaceInitialized(ports: StewardPorts, workspaceId: string, options: { retryFailed?: boolean } = {}): Promise<ModuleInitializationState> {
  let active = inflight.get(ports.db);
  if (!active) { active = new Map(); inflight.set(ports.db, active); }
  const existing = active.get(workspaceId);
  if (existing) return existing;
  const promise = initialize(ports, workspaceId, options).finally(() => active!.delete(workspaceId));
  active.set(workspaceId, promise);
  return promise;
}
async function initialize(ports: StewardPorts, workspaceId: string, options: { retryFailed?: boolean }): Promise<ModuleInitializationState> {
  await refreshInstallationReceipts(ports, workspaceId);
  const state = await ports.db.$transaction(async tx => {
    const stored = await read(tx, workspaceId);
    if (stored.state) return stored.state;
    const initial: ModuleInitializationState = { version: 1, status: "pending", packages: Object.fromEntries(PREINSTALLED_MODULE_NAMES.map(name => [name, {
      requestKey: `initialize:v1:${name}:1`, attempts: 1, status: "pending", moduleId: null, hash: null, approvalId: null, error: null,
    }])) as ModuleInitializationState["packages"] };
    // Existing external apps count as handled. Do not replace their custom code.
    for (const name of PREINSTALLED_MODULE_NAMES) {
      const module = await tx.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
      if (module) initial.packages[name] = { ...initial.packages[name], status: "skipped", moduleId: module.id };
    }
    await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...stored.settings, [KEY]: initial } as Prisma.InputJsonValue } });
    return initial;
  });
  if (state.status === "complete") return state;
  for (const name of PREINSTALLED_MODULE_NAMES) {
    const previous = state.packages[name];
    if (["installed", "skipped"].includes(previous.status)) continue;
    // The recorded app was deliberately removed while initialization was pending.
    if (previous.moduleId && !await ports.db.module.findFirst({ where: { id: previous.moduleId, workspaceId } })) {
      state.packages[name] = { ...previous, status: "skipped" };
      await save(ports, workspaceId, state);
      continue;
    }
    if (["failed", "unavailable"].includes(previous.status)) {
      if (!options.retryFailed) continue;
      previous.attempts++;
      previous.requestKey = `initialize:v1:${name}:${previous.attempts}`;
      previous.status = "pending";
      await save(ports, workspaceId, state);
    }
    state.packages[name] = await initializePackage(ports, workspaceId, name, previous);
    await save(ports, workspaceId, state);
  }
  if (PREINSTALLED_MODULE_NAMES.every(name => ["installed", "skipped"].includes(state.packages[name].status))) {
    state.status = "complete";
    await save(ports, workspaceId, state);
  }
  return state;
}

async function initializePackage(ports: StewardPorts, workspaceId: string, name: typeof PREINSTALLED_MODULE_NAMES[number], previous: ModuleInitializationState["packages"][typeof name]): Promise<ModuleInitializationState["packages"][typeof name]> {
  try {
    const result = await installExternal(ports, workspaceId, { package: name, mode: previous.attempts > 1 && previous.moduleId ? "update" : "install", requestKey: previous.requestKey });
    return {
      requestKey: result.requestKey, attempts: previous.attempts, status: result.status, moduleId: result.moduleId, hash: result.hash, approvalId: result.approvalId, error: result.error,
    };
  } catch (error) {
    return { ...previous, status: "failed", error: { code: "failed", reason: "initialization_failed", message: error instanceof Error ? redactSensitiveText(error.message).slice(0, 1000) : "Initialization failed" } };
  }
}
