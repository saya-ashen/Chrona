import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { z } from "zod";
import { syntheticEvents, withBuildProcess } from "./module-build-process";
import type { KeyProbe, ModuleContext } from "./module-context";

type Manifest = z.output<typeof moduleManifestSchema>;
/** Metamorphic check (docs/zh/platform-p5-spec.md): fires on two different days must not reuse an effect key,
 * or the executor drops the later effect as a duplicate. A warning, not a rejection: "notify once ever" is legal. */
export async function probeKeys(context: ModuleContext, staging: string, manifest: Manifest): Promise<KeyProbe> {
  const trigger = manifest.triggers.find(candidate => "schedule" in candidate) ?? manifest.triggers[0];
  if (!trigger) return { status: "skipped", reason: "no schedule trigger" };
  const data = await mkdtemp(join(tmpdir(), "chrona-module-probe-"));
  try {
    const fires = await withBuildProcess(context, staging, data, manifest, async send => {
      const fires: string[][] = [];
      for (const day of [0, 1]) {
        const at = new Date(context.ports.now().getTime() + day * 86_400_000).toISOString();
        const event = syntheticEvents(manifest, at).find(event => event.trigger.id === trigger.id)!;
        const output = await send(event);
        if ("error" in output.reply) throw new Error("Entry failed");
        fires.push(output.calls.flatMap(call => call.method === "notify" ? [`notify_user:${call.params.key}`] : call.method === "wakeProvider" ? [`wake_provider:${call.params.key}`] : []));
      }
      return fires;
    });
    const [first, second] = fires as [string[], string[]];
    if (!first.length || !second.length) return { status: "skipped", reason: "no effects on both fires" };
    const repeated = first.filter(key => second.includes(key));
    return repeated.length ? { status: "repeated", keys: repeated.slice(0, 10) } : { status: "passed" };
  } catch { return { status: "skipped", reason: "entry failed or invalid output" }; }
  finally { await rm(data, { recursive: true, force: true }); }
}
/** Chrona's own event checks on empty data, independent of author tests. */
export async function smokeRun(context: ModuleContext, staging: string, manifest: Manifest) {
  const now = context.ports.now().toISOString(), errors: string[] = [];
  for (const event of syntheticEvents(manifest, now, true)) {
    const { trigger } = event;
    const data = await mkdtemp(join(tmpdir(), "chrona-module-smoke-"));
    try {
      const { reply } = await withBuildProcess(context, staging, data, manifest, send => send(event));
      if ("error" in reply) errors.push(`smoke ${trigger.kind} ${trigger.id}: ${reply.error}`);
    } catch { errors.push(`smoke ${trigger.kind} ${trigger.id}: sandbox run failed`); }
    finally { await rm(data, { recursive: true, force: true }); }
  }
  return errors;
}
export function keyProbePreview(probe: KeyProbe | undefined) {
  if (!probe) return "";
  if (probe.status === "skipped") return `⚠ 幂等键检查：${probe.reason}；不会自动启用\n`;
  if (probe.status === "repeated") return `⚠ 幂等键检查：不同日期的两次触发产生了相同的 key（${probe.keys!.join("、")}），后一次会被当作重复丢弃；不会自动启用\n`;
  return "幂等键检查：passed\n";
}
