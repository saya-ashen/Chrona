import type { Prisma } from "@chrona/db/generated/prisma/client";
import { expectedModuleTargetSchema, moduleManifestSchema, type ExpectedModuleTarget, type RoutedTarget } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { Caller, RoutedTool } from "./module-call-types";
import type { SystemModule } from "./module-system-types";
import { CallError } from "./module-call-error";
import { admitted } from "./module-call-admission";
import { isModulePaused, ModuleUnavailableError } from "./module-availability";
import { injectedModules, localModules, systemModules } from "./module-registry";

type Db = StewardPorts["db"] | Prisma.TransactionClient;

/** Target identity and delivery fences share one resolution policy. */
export type Target = { module: { id: string; name: string; activeHash: string; workspaceId: string }; tool: RoutedTool; system?: SystemModule };
export function assertExpectedTarget(resolved: Target | CallError, expected?: ExpectedModuleTarget) {
  if (!expected) return;
  const parsed = expectedModuleTargetSchema.safeParse(expected);
  if (!parsed.success) throw new CallError("invalid", "Invalid expected target identity");
  if (resolved instanceof CallError || resolved.module.id !== parsed.data.moduleId) throw new CallError("conflict", "Registered target identity changed; register again");
}
/** Kernel-only closure used at the supervisor's final never-sent boundary. */
export function targetFence(ports: StewardPorts, workspaceId: string, resolved: Target, caller: Caller) {
  return async () => {
    const current = await resolveTarget(ports.db, workspaceId, `${resolved.module.name}.${resolved.tool.name}`);
    try {
      assertExpectedTarget(current, { moduleId: resolved.module.id });
      if (current instanceof CallError || current.module.activeHash !== resolved.module.activeHash) throw new CallError("conflict", "Target activation changed before delivery");
      if (!await admitted(ports.db, caller, current.tool, workspaceId)) throw new CallError("forbidden", "Target no longer accepts this caller");
    } catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { stage: "unavailable" }); }
  };
}
export async function bindInvocationTarget(tx: Db, input: { workspaceId: string; callId: string; resolved: Target | CallError; target: string }) {
  const { workspaceId, callId, resolved, target } = input;
  // An unavailable known app still has an identity. Bind it before a later same-name reinstall can take over.
  const module = resolved instanceof CallError ? await tx.module.findFirst({ where: { workspaceId, name: splitTarget(target).module } }) : resolved.module;
  // Explicit null identity authorizes only a never-sent missing target to bind later; absence is legacy, not permission.
  const binding = { moduleId: module?.id ?? null };
  await tx.moduleInvocation.update({ where: { id: callId }, data: { targetBound: true, targetModuleId: binding.moduleId, targetContractHash: null } });
}
const differentBinding = (binding: { moduleId: string | null }, current: { moduleId: string }) =>
  binding.moduleId !== null && binding.moduleId !== current.moduleId;
const differentActivation = (active: Target | CallError, resolved: Target) =>
  active instanceof CallError || active.module.id !== resolved.module.id || active.module.activeHash !== resolved.module.activeHash;
export async function checkInvocationTarget(ports: StewardPorts, row: { id: string; workspaceId: string; leaseToken: string | null; target: string; tool: string }, resolved: Target) {
  return ports.db.$transaction(async tx => {
    const previous = await tx.moduleInvocation.findFirst({ where: { id: row.id, workspaceId: row.workspaceId, status: "running", leaseToken: row.leaseToken } });
    if (!previous?.targetBound) return false;
    const current = { moduleId: resolved.module.id };
    const binding = { moduleId: previous.targetModuleId };
    if (differentBinding(binding, current)) return false;
    // Resolve and claim the exact identity inside the transaction. Supervisor rechecks id/hash before sending.
    const active = await resolveTarget(tx, row.workspaceId, `${row.target}.${row.tool}`);
    if (differentActivation(active, resolved)) return false;

    await tx.moduleInvocation.update({ where: { id: row.id }, data: { idempotent: resolved.tool.idempotent, targetModuleId: current.moduleId, targetContractHash: null } });
    return true;
  });
}

export async function routedTargetName(db: Db, workspaceId: string, target: RoutedTarget) {
  if (typeof target === "string") return target;
  const module = await db.module.findFirst({ where: { id: target.moduleId, workspaceId }, select: { name: true } });
  if (!module) throw new CallError("not_found", "Application target not found");
  return `${module.name}.${target.tool}`;
}

export function splitTarget(target: string) {
  const [module, tool] = target.split(".");
  if (!module || !tool) throw new CallError("invalid", "Call target must be <module>.<tool>");
  return { module, tool };
}
async function localIdentityConflict(db: Db, workspaceId: string, name: string) {
  const installed = await db.module.findFirst({ where: { workspaceId, name }, select: { id: true, builtin: true } });
  if (!installed) return false;
  return true;
}
async function resolveReleaseTarget(db: Db, workspaceId: string, target: string, name: ReturnType<typeof splitTarget>): Promise<Target | CallError | null> {
  const injected = injectedModules.get(db)?.get(name.module);
  const local = injected ?? localModules.get(name.module), system = local ?? systemModules.get(name.module);
  if (!system) return null;
  if (local) {
    const conflict = await localIdentityConflict(db, workspaceId, name.module);
    if (conflict) return new CallError("conflict", `Local capability ${name.module} conflicts with an installed application`);
  }
  const tool = system.tools.find(candidate => candidate.name === name.tool);
  return tool ? { module: { id: `${local ? "local" : "system"}:${system.name}`, name: system.name, activeHash: "system", workspaceId }, tool, system } : new CallError("not_found", `Tool ${target} not found`);
}
export async function resolveTarget(db: Db, workspaceId: string, target: string): Promise<Target | CallError> {
  const name = splitTarget(target);
  if (isModulePaused(name.module)) return new ModuleUnavailableError(name.module);
  const release = await resolveReleaseTarget(db, workspaceId, target, name);
  if (release) return release;
  const module = await db.module.findFirst({ where: { workspaceId, name: name.module } });
  if (!module) return new CallError("not_found", `Module ${name.module} not found`);
  if (module.status !== "active" || !module.activeHash) return new CallError("unavailable", `Module ${name.module} is not active`);
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
  const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
  const tool = manifest?.tools.find(candidate => candidate.name === name.tool);
  if (!manifest || !tool) return new CallError("not_found", `Tool ${target} not found`);
  return { module: { ...module, activeHash: module.activeHash }, tool };
}

/** An id-based route must still resolve to that exact application. */
export function assertRoutedIdentity(requested: RoutedTarget, resolved: Target | CallError) {
  if (typeof requested !== "string" && (resolved instanceof CallError || requested.moduleId !== resolved.module.id)) throw new CallError("conflict", "Resolved target identity changed");
}
