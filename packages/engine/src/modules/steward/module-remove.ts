import { fenceExecutionModule } from "./execution-delivery-controls";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { audit } from "./audit";
import { createApprovals } from "./approvals";
import { moduleRemovePayloadSchema } from "./module-remove-payload";
import { StewardError } from "./errors";
import { requireModule, type ModuleContext } from "./module-context";
import { moduleSupervisor } from "./module-supervisor";
import { setStatusIn } from "./module-status";
import type { ApprovedAction } from "./ports";
import { assertModuleOperation } from "./module-identity";
import { moduleGitPath } from "./module-git";
import { assertExecutionModuleIdle } from "./execution-module-guard";

/**
 * Removing an app deletes its records, data, files, grants and settings after a once-only `delete_data` approval.
 * It is never bound to the module row (which the removal deletes); a backup is kept first.
 */
type Db = Prisma.TransactionClient | ModuleContext["db"];
type Row = Awaited<ReturnType<typeof requireModule>>;

async function assertRemovable(db: Db, module: Row) {
  assertModuleOperation(module, "remove");
  await assertExecutionModuleIdle(db, module.id);
  if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
  await assertNoDependents(db, module);
  await assertNoPendingWork(db, module);
}
async function assertNoDependents(db: Db, module: Row) {
  const users = [];
  for (const other of await db.module.findMany({ where: { workspaceId: module.workspaceId, status: "active", id: { not: module.id }, activeHash: { not: null } } })) {
    const active = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: other.id, hash: other.activeHash! } } });
    if (moduleManifestSchema.safeParse(active?.manifest).data?.uses.some(target => target.startsWith(`${module.name}.`))) users.push(other.name);
  }
  if (users.length) throw new StewardError("conflict", `${users.join("、")} 正在调用 ${module.name}，先修改或删除它们`);
}
async function removalSessions(db: Db, module: Row) {
  const sessions = await db.session.findMany({ where: { workspaceId: module.workspaceId, OR: [{ moduleId: module.id }, { entryModuleId: module.id }] }, select: { id: true, status: true, source: true, moduleId: true } });
  const contexts = await db.agentContext.findMany({ where: { workspaceId: module.workspaceId, moduleId: module.id, sessionId: { in: sessions.map(session => session.id) } }, select: { sessionId: true } });
  const retainedContexts = new Set(contexts.map(row => row.sessionId));
  // Agent contexts retain continuation, not an application's private conversation state.
  // Their Runs and unknown-stop evidence still participate in every execution guard.
  const active = sessions.filter(session => session.status === "active");
  if (active.some(session => session.source !== "module" || session.moduleId !== module.id || !retainedContexts.has(session.id))) throw new StewardError("conflict", "应用仍有关联的活动会话，请先结束会话并核对结果");
  return sessions;
}
async function assertNoPendingWork(db: Db, module: Row) {
  const sessions = await removalSessions(db, module);
  if (await db.run.count({ where: { workspaceId: module.workspaceId, sessionId: { in: sessions.map(session => session.id) }, status: { in: ["queued", "running"] } } })) throw new StewardError("conflict", "关联会话仍有排队或运行中的工作，请先停止并核对结果");
  if (await db.moduleInvocation.count({ where: { workspaceId: module.workspaceId, AND: [
    { OR: [{ callerModuleId: module.id }, { target: module.name }] },
    { OR: [{ status: { in: ["queued", "running", "waiting", "unknown"] } }, { reply: true, repliedAt: null }] },
  ] } })) throw new StewardError("conflict", "应用仍有未结束、结果未知的调用或未处理回调，请先核对调用结果");
  if (await db.moduleCall.count({ where: { moduleId: module.id, OR: [{ status: { in: ["pending", "queued", "running", "waiting", "unknown"] } }, { status: "failed", error: { in: ["unknown", "internal"] } }] } })) throw new StewardError("conflict", "应用仍有未核实的执行记录，请先核对已有结果");
}

