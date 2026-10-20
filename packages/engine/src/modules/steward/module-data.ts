import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RUN_LIMITS } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { ModuleContext } from "./module-context";
import { StewardError } from "./errors";

export async function dataEmpty(live: string) {
  try {
    if (!(await lstat(live)).isDirectory()) throw new Error("Unsafe data directory");
    return (await readdir(live)).length === 0;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return true; }
}
export async function copyData(live: string, data: string): Promise<boolean> {
  if (!(await lstat(live)).isDirectory()) throw new Error("Unsafe data directory");
  await mkdir(data, { recursive: true });
  let bytes = 0, count = 0;
  async function copy(relative: string): Promise<boolean> {
    for (const entry of await readdir(join(live, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name, source = join(live, path), target = join(data, path);
      if (entry.isDirectory()) { await mkdir(target); if (!await copy(path)) return false; }
      else if (entry.isFile()) {
        const info = await lstat(source);
        if (!info.isFile()) throw new Error("Unsafe data file");
        if (++count > 5000 || (bytes += info.size) > 50 * 1024 * 1024) return false;
        const content = await readFile(source);
        bytes += content.length - info.size;
        if (bytes > 50 * 1024 * 1024) return false;
        await writeFile(target, content);
      } else throw new Error("Unsafe data file");
    }
    return true;
  }
  return copy("");
}
export async function runOffline(ports: StewardPorts, codeDir: string, dataDir: string, entry: string, input: unknown) {
  return runOfflineLimited(ports, codeDir, dataDir, { entry, input });
}
export async function runOfflineLimited(ports: StewardPorts, codeDir: string, dataDir: string, options: { entry: string; input: unknown; timeoutMs?: number }) {
  const { entry, input, timeoutMs = RUN_LIMITS.jobTimeoutMs } = options;
  if (!ports.sandbox?.available || !ports.sandbox.runModule) throw new Error("Sandbox unavailable");
  const result = await ports.sandbox.runModule({ codeDir, dataDir, entry, input, network: false, timeoutMs: Math.min(timeoutMs, RUN_LIMITS.jobTimeoutMs), maxOutputBytes: RUN_LIMITS.jobOutputBytes });
  const output = { stdout: result.output.slice(0, RUN_LIMITS.jobOutputBytes), stderr: (result.error ?? "").slice(0, RUN_LIMITS.jobOutputBytes), exitCode: result.exitCode ?? 1 };
  return { result, output, succeeded: result.status === "succeeded" && result.exitCode === 0 && Buffer.byteLength(result.output) <= RUN_LIMITS.jobOutputBytes };
}
export async function snapshotAt(context: ModuleContext, moduleId: string, schema: number) {
  try {
    const info = await lstat(join(context.platform, "snapshots", moduleId, `schema-${schema}`));
    if (!info.isDirectory()) throw new StewardError("conflict", "Unsafe data snapshot");
    return info.mtime.toISOString();
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return null; }
}
async function backupTime(context: ModuleContext, snapshots: string, restore: boolean) {
  let at = context.ports.now().toISOString();
  if (!restore) return at;
  const latest = (await readdir(snapshots)).filter(name => name.startsWith("before-rollback-")).sort().at(-1);
  const previous = latest ? Date.parse(latest.slice("before-rollback-".length)) : NaN;
  if (Number.isFinite(previous)) at = new Date(Math.max(context.ports.now().getTime(), previous + 1)).toISOString();
  return at;
}
export type Restore = { schema: number; snapshotAt: string };
export async function prepareData(context: ModuleContext, moduleId: string, from: number | null, to: number, restore?: Restore) {
  const { platform } = context, live = join(platform, "data", moduleId), next = join(platform, "data-next", moduleId);
  const snapshots = join(platform, "snapshots", moduleId), at = await backupTime(context, snapshots, Boolean(restore));
  const snapshot = join(snapshots, restore ? `before-rollback-${at}` : `schema-${from}`);
  if (!restore) await rm(snapshot, { recursive: true, force: true });
  if (restore && await snapshotAt(context, moduleId, to) !== restore.snapshotAt) throw new Error("Snapshot changed");
  // Missing live data is also a valid empty backup when restoring a snapshot.
  if (restore && await dataEmpty(live)) await mkdir(snapshot, { recursive: true });
  else if (!await copyData(live, snapshot)) throw new Error("Data too large");
  if (restore) {
    const backups = (await readdir(snapshots)).filter(name => name.startsWith("before-rollback-")).sort().reverse();
    for (const name of backups.slice(3)) await rm(join(snapshots, name), { recursive: true, force: true });
  }
  await rm(next, { recursive: true, force: true });
  if (!await copyData(restore ? join(snapshots, `schema-${to}`) : live, next)) throw new Error("Data too large");
}
