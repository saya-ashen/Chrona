import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
import { audit } from "./audit";
import { createApprovals } from "./approvals";
import { StewardError } from "./errors";
import { consumeOnce } from "./grants";
import { requireModule, type ModuleContext } from "./module-context";
import { moduleSupervisor } from "./module-supervisor";
import { setStatusIn } from "./module-status";
import type { ApprovedAction } from "./ports";

/**
 * v2-26: removing an app deletes its records, data, files, grants and settings. Always a red `delete_data` approval
 * (approved once, on the page), never bound to the module row (which the removal deletes); a backup is kept first.
 */
export const moduleRemovePayloadSchema = z.object({ kind: z.literal("module_remove"), moduleId: z.string(), hash: z.string(), name: z.string() }).strict();
type Db = Prisma.TransactionClient | ModuleContext["db"];
type Row = Awaited<ReturnType<typeof requireModule>>;

async function assertRemovable(db: Db, module: Row) {
  if (module.builtin) throw new StewardError("conflict", `${module.name} 是内置应用，不能删除；可以停用`);
  if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
  const versions = await db.moduleVersion.findMany({ where: { moduleId: module.id, hash: module.activeHash ?? "" } });
  const manifest = moduleManifestSchema.safeParse(versions[0]?.manifest).data;
  if (manifest && isEntryModule(manifest)) throw new StewardError("conflict", `${module.name} 是入口应用，不能删除；可以停用`);
  const users = [];
  for (const other of await db.module.findMany({ where: { workspaceId: module.workspaceId, status: "active", id: { not: module.id }, activeHash: { not: null } } })) {
    const active = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: other.id, hash: other.activeHash! } } });
    if (moduleManifestSchema.safeParse(active?.manifest).data?.uses.some(target => target.startsWith(`${module.name}.`))) users.push(other.name);
  }
  if (users.length) throw new StewardError("conflict", `${users.join("、")} 正在调用 ${module.name}，先修改或删除它们`);
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
    const approval = await tx.approval.findFirst({ where: { id: action.approvalId, workspaceId, action: "delete_data", status: "approved", grantId: action.grantId } });
    if (!approval || JSON.stringify(approval.payload) !== JSON.stringify(action.payload)) throw new StewardError("conflict", "Removal approval does not match");
    await consumeOnce(tx, workspaceId, action.grantId, ports.now());
    const module = await requireModule(context, tx, moduleId);
    if (module.activeHash !== hash) throw new StewardError("conflict", "应用已更新，请重新申请");
    await assertRemovable(tx, module);
    await setStatusIn(context, tx, moduleId, "paused", "remove");
  });
  // Its process stops before its files are copied and deleted.
  await moduleSupervisor(ports).reconcile();
  const backup = join(platform, "removed", `${name}-${ports.now().toISOString().replace(/[:.]/g, "-")}`);
  const parts = [[join(platform, "data", moduleId), "data"], [join(platform, "content", moduleId), "content"], [join(platform, "store", hash), "code"]] as const;
  await mkdir(backup, { recursive: true });
  for (const [from, to] of parts) if (await exists(from)) await cp(from, join(backup, to), { recursive: true });
  await context.db.$transaction(async tx => {
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
