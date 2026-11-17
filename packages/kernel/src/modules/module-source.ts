import { basename, join, relative } from "node:path";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm } from "node:fs/promises";
import { dlopen, FFIType, ptr, read } from "bun:ffi";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { z } from "zod";
import { StewardError } from "../errors";
import { json, type ModuleContext, type ModuleVersion, type BuildReport } from "./module-context";
import { importLegacyModuleSource, readModuleSource } from "./module-git";
import { readModuleFiles } from "./module-preview";
import { resolveBuiltinRelease, resolveExternalRelease } from "./module-release";
import { moduleMaterialDigest, moduleMaterialRecord, restoreModuleArtifacts, snapshotModuleMaterial } from "./module-artifacts";
import { checkoutModule, openModuleDirectory, snapshotModule } from "./module-files";
import { installDependencies } from "./module-dependencies";
import { buildOwnershipError } from "./module-build-ownership";

const revisionSchema = z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), tree: z.string().regex(/^[a-f0-9]{40}$/) });

async function legacyFiles(context: ModuleContext, version: ModuleVersion, dir: string) {
  try { return await snapshotModule(context.platform, relative(context.platform, dir)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || version.source !== "builtin") throw error;
    const module = await context.db.module.findFirst({ where: { id: version.moduleId, workspaceId: context.workspaceId } });
    if (!module || (!module.builtin && !["mcp", "files", "events"].includes(module.name))) throw new StewardError("conflict", "Legacy release source requires a release module identity");
    const release = module.builtin ? await resolveBuiltinRelease(context.ports, module.name, version.hash) : await resolveExternalRelease(context.ports, module.name, version.hash);
    return readModuleFiles(release.codeDir, "Unsafe legacy release source");
  }
}

/** Old approval hashes stay unchanged; only verified legacy source enters Git. */
export async function versionSource(context: ModuleContext, version: ModuleVersion, legacyDir = join(context.store, version.hash)) {
  try {
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
    return { revision: revision!, files: files.map(file => ({ ...file, bytes: Buffer.from(file.bytes) })) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StewardError("not_found", `Version ${version.hash} has no stored source; rebuild it from the active version or your own copy`);
    throw error;
  }
}

export async function readVersionSource(context: ModuleContext, moduleId: string, hash: string) {
  const version = await context.db.moduleVersion.findFirst({ where: { moduleId, hash, module: { workspaceId: context.workspaceId } } });
  if (!version) throw new StewardError("not_found", "Module version not found");
  return (await versionSource(context, version)).files;
}

/** Full immutable checkout material, also used when selecting an approved rollback. */
export async function versionMaterial(context: ModuleContext, version: ModuleVersion, legacyDir?: string) {
  const source = await versionSource(context, version, legacyDir);
  const files = await restoreModuleArtifacts(context.platform, source.files);
  return { ...source, sourceFiles: source.files, files: files.map(file => ({ ...file, bytes: Buffer.from(file.bytes) })) };
}
/** Same no-replace directory publication used by the CAS; even an empty winner is preserved. */
async function publishRestoredMaterial(store: string, staging: string, hash: string) {
  const parent = await open(store, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const name of process.platform === "linux" ? ["libc.so.6", "libc.so"] : []) {
      let library;
      try { library = dlopen(name, {
        renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
        __errno_location: { args: [], returns: FFIType.ptr },
      }); } catch { continue; }
      try {
        const from = Buffer.from(`${basename(staging)}\0`), to = Buffer.from(`${hash}\0`);
        if (library.symbols.renameat2(parent.fd, ptr(from), parent.fd, ptr(to), 1) === 0) { await parent.sync(); return; }
        if (read.i32(library.symbols.__errno_location()!) === 17) return; // Verify the concurrent winner below.
        throw new StewardError("conflict", "Atomic material restoration failed");
      } finally { library.close(); }
    }
    throw new StewardError("forbidden", "Atomic material restoration is unavailable on this host");
  } finally { await parent.close(); }
}
/** True when ensureVersionMaterial would rebuild store/<hash> from Git if it were missing. */
export async function versionMaterialRestorable(context: ModuleContext, version: ModuleVersion) {
  if (!(version.report as BuildReport).git) return false;
  return !!moduleMaterialRecord((await versionMaterial(context, version)).sourceFiles);
}
/** Approved version switches verify existing copies or restore a missing explicit material. */
export async function ensureVersionMaterial(context: ModuleContext, version: ModuleVersion) {
  // Legacy lifecycle copies retain their existing behavior; explicit materials always carry Git provenance.
  if (!(version.report as BuildReport).git) return;
  const source = await versionMaterial(context, version);
  if (!moduleMaterialRecord(source.sourceFiles)) return;
  const path = relative(context.platform, join(context.store, version.hash));
  let exists = true;
  try { await lstat(join(context.store, version.hash)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; exists = false; }
  const expected = moduleMaterialDigest(source.files);
  const verify = async (path: string) => {
    if (moduleMaterialDigest(await snapshotModuleMaterial(context.platform, path, { verifyTree: true })) !== expected) throw new StewardError("conflict", "Installed material differs from its approved version; existing files preserved");
  };
  if (!exists) {
    const store = await openModuleDirectory(context.platform, relative(context.platform, context.store), true);
    await store.close();
    const staging = await mkdtemp(join(context.store, ".restore-"));
    try {
      const stagingPath = relative(context.platform, staging);
      await checkoutModule(context.platform, stagingPath, source.files);
      const dependencies = await installDependencies(context, staging, moduleManifestSchema.parse(version.manifest));
      if (dependencies?.errors.length) throw new StewardError("conflict", `Material dependency restoration failed: ${dependencies.errors.join("; ")}`);
      await verify(stagingPath);
      for (const file of source.files) await chmod(join(staging, file.path), file.executable ? 0o555 : 0o444);
      await publishRestoredMaterial(context.store, staging, version.hash);
    } finally {
      // An installer whose stop is unknown still owns its private directory.
      if (!buildOwnershipError(context, staging)) await rm(staging, { recursive: true, force: true });
    }
  }
  await verify(path);
}
export async function readVersionMaterial(context: ModuleContext, moduleId: string, hash: string) {
  const version = await context.db.moduleVersion.findFirst({ where: { moduleId, hash, module: { workspaceId: context.workspaceId } } });
  if (!version) throw new StewardError("not_found", "Module version not found");
  return (await versionMaterial(context, version)).files;
}
