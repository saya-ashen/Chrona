import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ModuleManifest } from "@chrona/contracts/steward";
import type { ModuleContext } from "./module-context";
import { createModuleChannel } from "./module-channel";

async function buildDirectories(data: string, dir: string, manifest: ModuleManifest) {
  const contentDir = manifest.content ? join(data, ".build-content") : undefined;
  if (contentDir) await mkdir(contentDir, { recursive: true });
  const httpDir = manifest.listen ? join(dir, "http") : undefined;
  if (httpDir) await mkdir(httpDir, { mode: 0o700 });
  return { contentDir, httpDir };
}
/** Startup only: connect to the SDK, never deliver business events or route calls. */
export async function checkBuildStartup(context: ModuleContext, staging: string, data: string, manifest: ModuleManifest) {
  if (!context.ports.sandbox?.available || !context.ports.sandbox.startModule) throw new Error("Module sandbox unavailable");
  const dir = await mkdtemp("/tmp/cb-");
  let process: ReturnType<NonNullable<typeof context.ports.sandbox.startModule>> | undefined;
  let channel: Awaited<ReturnType<typeof createModuleChannel>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await chmod(dir, 0o700);
    channel = await createModuleChannel(join(dir, "s"), { onCall: async call => ({ id: call.id, error: { code: "unavailable", message: "Calls unavailable during startup check" } }) });
    const { contentDir, httpDir } = await buildDirectories(data, dir, manifest);
    process = context.ports.sandbox.startModule({ codeDir: staging, dataDir: data, ...(contentDir ? { contentDir } : {}), ...(httpDir ? { httpDir } : {}), entry: manifest.entry, socketPath: join(dir, "s"), network: false, ...(manifest.limits ? { memoryMb: manifest.limits.virtualMemoryMb } : {}) });
    await Promise.race([channel.ping(), process.exited.then(() => { throw new Error("Module process exited"); }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Module startup timeout")), 10_000); })]);
  } finally {
    clearTimeout(timer);
    process?.kill();
    await channel?.close();
    await process?.exited.catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}
