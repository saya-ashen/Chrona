import { Prisma } from "@chrona/db/generated/prisma/client";
import { listenPaths, moduleManifestSchema } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import { audit } from "./audit";
import { notificationSettings } from "./settings";
import { StewardError } from "./errors";
import { json, requireModule, type ModuleContext } from "./module-context";

async function replaceModuleSchedules(tx: Prisma.TransactionClient, { workspaceId, moduleId, manifest, now, zone }: { workspaceId: string; moduleId: string; manifest: ReturnType<typeof moduleManifestSchema.parse>; now: Date; zone: string }) {
  await tx.schedule.updateMany({ where: { workspaceId, moduleId, mode: "module", status: "active", payload: { equals: Prisma.DbNull } }, data: { status: "cancelled", nextAt: null } });
  // v2-24: a version that no longer uses schedules.create cannot receive its timers, so they end with it.
  if (!manifest.uses.includes("schedules.create") && !manifest.dynamicSchedules) await tx.schedule.updateMany({ where: { workspaceId, moduleId, mode: "module", status: { in: ["active", "paused"] }, payload: { not: Prisma.DbNull } }, data: { status: "cancelled", nextAt: null } });
  for (const trigger of manifest.triggers) {
    if (!("schedule" in trigger)) continue;
    let nextAt = nextOccurrence(trigger.schedule, now, zone);
    if (!nextAt && trigger.schedule.kind === "at") nextAt = now;
    await tx.schedule.create({ data: { workspaceId, moduleId, triggerId: trigger.id, mode: "module", rule: json(trigger.schedule), text: `${manifest.name}:${trigger.id}`, label: manifest.name, createdBy: "chrona", createdAt: now, nextAt, status: nextAt ? "active" : "done" } });
  }
}
export async function activateIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string, reason: "activate" | "rollback") {
  await switchActiveIn(context, tx, moduleId, hash);
  const generation = await recordGeneration(context, tx, reason);
  await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: `module_${reason}`, subjectId: moduleId, details: { hash, generationId: generation.id } });
  return generation;
}
/** One generation for the current active hashes; a group activation (v2-15) records it once after switching all its modules. */
export async function recordGeneration(context: ModuleContext, tx: Prisma.TransactionClient, reason: "activate" | "rollback") {
  const { workspaceId } = context;
  const modules = await tx.module.findMany({ where: { workspaceId }, orderBy: { id: "asc" } });
  const previous = await tx.generation.findFirst({ where: { workspaceId }, orderBy: { seq: "desc" } });
  return tx.generation.create({ data: { workspaceId, seq: (previous?.seq ?? 0) + 1, modules: Object.fromEntries(modules.map(row => [row.id, row.activeHash])), reason, createdAt: context.ports.now() } });
}
/** Makes an approved version the active one (listen paths, schedules), without recording a generation. */
export async function switchActiveIn(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string) {
  const { workspaceId, ports } = context;
  await requireModule(context, tx, moduleId);
  const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash } } });
  if (!version || version.status !== "approved") throw new StewardError("conflict", "Module version is not approved");
  const manifest = moduleManifestSchema.parse(version.manifest), now = ports.now();
  if (manifest.listen) for (const other of await tx.module.findMany({ where: { id: { not: moduleId }, status: "active", activeHash: { not: null } } })) {
    const active = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: other.id, hash: other.activeHash! } } });
    const taken = active ? listenPaths(moduleManifestSchema.parse(active.manifest)).find(path => listenPaths(manifest).includes(path)) : undefined;
    if (taken) throw new StewardError("conflict", `${taken} is served by module ${other.name}`);
  }
  const zone = notificationSettings((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).timezone;
  await replaceModuleSchedules(tx, { workspaceId, moduleId, manifest, now, zone });
  await tx.module.update({ where: { id: moduleId }, data: { activeHash: hash, status: "active" } });
}
export async function startMigration(context: ModuleContext, tx: Prisma.TransactionClient, moduleId: string, hash: string, schema: { from: number | null; to: number }) {
  const { from, to } = schema;
  await tx.module.update({ where: { id: moduleId }, data: { status: "migrating" } });
  await tx.audit.create({ data: { workspaceId: context.workspaceId, actorKey: "chrona", kind: "module_migration_started", subjectId: moduleId, details: { hash, from, to }, createdAt: context.ports.now() } });
}
