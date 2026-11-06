import { access, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { BUILTIN_MODULE_NAMES } from "@chrona/contracts/steward";
import { redactSensitiveText } from "@chrona/logging/redaction";
import type { StewardPorts } from "./ports";
import { moduleContext, json } from "./module-context";
import { resolveBuiltinRelease, type ModuleRelease } from "./module-release";
import { activateBuiltinReleaseIn } from "./module-generation";
import { dataEmpty } from "./module-data";
import { StewardError } from "./errors";

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
/** Bind only the five trusted running-release modules. No proposal queue, tests or dependency installation. */
export async function registerBuiltins(ports: StewardPorts, workspaceId: string) {
  if (!ports.moduleBuiltinResources) return;
  const context = moduleContext(ports, workspaceId);
  const failures: string[] = [];
  for (const name of BUILTIN_MODULE_NAMES) {
    try {
      const release = await resolveBuiltinRelease(ports, name);
      const current = await ports.db.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
      if (current && !current.builtin) throw new StewardError("conflict", `Reserved built-in identity conflicts with external module ${name}`);
      const errors = await runtimeErrors(ports, release, current);
      await ports.db.$transaction(async tx => {
        const module = await tx.module.upsert({ where: { workspaceId_name: { workspaceId, name } }, create: { workspaceId, name, builtin: true, createdAt: ports.now() }, update: {} });
        if (!module.builtin) throw new StewardError("conflict", `Reserved built-in identity conflicts with external module ${name}`);
        if (current && (module.activeHash !== current.activeHash || module.dataSchema !== current.dataSchema || module.status !== current.status)) throw new StewardError("conflict", "Built-in changed while checking release compatibility");
        await tx.moduleVersion.upsert({ where: { moduleId_hash: { moduleId: module.id, hash: release.hash } }, create: {
          moduleId: module.id, hash: release.hash, manifest: json(release.manifest), intent: { changes: ["Trusted Chrona release"], preserves: [] }, source: "builtin", status: "approved", report: { tests: [], errors }, createdAt: ports.now(),
        }, update: { manifest: json(release.manifest), source: "builtin", status: "approved", report: { tests: [], errors } } });
        if (errors.length) {
          await tx.module.update({ where: { id: module.id }, data: { status: "paused" } });
          return;
        }
        if (module.activeHash !== release.hash) await activateBuiltinReleaseIn(context, tx, release);
      });
      if (errors.length) failures.push(`${name}: ${errors.join("; ")}`);
    } catch (error) {
      // A bad release must stop this built-in, while the remaining base modules and rescue can recover.
      await ports.db.module.updateMany({ where: { workspaceId, name, builtin: true }, data: { status: "paused" } });
      failures.push(`${name}: ${redactSensitiveText(error instanceof Error ? error.message : "Release registration failed").slice(0, 1000)}`);
    }
  }
  if (failures.length) throw new StewardError("conflict", failures.join("\n"));
}
