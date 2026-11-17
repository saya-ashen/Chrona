import { basename, dirname, join, relative } from "node:path";
import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm } from "node:fs/promises";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { StewardError } from "../errors";
import type { ModuleContext, ModuleVersion } from "./module-context";
import { readStoredVersionMaterial, moduleMaterialDigest, moduleSourceFiles, snapshotModuleMaterial } from "./module-artifacts";
import { checkoutModule, openModuleDirectory, publishModuleDirectory } from "./module-files";
import { installDependencies } from "./checks/module-dependencies";
import { buildOwnershipError } from "./checks/module-build-ownership";

export async function versionSource(context: ModuleContext, version: ModuleVersion) {
  const files = moduleSourceFiles(await readStoredVersionMaterial(context.platform, version.hash));
  return { files: files.map(file => ({ ...file, bytes: Buffer.from(file.bytes) })) };
}

export async function readVersionSource(context: ModuleContext, moduleId: string, hash: string) {
  const version = await context.db.moduleVersion.findFirst({ where: { moduleId, hash, module: { workspaceId: context.workspaceId } } });
  if (!version) throw new StewardError("not_found", "Module version not found");
  return (await versionSource(context, version)).files;
}

/** Rollback and source export read the retained CAS, independent of store copies. */
export async function versionMaterial(context: ModuleContext, version: ModuleVersion) {
  const files = await readStoredVersionMaterial(context.platform, version.hash);
  return { sourceFiles: moduleSourceFiles(files), files: files.map(file => ({ ...file, bytes: Buffer.from(file.bytes) })) };
}
/** Same no-replace directory publication used by the CAS; even an empty winner is preserved. */
export async function publishRestoredMaterial(store: string, staging: string, hash: string) {
  const parent = await open(store, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const source = await open(dirname(staging), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      publishModuleDirectory(parent, basename(staging), hash, source);
      await parent.sync();
    } finally { await source.close(); }
  } finally { await parent.close(); }
}
/** GC may remove a checkout only after all retained material bytes verify. */
export async function versionMaterialRestorable(context: ModuleContext, version: ModuleVersion) {
  await versionMaterial(context, version);
  return true;
}
export async function ensureVersionMaterial(context: ModuleContext, version: ModuleVersion) {
  const source = await versionMaterial(context, version);
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
