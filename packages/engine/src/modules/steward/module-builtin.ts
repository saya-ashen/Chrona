import { access, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { BUILTIN_MODULE_NAMES } from "@chrona/contracts/steward";
import { redactSensitiveText } from "@chrona/logging/redaction";
import type { StewardPorts } from "./ports";
import { moduleContext, json, type ModuleContext } from "./module-context";
import { resolveBuiltinRelease, type ModuleRelease } from "./module-release";
import { activateBuiltinReleaseIn } from "./module-generation";
import { dataEmpty } from "./module-data";
import { StewardError } from "./errors";
import { importModuleGitBundle } from "./module-git-upstream";
import { exportModuleSource } from "./module-git";
import { recordModuleUpstream } from "./module-upstream";
import { installDependencies } from "./module-build";

async function executable(name: string) {
  if (isAbsolute(name)) return access(name, constants.X_OK).then(() => true, () => false);
  return Boolean(Bun.which(name));
}
async function entryErrors(release: ModuleRelease) {
  try {
    const entry = await lstat(join(release.codeDir, release.manifest.entry));
    return !entry.isFile() || entry.isSymbolicLink() ? ["Release entry is not a regular file"] : [];
  } catch { return ["Release entry is missing"]; }
}
async function runtimeErrors(ports: StewardPorts, release: ModuleRelease, module: { id: string; dataSchema: number | null; status: string } | null) {
  const errors: string[] = [];
  if (!ports.sandbox?.available || !ports.sandbox.startModule) errors.push("Module runtime unavailable; check the configured execution mode and interpreter");
  errors.push(...await entryErrors(release));
  for (const name of release.manifest.packages) if (!await executable(name)) errors.push(`Required host program unavailable: ${name}`);
  if (module?.status === "migrating") errors.push("Module data migration is in progress; finish recovery before using this release");
  if (module && module.dataSchema !== release.manifest.data.schema && !await dataEmpty(join(ports.dataDir, "platform/data", module.id))) errors.push("Release data schema differs from existing data; back up and explicitly upgrade data before resuming");
  return errors;
}
async function seedSource(context: ModuleContext, moduleId: string, release: ModuleRelease) {
  const { platform } = context;
  if (!release.git) throw new StewardError("conflict", "Initial built-in seed requires a verified Git bundle");
  const git = await importModuleGitBundle({ platform, moduleId, ...release.git });
  const staging = await mkdtemp(join(platform, "builtin-seed-"));
  try {
    await exportModuleSource({ platform, moduleId, commit: git.commit, root: staging, dir: "source" });
    const dependencies = await installDependencies(context, join(staging, "source"), release.manifest, git.commit);
    if (dependencies?.errors.length) throw new StewardError("conflict", dependencies.errors.join("; "));
    await mkdir(join(platform, "store"), { recursive: true });
    try { await rename(join(staging, "source"), join(platform, "store", git.commit)); }
    catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    return { git, ...(dependencies ? { dependencies: dependencies.installed } : {}) };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
type SeedIdentity = { name: string; builtin: boolean; dataSchema: number | null; status: string };
function assertSeedIdentity(current: SeedIdentity) {
  if (!current.builtin) throw new StewardError("conflict", `Reserved built-in identity conflicts with external module ${current.name}`);
}
function assertSeedCompatibility(current: SeedIdentity, previous: SeedIdentity | null) {
  if (previous && (current.dataSchema !== previous.dataSchema || current.status !== previous.status)) throw new StewardError("conflict", "Built-in changed while checking release compatibility");
}
const registrations = new WeakMap<StewardPorts["db"], Map<string, Promise<void>>>();
/** Trusted first seed only; subsequent versions use the checked proposal lifecycle. */
export function registerBuiltins(ports: StewardPorts, workspaceId: string): Promise<void> {
  let active = registrations.get(ports.db);
  if (!active) { active = new Map(); registrations.set(ports.db, active); }
  const existing = active.get(workspaceId);
  if (existing) return existing;
  // Tick and supervisor must share the entire seed, including Git and dependency I/O.
  const promise = register(ports, workspaceId).finally(() => active!.delete(workspaceId));
  active.set(workspaceId, promise);
  return promise;
}
async function register(ports: StewardPorts, workspaceId: string) {
  if (!ports.moduleBuiltinResources) return;
  const context = moduleContext(ports, workspaceId);
  const failures: string[] = [];
  for (const name of BUILTIN_MODULE_NAMES) {
    try {
      const current = await ports.db.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
      if (current) assertSeedIdentity(current);
      if (current?.activeHash) continue;
      const release = await resolveBuiltinRelease(ports, name);
      const errors = await runtimeErrors(ports, release, current);
      const identity = await ports.db.module.upsert({ where: { workspaceId_name: { workspaceId, name } }, create: { workspaceId, name, builtin: true, createdAt: ports.now() }, update: {} });
      if (identity.activeHash) continue;
      assertSeedCompatibility(identity, current);
      assertSeedIdentity(identity);
      const source = errors.length ? undefined : await seedSource(context, identity.id, release);
      await ports.db.$transaction(async tx => {
        const module = await tx.module.findFirstOrThrow({ where: { id: identity.id, workspaceId, name } });
        assertSeedIdentity(module);
        if (module.activeHash) return;
        assertSeedCompatibility(module, identity);
        if (errors.length) {
          await tx.module.update({ where: { id: module.id }, data: { status: "paused" } });
          return;
        }
        await tx.moduleVersion.upsert({ where: { moduleId_hash: { moduleId: module.id, hash: release.hash } }, create: {
          moduleId: module.id, hash: release.hash, manifest: json(release.manifest), intent: { changes: ["Trusted Chrona release"], preserves: [] }, source: "builtin", status: "approved", report: { tests: [], errors, ...source }, createdAt: ports.now(),
        }, update: {} });
        await recordModuleUpstream(ports, workspaceId, module.id, release.git!, tx);
        await activateBuiltinReleaseIn(context, tx, release);
      });
      if (errors.length) failures.push(`${name}: ${errors.join("; ")}`);
    } catch (error) {
      // Only an uninitialized seed can be paused by release registration failure.
      await ports.db.module.updateMany({ where: { workspaceId, name, builtin: true, activeHash: null }, data: { status: "paused" } });
      failures.push(`${name}: ${redactSensitiveText(error instanceof Error ? error.message : "Release registration failed").slice(0, 1000)}`);
    }
  }
  if (failures.length) throw new StewardError("conflict", failures.join("\n"));
}
