import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, moduleOutputSchema } from "@chrona/contracts/steward";
import type { z } from "zod";
import { runOffline } from "./module-data";
import { moduleParams } from "./module-continuity";
import type { KeyProbe, ModuleContext } from "./module-context";

type Manifest = z.output<typeof moduleManifestSchema>;
/** Metamorphic check (docs/zh/platform-p5-spec.md): fires on two different days must not reuse an effect key,
 * or the executor drops the later effect as a duplicate. A warning, not a rejection: "notify once ever" is legal. */
export async function probeKeys(context: ModuleContext, staging: string, manifest: Manifest): Promise<KeyProbe> {
  const trigger = manifest.triggers.find(candidate => "schedule" in candidate);
  if (!trigger) return { status: "skipped", reason: "no schedule trigger" };
  const data = await mkdtemp(join(tmpdir(), "chrona-module-probe-"));
  try {
    const fires: string[][] = [];
    for (const day of [0, 1]) {
      const at = new Date(context.ports.now().getTime() + day * 86_400_000).toISOString();
      const run = await runOffline(context.ports, staging, data, manifest.entry, { trigger: { id: trigger.id, kind: "schedule", firedAt: at }, now: at, params: moduleParams(manifest) });
      const output = run.succeeded ? moduleOutputSchema.safeParse((() => { try { return JSON.parse(run.result.output) as unknown; } catch { return null; } })()) : null;
      if (!output?.success) return { status: "skipped", reason: "entry failed or invalid output" };
      fires.push(output.data.effects.map(effect => `${effect.type}:${effect.key}`));
    }
    const [first, second] = fires as [string[], string[]];
    if (!first.length || !second.length) return { status: "skipped", reason: "no effects on both fires" };
    const repeated = first.filter(key => second.includes(key));
    return repeated.length ? { status: "repeated", keys: repeated.slice(0, 10) } : { status: "passed" };
  } catch { return { status: "skipped", reason: "probe failed" }; }
  finally { await rm(data, { recursive: true, force: true }); }
}
export function keyProbePreview(probe: KeyProbe | undefined) {
  if (!probe) return "";
  if (probe.status === "repeated") return `⚠ 幂等键检查：不同日期的两次触发产生了相同的 key（${probe.keys!.join("、")}），后一次会被当作重复丢弃；不会自动启用\n`;
  return "幂等键检查：passed\n";
}
