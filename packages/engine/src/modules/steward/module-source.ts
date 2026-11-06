import { join, relative } from "node:path";
import { z } from "zod";
import { StewardError } from "./errors";
import { json, type ModuleContext, type ModuleVersion, type BuildReport } from "./module-context";
import { importLegacyModuleSource, readModuleSource } from "./module-git";
import { readModuleFiles } from "./module-preview";
import { resolveBuiltinRelease } from "./module-release";
import { snapshotModule } from "./module-files";

const revisionSchema = z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), tree: z.string().regex(/^[a-f0-9]{40}$/) });

async function legacyFiles(context: ModuleContext, version: ModuleVersion, dir: string) {
  try { return await snapshotModule(context.platform, relative(context.platform, dir)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || version.source !== "builtin") throw error;
    const module = await context.db.module.findFirst({ where: { id: version.moduleId, workspaceId: context.workspaceId } });
    if (!module?.builtin) throw new StewardError("conflict", "Legacy release source requires a built-in module identity");
    const release = await resolveBuiltinRelease(context.ports, module.name, version.hash);
    return readModuleFiles(release.codeDir, "Unsafe legacy release source");
  }
}

/** Old approval hashes stay unchanged; only verified legacy source enters Git. */
export async function versionSource(context: ModuleContext, version: ModuleVersion, legacyDir = join(context.store, version.hash)) {
  const report = version.report as BuildReport;
  let revision = report.git ? revisionSchema.parse(report.git) : null;
  if (/^[a-f0-9]{40}$/.test(version.hash)) {
    if (!revision || revision.commit !== version.hash) throw new StewardError("conflict", "Git source provenance does not match module version");
  } else if (!revision) {
    if (!/^[a-f0-9]{64}$/.test(version.hash)) throw new StewardError("invalid", "Invalid legacy module hash");
    const files = await legacyFiles(context, version, legacyDir);
    revision = await importLegacyModuleSource({ platform: context.platform, moduleId: version.moduleId, legacyHash: version.hash, files });
    const imported = revision;
    await context.db.$transaction(async tx => {
      const current = await tx.moduleVersion.findUniqueOrThrow({ where: { id: version.id } });
      await tx.moduleVersion.update({ where: { id: current.id }, data: { report: json({ ...(current.report as BuildReport), git: imported }) } });
    });
  }
  const files = await readModuleSource({ platform: context.platform, moduleId: version.moduleId, commit: revision!.commit });
  return { revision: revision!, files: files.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) })) };
}

export async function readVersionSource(context: ModuleContext, moduleId: string, hash: string) {
  const version = await context.db.moduleVersion.findFirst({ where: { moduleId, hash, module: { workspaceId: context.workspaceId } } });
  if (!version) throw new StewardError("not_found", "Module version not found");
  try { return (await versionSource(context, version)).files; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StewardError("not_found", `Version ${hash} has no stored source; rebuild it from the active version or your own copy`);
    throw error;
  }
}