export async function requestRemove(context: ModuleContext, moduleId: string, reason: string) {
  const module = await requireModule(context, context.db, moduleId);
  if (!module.activeHash) throw new StewardError("conflict", "Module has no active version");
  assertModuleOperation(module, "remove");
  await fenceExecutionModule(context.ports, context.workspaceId, moduleId);
  await assertRemovable(context.db, module);
  const approval = await createApprovals(context).create({ action: "delete_data", title: `删除应用 ${module.name}`.slice(0, 200), detail: reason.slice(0, 4000),
    payload: { kind: "module_remove", moduleId, hash: module.activeHash, name: module.name },
    preview: `删除 ${module.name}：它的数据、文件、定时、授权、设置和版本记录。删除前把数据、文件和当前代码备份到 Chrona 数据目录的 platform/removed/ 下；之后不能在 Chrona 内恢复，只能据备份重建。` });
  return { status: "pending_approval" as const, approvalId: approval.id };
}

const exists = (path: string) => stat(path).then(() => true, () => false);
export async function removeApproved(context: ModuleContext, action: ApprovedAction) {
  const { workspaceId, ports, platform } = context, { moduleId, hash, name } = moduleRemovePayloadSchema.parse(action.payload);
  const approved = await context.db.approval.findFirst({ where: { id: action.approvalId, workspaceId, action: "delete_data", status: "approved" } });
  if (!approved || JSON.stringify(approved.payload) !== JSON.stringify(action.payload)) throw new StewardError("conflict", "Removal approval does not match");
  const initial = await requireModule(context, context.db, moduleId);
  assertModuleOperation(initial, "remove");
  if (initial.activeHash !== hash) throw new StewardError("conflict", "Application version changed before removal");
  await fenceExecutionModule(ports, workspaceId, moduleId);
  await context.db.$transaction(async tx => {
    const approval = await tx.approval.findFirst({ where: { id: action.approvalId, workspaceId, action: "delete_data", status: "approved" } });
    if (!approval || JSON.stringify(approval.payload) !== JSON.stringify(action.payload)) throw new StewardError("conflict", "Removal approval does not match");
    const module = await requireModule(context, tx, moduleId);
    if (module.activeHash !== hash) throw new StewardError("conflict", "应用已更新，请重新申请");
    await assertRemovable(tx, module);
    await setStatusIn(context, tx, moduleId, "paused", "remove");
  });
  await moduleSupervisor(ports).reconcile();
  await moduleSupervisor(ports).settleModule(moduleId);
  const backup = join(platform, "removed", `${name}-${ports.now().toISOString().replace(/[:.]/g, "-")}`);
  const parts = [[join(platform, "data", moduleId), "data"], [join(platform, "content", moduleId), "content"], [join(platform, "store", hash), "code"], [moduleGitPath(platform, moduleId), "repository"]] as const;
  await mkdir(backup, { recursive: true });
  for (const [from, to] of parts) if (await exists(from)) await cp(from, join(backup, to), { recursive: true });
  await context.db.$transaction(async tx => {
    const current = await requireModule(context, tx, moduleId);
    if (current.activeHash !== hash || current.name !== name || current.status !== "paused") throw new StewardError("conflict", "应用在备份期间发生变化，请重新申请删除");
    await assertRemovable(tx, current);
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const settings = (workspace.settings ?? {}) as { moduleSettings?: Record<string, unknown> };
    if (settings.moduleSettings && name in settings.moduleSettings) {
      const { [name]: _removed, ...rest } = settings.moduleSettings;
      await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...settings, moduleSettings: rest } as Prisma.InputJsonValue } });
    }
    await tx.executionAuthority.updateMany({ where: { workspaceId, receiverModuleId: moduleId, revokedAt: null }, data: { revokedAt: ports.now() } });
    await tx.executionAttempt.updateMany({ where: { workspaceId, moduleId, stopConfirmedAt: { not: null } }, data: { moduleId: null } });
    await tx.moduleRemoval.create({ data: { moduleId, workspaceId, name, hash, createdAt: ports.now() } });
    await tx.module.delete({ where: { id: moduleId } });
    await audit(tx, { workspaceId, actor: "user", kind: "module_removed", subjectId: moduleId, details: { name, hash, backup } });
  });
  for (const [from] of parts.slice(0, 2)) await rm(from, { recursive: true, force: true });
}
