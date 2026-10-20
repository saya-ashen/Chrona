import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, moduleOutputSchema, type ModuleManifest } from "@chrona/contracts/steward";
import { nextOccurrence } from "@chrona/domain/steward/schedule-rule";
import type { ModuleContext, ReplayReport, ReplayResult, requireModule } from "./module-context";
import { moduleParams } from "./module-continuity";
import { copyData, dataEmpty, runOfflineLimited } from "./module-data";
import { notificationSettings } from "./settings";

type Module = Awaited<ReturnType<typeof requireModule>>;
type Instant = { triggerId: string; firedAt: string };
const budgetMs = 5 * 60_000;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value)!;
}
function skip(report: ReplayReport, reason: string) { report.status = "skipped"; report.reason = reason; }
function skipReason(old: ModuleManifest, proposed: ModuleManifest) {
  if (old.effects.includes("network") || proposed.effects.includes("network")) return "network";
  const triggers = (manifest: ModuleManifest) => Object.fromEntries(manifest.triggers.map(trigger => [trigger.id, trigger.schedule]));
  return canonicalJson(triggers(old)) === canonicalJson(triggers(proposed)) ? null : "triggers changed";
}
function sequence(manifest: ModuleManifest, now: Date, zone: string): Instant[] {
  const pending = manifest.triggers.map(trigger => ({ trigger, at: nextOccurrence(trigger.schedule, now, zone) })), instants: Instant[] = [];
  for (let step = 0; step < 10; step++) {
    const next = pending.filter(item => item.at).sort((a, b) => a.at!.getTime() - b.at!.getTime()).at(0);
    if (!next) break;
    instants.push({ triggerId: next.trigger.id, firedAt: next.at!.toISOString() });
    next.at = nextOccurrence(next.trigger.schedule, next.at!, zone);
  }
  return instants;
}
async function resultAt(context: ModuleContext, code: string, data: string, options: { manifest: ModuleManifest; instant: Instant; deadline: number }): Promise<ReplayResult> {
  const { manifest, instant, deadline } = options;
  try {
    const { triggerId: id, firedAt } = instant;
    const run = await runOfflineLimited(context.ports, code, data, { entry: manifest.entry, input: { trigger: { id, kind: "schedule", firedAt }, now: firedAt, params: moduleParams(manifest) }, timeoutMs: Math.max(1, deadline - performance.now()) });
    if (run.result.exitCode !== 0) return { ok: false };
    const output = moduleOutputSchema.safeParse(JSON.parse(run.result.output));
    return output.success ? { ok: true, effects: output.data.effects } : { ok: false };
  } catch { return { ok: false }; }
}
type Copies = { old: string; proposed: string; staging: string; manifest: ModuleManifest; previous: ModuleManifest; deadline: number };
async function prepareCopies(context: ModuleContext, module: Module, copies: Copies, report: ReplayReport) {
  const { old, proposed, staging, manifest, deadline } = copies;
  const now = context.ports.now(), live = join(context.platform, "data", module.id), empty = await dataEmpty(live);
  if (!empty && (!await copyData(live, old) || !await copyData(live, proposed))) { skip(report, "data too large"); return; }
  if (performance.now() >= deadline) { skip(report, "time budget"); return; }
  if (!empty && module.dataSchema !== null && manifest.data.schema > module.dataSchema) {
    const migration = await runOfflineLimited(context.ports, staging, proposed, { entry: manifest.data.migrate!, input: { migrate: { from: module.dataSchema, to: manifest.data.schema }, now: now.toISOString() }, timeoutMs: Math.max(1, deadline - performance.now()) });
    if (!migration.succeeded) throw new Error("Replay migration failed");
  }
  return now;
}
async function simulate(context: ModuleContext, module: Module, copies: Copies, report: ReplayReport) {
  const { old, proposed, staging, manifest, previous, deadline } = copies;
  const now = await prepareCopies(context, module, copies, report);
  if (!now) return;
  const zone = notificationSettings((await context.db.workspace.findUniqueOrThrow({ where: { id: context.workspaceId } })).settings).timezone;
  for (const instant of sequence(previous, now, zone)) {
    if (performance.now() >= deadline) break;
    const before = await resultAt(context, join(context.store, module.activeHash!), old, { manifest: previous, instant, deadline });
    if (performance.now() >= deadline) break;
    const after = await resultAt(context, staging, proposed, { manifest, instant, deadline });
    report.steps++;
    if (canonicalJson(before) === canonicalJson(after)) continue;
    report.status = "different";
    if (report.diffs.length < 5) report.diffs.push({ step: report.steps, ...instant, old: before, new: after });
  }
  if (performance.now() >= deadline) skip(report, "time budget");
}
export async function checkReplay(context: ModuleContext, staging: string, module: Module, manifest: ModuleManifest): Promise<ReplayReport> {
  const report: ReplayReport = { status: "identical", steps: 0, diffs: [] }, deadline = performance.now() + budgetMs;
  let root: string | undefined;
  try {
    if (!module.activeHash) { skip(report, "first version"); return report; }
    const active = await context.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
    const previous = moduleManifestSchema.parse(active.manifest), reason = skipReason(previous, manifest);
    if (reason) { skip(report, reason); return report; }
    root = await mkdtemp(join(tmpdir(), "chrona-module-replay-"));
    const old = join(root, "old"), proposed = join(root, "new");
    await mkdir(old); await mkdir(proposed);
    await simulate(context, module, { old, proposed, staging, manifest, previous, deadline }, report);
  } catch { skip(report, performance.now() >= deadline ? "time budget" : "simulation failed"); }
  finally { if (root) await rm(root, { recursive: true, force: true }); }
  return report;
}
