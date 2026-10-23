import { chmod, cp, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Prisma } from "@chrona/db/generated/prisma/client";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { moduleContext } from "./module-context";
import { proposeBuiltin } from "./module-proposal";
import { buildPending } from "./module-build";

/** Store copies keep the store's read-only modes; the private copy must be removable. */
async function writable(dir: string) {
  await chmod(dir, 0o700);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await writable(join(dir, entry.name));
    else if (entry.isFile()) await chmod(join(dir, entry.name), 0o600);
  }
}
/** Release resources, never Provider-controlled directories. Repeated starts are idempotent. */
export async function registerBuiltins(ports: StewardPorts, workspaceId: string) {
  if (!ports.moduleBuiltinResources) return;
  const context = moduleContext(ports, workspaceId);
  // A private copy: the Nix store hard-links identical files, and proposals refuse hard links.
  const root = await realpath(await mkdtemp(join(tmpdir(), "chrona-builtin-")));
  try {
    await cp(resolve(ports.moduleBuiltinResources), root, { recursive: true });
    await writable(root);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const result = await proposeBuiltin(context, root, entry.name);
      if (result.status === "rejected") throw new Error(`Built-in ${entry.name} rejected: ${JSON.stringify(result.report)}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
  // buildPending takes three versions at a time; built-ins must all be ready before modules start.
  for (let round = 0; round < 10 && await ports.db.moduleVersion.count({ where: { module: { workspaceId }, status: "building" } }); round++) await buildPending(context);
  const remind = await ports.db.module.findFirst({ where: { workspaceId, name: "remind", builtin: true } });
  if (remind?.activeHash) {
    const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: remind.id, hash: remind.activeHash } } });
    if (version && moduleManifestSchema.parse(version.manifest).dynamicSchedules) await ports.db.schedule.updateMany({ where: { workspaceId, mode: "module", payload: { not: Prisma.DbNull }, moduleId: null }, data: { moduleId: remind.id } });
  }
}
