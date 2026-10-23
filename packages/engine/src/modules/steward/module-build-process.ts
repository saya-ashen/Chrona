import { chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { MODULE_METHODS, RUN_LIMITS, type ModuleCall, type ModuleEvent, type ModuleManifest } from "@chrona/contracts/steward";
import type { ModuleContext } from "./module-context";
import { createModuleChannel } from "./module-channel";

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
      if (!manifest.effects.includes(MODULE_METHODS[call.method])) return { id: call.id, error: { code: "undeclared", message: "Undeclared capability" } };
      const key = `${call.method}:${call.params.key}`, duplicate = seen.has(key);
      seen.add(key);
      return { id: call.id, result: { status: duplicate ? "duplicate" : "executed" } };
    } });
    process = context.ports.sandbox.startModule({ codeDir: staging, dataDir: data, entry: manifest.entry, socketPath: join(dir, "s"), network: false });
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
    ...manifest.triggers.map(trigger => ({ now, params, trigger: "schedule" in trigger
      ? { id: trigger.id, kind: "schedule" as const, firedAt: now }
      : { id: trigger.id, kind: "inbound" as const, firedAt: now, item: { externalId: "build", from: "build@chrona.invalid", subject: "Chrona build check", receivedAt: now, body: "" } } })),
    ...(tools ? manifest.tools.map(tool => ({ now, params, trigger: { id: tool.name, kind: "tool" as const, firedAt: now, args: Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, value]) => [key, "enum" in value ? value.enum[0] : value.type === "string" ? "build" : value.type === "number" ? 0 : false])) } })) : []),
  ];
}
