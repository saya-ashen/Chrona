import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { currentTarget, grantedUses, moduleCallReplySchema, RUN_LIMITS, type ModuleCall, type ModuleEvent, type ModuleManifest } from "@chrona/contracts/steward";
import type { ModuleContext } from "./module-context";
import { createModuleChannel } from "./module-channel";

function buildCallResult(call: ModuleCall, manifest: ModuleManifest, seen: Set<string>): ReturnType<typeof moduleCallReplySchema.parse> {
  if (call.method === "callStatus") return { id: call.id, result: { callId: call.params.callId, status: "queued" } };
  const target = currentTarget(call.params.target), uses = grantedUses(manifest);
  if (!uses.includes(target) && !uses.includes("*")) return { id: call.id, error: { code: "undeclared", message: `${target} is not in uses` } };
  if (call.params.mode === "async") {
    const key = `${target}:${call.params.key}`, duplicate = seen.has(key);
    seen.add(key);
    return { id: call.id, result: { callId: randomUUID(), status: "queued", duplicate } };
  }
  if (target === "provider.complete") return { id: call.id, result: { output: { text: "Chrona test model response", inputTokens: 0, outputTokens: 0 } } };
  if (target.startsWith("secrets.")) return { id: call.id, error: { code: "unavailable", message: "No secrets during build" } };
  return { id: call.id, result: { output: null } };
}
async function createBuildDirs(data: string, dir: string, manifest: ModuleManifest) {
  const contentDir = manifest.content ? join(data, ".build-content") : undefined;
  if (contentDir) await mkdir(contentDir, { recursive: true });
  const httpDir = manifest.listen ? join(dir, "http") : undefined;
  if (httpDir) await mkdir(httpDir, { mode: 0o700 });
  return { contentDir, httpDir };
}
/** Build-only kernel: records public calls, never performs effects. */
export async function withBuildProcess<T>(context: ModuleContext, staging: string, data: string, manifest: ModuleManifest, run: (send: (event: ModuleEvent) => Promise<{ reply: Awaited<ReturnType<Awaited<ReturnType<typeof createModuleChannel>>["send"]>>; calls: ModuleCall[] }>) => Promise<T>) {
  if (!context.ports.sandbox?.available || !context.ports.sandbox.startModule) throw new Error("Module sandbox unavailable");
  const dir = await mkdtemp("/tmp/cb-");
  let process: ReturnType<NonNullable<typeof context.ports.sandbox.startModule>> | undefined;
  let channel: Awaited<ReturnType<typeof createModuleChannel>> | undefined;
  let calls: ModuleCall[] = [], seen = new Set<string>();
  try {
    await chmod(dir, 0o700);
    channel = await createModuleChannel(join(dir, "s"), { onCall: async call => {
      calls.push(call);
      // Routed calls are answered, never routed: a build reaches no other module, no credential and no model.
      return buildCallResult(call, manifest, seen);
    } });
    const { contentDir, httpDir } = await createBuildDirs(data, dir, manifest);
    process = context.ports.sandbox.startModule({ codeDir: staging, dataDir: data, ...(contentDir ? { contentDir } : {}), ...(httpDir ? { httpDir } : {}), entry: manifest.entry, socketPath: join(dir, "s"), network: false, ...(manifest.limits ? { memoryMb: manifest.limits.virtualMemoryMb } : {}) });
    const exited = process.exited.then(() => { throw new Error("Module process exited"); });
    void exited.catch(() => {});
    return await run(async event => {
      calls = []; seen = new Set();
      const reply = await Promise.race([channel!.send(event, RUN_LIMITS.jobTimeoutMs), exited]);
      return { reply, calls: [...calls] };
    });
  } finally {
    process?.kill();
    await channel?.close();
    await process?.exited.catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

export function syntheticEvents(manifest: ModuleManifest, now: string, tools = false): ModuleEvent[] {
  const params = Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value]));
  return [
    ...manifest.triggers.map(trigger => ({ now, params, trigger: { id: trigger.id, kind: "schedule" as const, firedAt: now } })),
    ...(tools ? manifest.tools.map(tool => ({ now, params, trigger: { id: tool.name, kind: "tool" as const, firedAt: now, args: Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, value]) => [key, "enum" in value && value.enum ? value.enum[0] : value.type === "string" ? "build" : value.type === "number" ? 0 : false])) } })) : []),
  ];
}
