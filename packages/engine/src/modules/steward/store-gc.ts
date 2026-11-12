// Only explicit-material versions are collected: ensureVersionMaterial rebuilds them from Git on next use.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { StewardPorts } from "./ports";
import type { BuildReport } from "./module-context";
import { moduleSupervisor } from "./module-supervisor";

const DAY_MS = 24 * 3600_000;
const GRACE_MS = 7 * DAY_MS;
const MAX_REMOVED = 20;
const TERMINAL = ["approved", "rejected", "cancelled", "failed"];
const passes = new WeakMap<StewardPorts["db"], number>();

async function storeEntries(store: string) {
  try { return await readdir(store, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.error(JSON.stringify({ component: "store-gc", event: "store_gc.missing", error: String(error) }));
    return [];
  }
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
    const version = await ports.db.moduleVersion.findFirst({ where: { hash } });
    if (!version) {
      console.error(JSON.stringify({ component: "store-gc", event: "store_gc.orphan", hash }));
      kept++;
      continue;
    }
    if (!(version.report as BuildReport).git) { kept++; continue; }
    await rm(join(store, hash), { recursive: true, force: true });
    removed.push(hash);
    console.error(JSON.stringify({ component: "store-gc", event: "store_gc.removed", moduleId: version.moduleId, hash }));
  }
  return { removed, kept };
}
