import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import type { moduleManifestSchema } from "@chrona/contracts/steward";
import { StewardError } from "./errors";
import { createNotifications } from "./notify";
import { json, type ModuleContext, type ModuleVersion, type BuildReport, type TestReport, type requireModule } from "./module-context";
import { prepareData, runOffline, type Restore } from "./module-data";
import { activateIn } from "./module-generation";

export type PreparedMigration = { module: Awaited<ReturnType<typeof requireModule>>; version: ModuleVersion; manifest: z.output<typeof moduleManifestSchema>; from: number | null; to: number };
async function migrationFailed(context: ModuleContext, prepared: PreparedMigration, reason: "activate" | "rollback", output: TestReport[number], restore?: Restore) {
  const { db, workspaceId, ports } = context, { module, version } = prepared;
  await db.$transaction(async tx => {
    await tx.module.update({ where: { id: module.id }, data: { status: module.status } });
    if (reason === "activate") await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json({ ...version.report as BuildReport, migration: { ...output, exitCode: output.exitCode || 1 } }) } });
  });
  if (reason === "rollback" && !restore) throw new StewardError("conflict", "模块回滚未完成：数据迁移失败，旧版本和数据保持不变");
  await createNotifications(ports, workspaceId).enqueue({ affairId: module.affairId, level: "now", title: restore ? `模块 ${module.name} 回滚未完成：数据恢复失败` : `模块 ${module.name} 新版本未启用：数据迁移失败`, body: "旧版本继续运行，请检查迁移报告后重新提交。", dedupeKey: `${restore ? "module-restore-failed" : "module-migration-failed"}:${version.id}` });
}
async function runMigration(context: ModuleContext, prepared: PreparedMigration, next: string) {
  const { manifest, from, to, version } = prepared;
  if (!manifest.data.migrate) throw new Error("Migration entry missing");
  return runOffline(context.ports, join(context.store, version.hash), next, manifest.data.migrate, { migrate: { from, to }, now: context.ports.now().toISOString() });
}
export async function migrateData(context: ModuleContext, prepared: PreparedMigration, reason: "activate" | "rollback", restore?: Restore) {
  const { db, platform } = context, { module, version, from, to } = prepared, moduleId = module.id, hash = version.hash;
  const live = join(platform, "data", moduleId), next = join(platform, "data-next", moduleId), old = join(platform, "data-old", moduleId);
  let output: TestReport[number] = { stdout: "", stderr: "Data migration failed", exitCode: 1 }, moved = false, swapped = false;
  try {
    await prepareData(context, moduleId, from, to, restore);
    if (!restore) {
      const migration = await runMigration(context, prepared, next);
      output = migration.output;
      if (!migration.succeeded) throw new Error("Migration failed");
    }
    await mkdir(dirname(old), { recursive: true });
    await rm(old, { recursive: true, force: true });
    // Always leave data-old behind so crash recovery can restore the pre-swap state.
    await mkdir(live, { recursive: true });
    await rename(live, old); moved = true;
    await rename(next, live); swapped = true;
    await db.$transaction(async tx => {
      if (reason === "activate") await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved", report: json({ ...version.report as BuildReport, migration: output }) } });
      await tx.module.update({ where: { id: moduleId }, data: { dataSchema: to } });
      await activateIn(context, tx, moduleId, hash, reason);
    });
  } catch {
    if (moved) {
      if (swapped) await rm(live, { recursive: true, force: true });
      await rename(old, live);
    }
    await rm(next, { recursive: true, force: true });
    await migrationFailed(context, prepared, reason, output, restore);
    return;
  }
  // Retain old directory until activation commits, so DB failure can restore it.
  await rm(old, { recursive: true, force: true });
}
export async function recoverMigrations(context: ModuleContext, now = context.ports.now()) {
  const { db, workspaceId, platform } = context;
  for (const module of await db.module.findMany({ where: { workspaceId, status: "migrating" } })) {
    const started = await db.audit.findFirst({ where: { workspaceId, kind: "module_migration_started", subjectId: module.id }, orderBy: { createdAt: "desc" } });
    if (!started || started.createdAt.getTime() >= now.getTime() - 15 * 60_000) continue;
    await rm(join(platform, "data-next", module.id), { recursive: true, force: true });
    const live = join(platform, "data", module.id), old = join(platform, "data-old", module.id);
    // Still migrating means activation never committed: data-old is pre-migration data.
    try { await lstat(old); await rm(live, { recursive: true, force: true }); await rename(old, live); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await db.module.updateMany({ where: { id: module.id, status: "migrating" }, data: { status: "active" } });
  }
}
