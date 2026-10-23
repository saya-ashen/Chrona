import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema, isEntryModule } from "@chrona/contracts/steward";
import { createApprovals } from "./approvals";
import type { ApprovedAction } from "./ports";
import { consumeOnce, effectivePolicyIn } from "./grants";
import { StewardError } from "./errors";
import { expireModuleApprovals, requireModule, type ModuleContext } from "./module-context";
import { dataEmpty, snapshotAt, type Restore } from "./module-data";
import { activateIn, startMigration } from "./module-generation";
import { migrateData } from "./module-migration";

type ActivationAction = Omit<ApprovedAction, "grantId"> & { grantId: string | null };

function parseRestore(value: Prisma.JsonValue | undefined): Restore | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.schema !== "number" || !Number.isInteger(value.schema) || value.schema < 1 || typeof value.snapshotAt !== "string") throw new StewardError("invalid", "Invalid module restore approval");
  return { schema: value.schema, snapshotAt: value.snapshotAt };
}
async function checkApproval(context: ModuleContext, tx: Prisma.TransactionClient, action: ActivationAction, moduleId: string) {
  const { workspaceId, ports } = context;
  const approval = await tx.approval.findFirst({ where: { id: action.approvalId, workspaceId, action: "activate_module", status: "approved", moduleId, grantId: action.grantId } });
  if (!approval || JSON.stringify(approval.payload) !== JSON.stringify(action.payload)) throw new StewardError("conflict", "Module approval does not match");
  for (const action of ["activate_module", "notify_user"] as const) {
    const decision = await effectivePolicyIn(tx, workspaceId, action, { moduleId }, ports.now());
    if (decision.mode === "never" || (action === "activate_module" && decision.mode === "ask")) throw new StewardError("forbidden", "Policy no longer allows module activation");
  }
  if (action.grantId) await consumeOnce(tx, workspaceId, action.grantId, ports.now());
}
async function approvedVersion(tx: Prisma.TransactionClient, moduleId: string, hash: string, restore?: Restore, rollback = false) {
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
  if (!version || version.status !== (restore || rollback ? "approved" : "pending_review")) throw new StewardError("conflict", restore || rollback ? "Module version is not approved" : "Module version is not pending review");
  return version;
}
async function prepareApproved(context: ModuleContext, tx: Prisma.TransactionClient, action: ActivationAction, target: { moduleId: string; hash: string; restore?: Restore; rollback?: boolean }) {
  const { moduleId, hash, restore } = target;
  const module = await requireModule(context, tx, moduleId);
  if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
  await checkApproval(context, tx, action, module.id);
  const version = await approvedVersion(tx, moduleId, hash, restore, target.rollback);
  const manifest = moduleManifestSchema.parse(version.manifest), from = module.dataSchema, to = manifest.data.schema;
  if (restore && (restore.schema !== to || await snapshotAt(context, moduleId, to) !== restore.snapshotAt)) throw new StewardError("conflict", "Module restore snapshot is missing or changed");
  if (restore || (from !== null && to > from && !await dataEmpty(join(context.platform, "data", moduleId)))) {
    await startMigration(context, tx, moduleId, hash, { from, to });
    return { module, version, manifest, from, to };
  }
  await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
  await tx.module.update({ where: { id: moduleId }, data: { dataSchema: to } });
  await activateIn(context, tx, moduleId, hash, target.rollback ? "rollback" : "activate");
  return null;
}
export async function activateApprovedIn(context: ModuleContext, tx: Prisma.TransactionClient, action: ActivationAction) {
  const payload = action.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.kind !== "activate_module") return;
  if (action.workspaceId !== context.workspaceId || typeof payload.moduleId !== "string" || typeof payload.hash !== "string") throw new StewardError("invalid", "Invalid module approval");
  const { moduleId, hash } = payload, restore = parseRestore(payload.restore);
  return prepareApproved(context, tx, action, { moduleId, hash, restore, rollback: payload.rollback === true });
}
export async function onApproved(context: ModuleContext, action: ApprovedAction) {
  const prepared = await context.db.$transaction(tx => activateApprovedIn(context, tx, action));
  if (!prepared) return;
  const payload = action.payload as Prisma.JsonObject, restore = parseRestore(payload.restore);
  await migrateData(context, prepared, restore || payload.rollback === true ? "rollback" : "activate", restore);
}
async function prepareRollback(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string) {
  const module = await requireModule(context, tx, moduleId);
  if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
  if (!version || version.status !== "approved") throw new StewardError("conflict", "Module version is not approved");
  const manifest = moduleManifestSchema.parse(version.manifest), from = module.dataSchema, to = manifest.data.schema;
  if (await dataEmpty(join(context.platform, "data", moduleId)) || to === from) {
    await tx.module.update({ where: { id: moduleId }, data: { dataSchema: to } });
    return { generation: await activateIn(context, tx, moduleId, hash, "rollback") };
  }
  if (from !== null && to < from) {
    const at = await snapshotAt(context, moduleId, to);
    if (!at) throw new StewardError("conflict", `没有 schema ${to} 的数据快照，无法回滚到该版本`);
    return { restore: { schema: to, snapshotAt: at }, module };
  }
  await startMigration(context, tx, moduleId, hash, { from, to });
  return { migration: { module, version, manifest, from, to } };
}
export async function rollback(context: ModuleContext, moduleId: string, hash: string) {
  const module = await requireModule(context, context.db, moduleId);
  const version = await approvedVersion(context.db, moduleId, hash, undefined, true);
  const active = module.activeHash ? await context.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: module.activeHash } } }) : null;
  if (isEntryModule(moduleManifestSchema.parse(version.manifest)) || (active && isEntryModule(moduleManifestSchema.parse(active.manifest)))) {
    if (module.status === "migrating") throw new StewardError("conflict", "Module is migrating");
    const schema = moduleManifestSchema.parse(version.manifest).data.schema;
    const needsRestore = module.dataSchema !== null && schema < module.dataSchema && !await dataEmpty(join(context.platform, "data", moduleId));
    const at = needsRestore ? await snapshotAt(context, moduleId, schema) : null;
    if (needsRestore && !at) throw new StewardError("conflict", `没有 schema ${schema} 的数据快照，无法回滚到该版本`);
    const restore = at ? { schema, snapshotAt: at } : undefined;
    await expireModuleApprovals(context, moduleId);
    const approval = await createApprovals(context).create({ moduleId, action: "activate_module", title: `回滚模块 ${module.name}`, detail: "入口模块回滚需要救援控制台批准", payload: { kind: "activate_module", moduleId, hash, rollback: true, ...(restore ? { restore } : {}) }, preview: `${restore ? `将恢复 ${at} 的数据，此后写入的数据会丢失；当前数据会另存为 before-rollback-<iso>。\n` : ""}hash: ${hash}` });
    return { status: "pending_approval" as const, approvalId: approval.id };
  }
  const prepared = await context.db.$transaction(tx => prepareRollback(context, tx, moduleId, hash));
  if (prepared.restore) {
    await expireModuleApprovals(context, moduleId);
    const approval = await createApprovals(context).create({ moduleId: prepared.module.id, action: "activate_module", title: `回滚模块 ${prepared.module.name}`, detail: "恢复旧版本的数据快照", payload: { kind: "activate_module", moduleId, hash, restore: prepared.restore }, preview: `将恢复 ${prepared.restore.snapshotAt} 的数据，此后写入的数据会丢失；当前数据会另存为 before-rollback-<iso>。\nhash: ${hash}` });
    return { status: "pending_approval" as const, approvalId: approval.id };
  }
  if (prepared.migration) await migrateData(context, prepared.migration, "rollback");
  return { status: "active" as const, moduleId, activeHash: hash };
}
