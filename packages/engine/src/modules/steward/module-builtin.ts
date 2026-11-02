import { chmod, cp, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Prisma } from "@chrona/db/generated/prisma/client";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { moduleContext } from "./module-context";
import { proposeBuiltin } from "./module-proposal";
import { buildPending } from "./module-build";
import { memorySettings } from "./settings";

/** Store copies keep the store's read-only modes; the private copy must be removable. */
async function writable(dir: string) {
  await chmod(dir, 0o700);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await writable(join(dir, entry.name));
    else if (entry.isFile()) await chmod(join(dir, entry.name), 0o600);
  }
}
async function preserveCustomization(ports: StewardPorts, workspaceId: string, name: string) {
  return ports.db.$transaction(async tx => {
    const module = await tx.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
    if (!module?.activeHash) return false;
    const active = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
    if (!active || active.source === "builtin") return false;
    // Retire only old built-in replacement cards, not pending custom updates.
    const hashes = new Set((await tx.moduleVersion.findMany({ where: { moduleId: module.id, source: "builtin" }, select: { hash: true } })).map(row => row.hash));
    const open = await tx.approval.findMany({ where: { workspaceId, moduleId: module.id, action: "activate_module", status: "open" } });
    const ids = open.filter(row => {
      const p = row.payload;
      return p && typeof p === "object" && !Array.isArray(p) && p.restore === undefined && typeof p.hash === "string" && hashes.has(p.hash);
    }).map(row => row.id);
    await tx.approval.updateMany({ where: { id: { in: ids }, status: "open" }, data: { status: "expired", resolvedAt: ports.now() } });
    return true;
  });
}
/** Release resources, never Provider-controlled directories. Repeated starts are idempotent. */
// v2-21: the built-in memory provider is downloaded (its packages) only once the owner chooses it.
const OPTIONAL = ["memory-local"];
async function notChosen(ports: StewardPorts, workspaceId: string) {
  const chosen = memorySettings((await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings).provider;
  return (name: string) => OPTIONAL.includes(name) && chosen !== name;
}
// eslint-disable-next-line complexity -- Preserve startup ordering, customization protection and temporary-resource cleanup in one lifecycle.
export async function registerBuiltins(ports: StewardPorts, workspaceId: string) {
  if (!ports.moduleBuiltinResources) return;
  const context = moduleContext(ports, workspaceId);
  // A private copy: the Nix store hard-links identical files, and proposals refuse hard links.
  const root = await realpath(await mkdtemp(join(tmpdir(), "chrona-builtin-")));
  try {
    await cp(resolve(ports.moduleBuiltinResources), root, { recursive: true });
    await writable(root);
    const entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink());
    const skipped = await notChosen(ports, workspaceId);
    for (const entry of entries) {
      if (skipped(entry.name)) continue;
      if (await preserveCustomization(ports, workspaceId, entry.name)) continue;
      const result = await proposeBuiltin(context, root, entry.name);
      if (result.status === "rejected") {
        console.error(JSON.stringify({ level: "error", component: "module-builtin", event: "builtin.rejected", module: entry.name, hash: result.hash, errors: result.report.errors?.map(error => error.slice(0, 1000)).slice(0, 10) ?? [] }));
        throw new Error(`Built-in ${entry.name} rejected: ${JSON.stringify(result.report)}`);
      }
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
