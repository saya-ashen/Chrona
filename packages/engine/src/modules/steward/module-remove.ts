import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
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
  const versions = await db.moduleVersion.findMany({ where: { moduleId: module.id, hash: module.activeHash ?? "" } });
  const manifest = moduleManifestSchema.safeParse(versions[0]?.manifest).data;
  if (manifest && isEntryModule(manifest)) throw new StewardError("conflict", `${module.name} 是入口应用，不能删除；可以停用`);
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
async function assertNoPendingWork(db: Db, module: Row) {
  const sessions = await db.session.findMany({ where: { workspaceId: module.workspaceId, OR: [{ moduleId: module.id }, { entryModuleId: module.id }] }, select: { id: true, status: true } });
  if (sessions.some(session => session.status === "active")) throw new StewardError("conflict", "应用仍有关联的活动会话，请先结束会话并核对结果");
  if (await db.run.count({ where: { workspaceId: module.workspaceId, sessionId: { in: sessions.map(session => session.id) }, status: { in: ["queued", "running"] } } })) throw new StewardError("conflict", "关联会话仍有排队或运行中的工作，请先停止并核对结果");
  const builds = await db.audit.findMany({ where: { workspaceId: module.workspaceId, kind: { in: ["build_request", "build_targets"] } }, select: { subjectId: true, details: true } });
  const targets = builds.filter(row => {
    const request = row.details as { name?: unknown; modules?: unknown } | null;
    return request?.name === module.name || Array.isArray(request?.modules) && request.modules.includes(module.name);
  }).flatMap(row => row.subjectId ? [row.subjectId] : []);
  if (await db.run.count({ where: { workspaceId: module.workspaceId, sessionId: { in: targets }, lane: "build", status: { in: ["queued", "running"] } } })) throw new StewardError("conflict", "应用仍有排队或运行中的构建，请先停止构建");
  if (await db.moduleInvocation.count({ where: { workspaceId: module.workspaceId, AND: [
    { OR: [{ callerModuleId: module.id }, { target: module.name }] },
    { OR: [{ status: { in: ["queued", "running", "waiting", "unknown"] } }, { reply: true, repliedAt: null }] },
  ] } })) throw new StewardError("conflict", "应用仍有未结束、结果未知的调用或未处理回调，请先核对调用结果");
  if (await db.moduleCall.count({ where: { moduleId: module.id, OR: [{ status: { in: ["queued", "running", "waiting", "unknown"] } }, { status: "failed", error: { in: ["unknown", "internal"] } }] } })) throw new StewardError("conflict", "应用仍有未核实的执行记录，请先核对已有结果");
}

export async function requestRemove(context: ModuleContext, moduleId: string, reason: string) {
  const module = await requireModule(context, context.db, moduleId);
  if (!module.activeHash) throw new StewardError("conflict", "Module has no active version");
  await assertRemovable(context.db, module);
  const approval = await createApprovals(context).create({ action: "delete_data", title: `删除应用 ${module.name}`.slice(0, 200), detail: reason.slice(0, 4000),
    payload: { kind: "module_remove", moduleId, hash: module.activeHash, name: module.name },
    preview: `删除 ${module.name}：它的数据、文件、定时、授权、设置和版本记录。删除前把数据、文件和当前代码备份到 Chrona 数据目录的 platform/removed/ 下；之后不能在 Chrona 内恢复，只能据备份重建。` });
  return { status: "pending_approval" as const, approvalId: approval.id };
}

const exists = (path: string) => stat(path).then(() => true, () => false);
export async function removeApproved(context: ModuleContext, action: ApprovedAction) {
  const { workspaceId, ports, platform } = context, { moduleId, hash, name } = moduleRemovePayloadSchema.parse(action.payload);
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
    for (const grant of await tx.grant.findMany({ where: { workspaceId, revokedAt: null } })) {
      if ((grant.scope as { moduleId?: unknown } | null)?.moduleId === moduleId) await tx.grant.update({ where: { id: grant.id }, data: { revokedAt: ports.now() } });
    }
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const settings = (workspace.settings ?? {}) as { moduleSettings?: Record<string, unknown> };
    if (settings.moduleSettings && name in settings.moduleSettings) {
      const { [name]: _removed, ...rest } = settings.moduleSettings;
      await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...settings, moduleSettings: rest } as Prisma.InputJsonValue } });
    }
    await tx.module.delete({ where: { id: moduleId } });
    await audit(tx, { workspaceId, actor: "user", kind: "module_removed", subjectId: moduleId, details: { name, hash, backup } });
  });
  for (const [from] of parts.slice(0, 2)) await rm(from, { recursive: true, force: true });
}
