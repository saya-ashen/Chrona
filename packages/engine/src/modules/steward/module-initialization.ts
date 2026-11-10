import { moduleInitializationStateSchema, moduleInstallRequestSchema, PREINSTALLED_MODULE_NAMES, type ModuleInitializationState } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { installExternal, installationId, refreshInstallationReceipts } from "./module-install";
import { redactSensitiveText } from "@chrona/logging/redaction";
import { seedFactConsumer } from "./notification-facts";
import { isModulePaused, ModuleUnavailableError } from "./module-availability";

// These optional apps retain explicit skipped ledger entries, never default installation.
const initializationNames = [...new Set([...PREINSTALLED_MODULE_NAMES, "mind", "remind"] as const)];
const isPreinstalled = (name: string) => PREINSTALLED_MODULE_NAMES.some(preinstalled => preinstalled === name);
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
/** Recover selection from the persisted successful install, never from a same-name replacement. */
async function seedInitialFactConsumer(ports: StewardPorts, workspaceId: string) {
  await ports.db.$transaction(async tx => {
    const { state } = await read(tx, workspaceId);
    const installed = state?.packages.notify;
    if (installed?.status !== "installed" || !installed.moduleId || !installed.hash) return;
    const application = await tx.module.findFirst({ where: { id: installed.moduleId, workspaceId, name: "notify", builtin: false, status: "active", activeHash: installed.hash } });
    if (application) await seedFactConsumer(tx, workspaceId, application.id, ports.now());
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
    const initial: ModuleInitializationState = { version: 1, status: "pending", packages: Object.fromEntries(initializationNames.map(name => [name, {
      requestKey: `initialize:v1:${name}:1`, attempts: 1, status: "pending", moduleId: null, hash: null, approvalId: null, error: null,
    }])) as ModuleInitializationState["packages"] };
    // Existing external apps count as handled. Do not replace their custom code.
    for (const name of initializationNames) {
      const module = await tx.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
      if (!isPreinstalled(name)) initial.packages[name] = skippedOptionalPackage(name, { ...initial.packages[name], moduleId: module?.id ?? null });
      else if (module) initial.packages[name] = { ...initial.packages[name], status: "skipped", moduleId: module.id };
    }
    await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...stored.settings, [KEY]: initial } as Prisma.InputJsonValue } });
    return initial;
  });
  await recordOptionalPackages(ports, workspaceId, state);
  if (state.status === "complete") {
    await seedInitialFactConsumer(ports, workspaceId);
    return state;
  }
  for (const name of initializationNames) {
    const previous = state.packages[name];
    if (!isPreinstalled(name)) continue;
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
  if (initializationNames.every(name => ["installed", "skipped"].includes(state.packages[name].status))) {
    state.status = "complete";
    await save(ports, workspaceId, state);
  }
  await seedInitialFactConsumer(ports, workspaceId);
  return state;
}

async function recordOptionalPackages(ports: StewardPorts, workspaceId: string, state: ModuleInitializationState) {
  for (const name of initializationNames) {
    if (!isPreinstalled(name) && state.packages[name].status !== "skipped") {
      state.packages[name] = skippedOptionalPackage(name, state.packages[name]);
      await save(ports, workspaceId, state);
    }
  }
}
function skippedOptionalPackage(name: string, previous: ModuleInitializationState["packages"]["notify"]): ModuleInitializationState["packages"]["notify"] {
  if (!isModulePaused(name)) return { ...previous, status: "skipped", error: null };
  const { reason, message } = new ModuleUnavailableError(name);
  return { ...previous, status: "skipped", error: { code: "unavailable", reason, message } };
}
async function initializePackage(ports: StewardPorts, workspaceId: string, name: typeof initializationNames[number], previous: ModuleInitializationState["packages"][typeof name]): Promise<ModuleInitializationState["packages"][typeof name]> {
  try {
    // A retry can start as an install and acquire its moduleId while building. Resume
    // that receipt's original mode rather than turning the same requestKey into an update.
    const receipt = await ports.db.moduleInstallation.findUnique({ where: { id: installationId(workspaceId, previous.requestKey) } });
    const mode = receipt ? moduleInstallRequestSchema.shape.mode.parse(receipt.mode) : previous.attempts > 1 && previous.moduleId ? "update" : "install";
    const result = await installExternal(ports, workspaceId, { package: name, mode, requestKey: previous.requestKey });
    return {
      requestKey: result.requestKey, attempts: previous.attempts, status: result.status, moduleId: result.moduleId, hash: result.hash, approvalId: result.approvalId, error: result.error,
    };
  } catch (error) {
    return { ...previous, status: "failed", error: { code: "failed", reason: "initialization_failed", message: error instanceof Error ? redactSensitiveText(error.message).slice(0, 1000) : "Initialization failed" } };
  }
}
