import { Prisma } from "@chrona/db/generated/prisma/client";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import { audit } from "./audit";
import { notificationSettings } from "./settings";
import { StewardError } from "./errors";
import { json, requireModule, type ModuleContext } from "./module-context";

export async function activateIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string, reason: "activate" | "rollback") {
  const { workspaceId, ports } = context;
  const module = await requireModule(context, tx, moduleId);
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
  if (!version || version.status !== "approved") throw new StewardError("conflict", "Module version is not approved");
  const manifest = moduleManifestSchema.parse(version.manifest), now = ports.now();
  if (manifest.listen) for (const other of await tx.module.findMany({ where: { id: { not: moduleId }, status: "active", activeHash: { not: null } } })) {
    const active = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: other.id, hash: other.activeHash! } } });
    if (active && moduleManifestSchema.parse(active.manifest).listen === manifest.listen) throw new StewardError("conflict", `${manifest.listen} is served by module ${other.name}`);
  }
  const zone = notificationSettings((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
  await tx.schedule.updateMany({ where: { workspaceId, moduleId, mode: "module", status: "active", payload: { equals: Prisma.DbNull } }, data: { status: "cancelled", nextAt: null } });
  for (const trigger of manifest.triggers) {
    if (!("schedule" in trigger)) continue;
    let nextAt = nextOccurrence(trigger.schedule, now, zone);
    if (!nextAt && trigger.schedule.kind === "at") nextAt = now;
    await tx.schedule.create({ data: { workspaceId, moduleId, triggerId: trigger.id, mode: "module", rule: json(trigger.schedule), text: `${manifest.name}:${trigger.id}`, label: manifest.name, createdBy: "chrona", createdAt: now, nextAt, status: nextAt ? "active" : "done" } });
  }
  await tx.module.update({ where: { id: moduleId }, data: { activeHash: hash, status: "active" } });
  const modules = await tx.module.findMany({ where: { workspaceId }, orderBy: { id: "asc" } });
  const previous = await tx.generation.findFirst({ where: { workspaceId }, orderBy: { seq: "desc" } });
  const generation = await tx.generation.create({ data: { workspaceId, seq: (previous?.seq ?? 0) + 1, modules: Object.fromEntries(modules.map(row => [row.id, row.activeHash])), reason, createdAt: now } });
  await audit(tx, { workspaceId, actor: "chrona", kind: `module_${reason}`, subjectId: moduleId, details: { hash, generationId: generation.id } });
  return generation;
}
export async function startMigration(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string, schema: { from: number | null; to: number }) {
  const { from, to } = schema;
  await tx.module.update({ where: { id: moduleId }, data: { status: "migrating" } });
  await tx.audit.create({ data: { workspaceId: context.workspaceId, actorKey: "chrona", kind: "module_migration_started", subjectId: moduleId, details: { hash, from, to }, createdAt: context.ports.now() } });
}
