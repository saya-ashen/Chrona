import { assertBuildOwnership, holdBuildOwnership } from "./module-build-ownership";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ModuleManifest } from "@chrona/contracts/steward";
import type { ModuleContext } from "../module-context";
import { createModuleChannel } from "../module-channel";
import { moduleHttpReady } from "../module-http-ready";

async function confirmBuildStop(context: ModuleContext, staging: string, process: { exited: Promise<unknown> } | undefined) {
  try { await process?.exited; }
  catch (error) { holdBuildOwnership(context, staging, error); throw error; }
}

/** Startup only: authenticate the SDK, check its protocol and declared listener, never deliver business events. */
export async function checkBuildStartup(context: ModuleContext, staging: string, data: string, manifest: ModuleManifest) {
  assertBuildOwnership(context, staging);
  if (!context.ports.sandbox?.available || !context.ports.sandbox.startModule) throw new Error("Module sandbox unavailable");
  let process: ReturnType<NonNullable<typeof context.ports.sandbox.startModule>> | undefined;
  let channel: Awaited<ReturnType<typeof createModuleChannel>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    channel = await createModuleChannel({ onCall: async call => ({ id: call.id, error: { code: "unavailable",
      message: "Calls unavailable during startup check" } }) });
    const contentDir = manifest.content ? join(data, ".build-content") : undefined;
    if (contentDir) await mkdir(contentDir, { recursive: true });
    process = context.ports.sandbox.startModule({ codeDir: staging, dataDir: data, ...(contentDir ? { contentDir } : {}),
      entry: manifest.entry, ipcEndpoint: channel.endpoint, ipcToken: channel.token, network: false });
    const ready = Promise.all([channel.ping(), ...(manifest.listen ? [moduleHttpReady(channel)] : [])]);
    await Promise.race([ready, process.exited.then(() => { throw new Error("Module process exited"); }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Module startup timeout")), 10_000); })]);
  } finally {
    clearTimeout(timer);
    process?.kill();
    try { await channel?.close(); }
    finally { await confirmBuildStop(context, staging, process); }
  }
}
