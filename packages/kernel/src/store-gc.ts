// Retained CAS materials survive checkout collection and are verified before removal.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { StewardPorts } from "./ports";
import { moduleContext } from "./modules/module-context";
import { versionMaterialRestorable } from "./modules/module-source";
import { moduleSupervisor } from "./modules/module-supervisor";

const DAY_MS = 24 * 3600_000;
const GRACE_MS = 7 * DAY_MS;
const MAX_REMOVED = 20;
const TERMINAL = ["approved", "rejected", "cancelled", "failed"];
const passes = new WeakMap<StewardPorts["db"], number>();

async function storeEntries(store: string) {
  try { return await readdir(store, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

async function restorableVersions(ports: StewardPorts, hash: string) {
  const versions = await ports.db.moduleVersion.findMany({ where: { hash }, include: { module: { select: { workspaceId: true } } } });
  if (!versions.length) {
    console.error(JSON.stringify({ component: "store-gc", event: "store_gc.orphan", hash }));
    return [];
  }
  try {
    for (const version of versions) {
      if (!await versionMaterialRestorable(moduleContext(ports, version.module.workspaceId), version)) return [];
    }
  } catch (error) {
    console.error(JSON.stringify({ component: "store-gc", event: "store_gc.check_failed", hash, error: String(error).slice(0, 300) }));
    return [];
  }
  return versions;
}

export async function collectStore(ports: StewardPorts, now: Date): Promise<{ removed: string[]; kept: number }> {
  const at = now.getTime(), prior = passes.get(ports.db);
  if (prior !== undefined && at - prior < DAY_MS) return { removed: [], kept: 0 };
  passes.set(ports.db, at);
  const modules = await ports.db.module.findMany({ select: { activeHash: true } });
  const keep = new Set([...moduleSupervisor(ports).liveHashes(), ...modules.flatMap(module => module.activeHash ? [module.activeHash] : [])]);
  const protectedVersions = await ports.db.moduleVersion.findMany({
    where: { OR: [{ createdAt: { gte: new Date(at - GRACE_MS) } }, { status: { notIn: TERMINAL } }] },
    select: { hash: true },
  });
  for (const version of protectedVersions) keep.add(version.hash);
  const store = join(ports.dataDir, "platform/store");
  const entries = await storeEntries(store);
  const removed: string[] = [];
  let kept = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const hash = entry.name;
    if (keep.has(hash) || removed.length >= MAX_REMOVED) { kept++; continue; }
    const versions = await restorableVersions(ports, hash);
    if (!versions.length) { kept++; continue; }
    await rm(join(store, hash), { recursive: true, force: true });
    removed.push(hash);
    console.error(JSON.stringify({ component: "store-gc", event: "store_gc.removed", moduleId: versions[0]!.moduleId, hash }));
  }
  return { removed, kept };
}
