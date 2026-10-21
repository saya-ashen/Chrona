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
      const output = run.succeeded ? moduleOutputSchema.safeParse(parse(run.result.output)) : null;
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
const parse = (text: string): unknown => { try { return JSON.parse(text) as unknown; } catch { return null; } };
/** Chrona's own run of the entry on empty data: module tests may never execute it (seen: grep-only tests).
 * Returns public failure reasons. Exported tools are not called: their arguments cannot be synthesized. */
export async function smokeRun(context: ModuleContext, staging: string, manifest: Manifest) {
  const now = context.ports.now().toISOString(), errors: string[] = [];
  const schedule = manifest.triggers.find(candidate => "schedule" in candidate), inbound = manifest.triggers.find(candidate => "inbound" in candidate);
  const triggers = [
    ...(schedule ? [{ id: schedule.id, kind: "schedule", firedAt: now }] : []),
    ...(inbound ? [{ id: inbound.id, kind: "inbound", firedAt: now, item: { externalId: "smoke", from: "smoke@chrona.invalid", subject: "Chrona smoke test", receivedAt: now, body: "" } }] : []),
  ];
  for (const trigger of triggers) {
    const data = await mkdtemp(join(tmpdir(), "chrona-module-smoke-"));
    try {
      const run = await runOffline(context.ports, staging, data, manifest.entry, { trigger, now, params: moduleParams(manifest) });
      if (!run.succeeded) errors.push(`smoke ${trigger.kind} ${trigger.id}: exit ${run.output.exitCode}: ${run.output.stderr.slice(0, 1500)}`);
      else if (!moduleOutputSchema.safeParse(parse(run.result.output)).success) errors.push(`smoke ${trigger.kind} ${trigger.id}: stdout is not valid module output: ${run.output.stdout.slice(0, 500)}`);
    } catch { errors.push(`smoke ${trigger.kind} ${trigger.id}: sandbox run failed`); }
    finally { await rm(data, { recursive: true, force: true }); }
  }
  return errors;
}
export function keyProbePreview(probe: KeyProbe | undefined) {
  if (!probe) return "";
  if (probe.status === "repeated") return `⚠ 幂等键检查：不同日期的两次触发产生了相同的 key（${probe.keys!.join("、")}），后一次会被当作重复丢弃；不会自动启用\n`;
  return "幂等键检查：passed\n";
}
