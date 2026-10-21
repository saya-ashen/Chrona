import { join } from "node:path";
import type { StewardPorts } from "./ports";
import type { ApprovedAction } from "./approvals";
import { requireAffair } from "./affairs";
import { StewardError } from "./errors";
import { moduleContext, requireModule, type ModuleContext, type ModuleSource } from "./module-context";
import { propose } from "./module-proposal";
import { buildPending } from "./module-build";
import { onApproved, rollback } from "./module-activation";
import { activateIn } from "./module-generation";
import { recoverMigrations } from "./module-migration";
import { readModuleFiles } from "./module-preview";

async function list(context: ModuleContext, affairId?: string) {
  const { db, workspaceId } = context;
  if (affairId) await requireAffair(db, workspaceId, affairId);
  return db.module.findMany({ where: { workspaceId, affairId }, include: { versions: { select: { hash: true, status: true, intent: true, createdAt: true }, orderBy: { createdAt: "desc" } }, runs: { take: 5, orderBy: { createdAt: "desc" }, select: { id: true, hash: true, triggerId: true, firedAt: true, exitCode: true, error: true, createdAt: true } } } });
}
async function checkout(context: ModuleContext, moduleId: string, hash: string | undefined, dir: string) {
  const { db, workspaceId, store, fs } = context;
  const module = await requireModule(context, db, moduleId), selected = hash ?? module.activeHash;
  if (!selected || !await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: selected } } })) throw new StewardError("not_found", "Module version not found");
  const affair = await requireAffair(db, workspaceId, module.affairId);
  const files = await readModuleFiles(join(store, selected), "Unsafe module store file");
  await fs.forAffair(affair.dirName).checkoutModule(dir, files);
}
export function createModules(ports: StewardPorts, workspaceId: string) {
  const context = moduleContext(ports, workspaceId);
  return {
    propose: (input: Parameters<typeof propose>[1], source: ModuleSource) => propose(context, input, source),
    buildPending: (now = ports.now()) => buildPending(context, now),
    recoverMigrations: (now = ports.now()) => recoverMigrations(context, now),
    activate: (moduleId: string, hash: string, reason: "activate" | "rollback") => ports.db.$transaction(tx => activateIn(context, tx, moduleId, hash, reason)),
    onApproved: (action: ApprovedAction) => onApproved(context, action),
    rollback: (moduleId: string, hash: string) => rollback(context, moduleId, hash),
    list: (affairId?: string) => list(context, affairId),
    checkout: (moduleId: string, hash: string | undefined, dir: string) => checkout(context, moduleId, hash, dir),
  };
}
