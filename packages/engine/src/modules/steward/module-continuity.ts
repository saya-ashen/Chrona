import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, moduleOutputSchema, RUN_LIMITS } from "@chrona/contracts/steward";
import type { z } from "zod";
import { copyData, dataEmpty, runOffline } from "./module-data";
import type { ModuleContext, ContinuityReport, TestReport, requireModule } from "./module-context";

type Manifest = z.output<typeof moduleManifestSchema>;
type Module = Awaited<ReturnType<typeof requireModule>>;
export const moduleParams = (manifest: Manifest) => Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value]));
export async function runTests(context: ModuleContext, staging: string, manifest: Manifest, tests: TestReport) {
  const { ports } = context;
  let passed = true;
  for (const entry of manifest.tests) {
    const data = await mkdtemp(join(tmpdir(), "chrona-module-test-"));
    try {
      if (!ports.sandbox?.available || !ports.sandbox.runModule) { passed = false; break; }
      const result = await ports.sandbox.runModule({ codeDir: staging, dataDir: data, entry, input: { now: ports.now().toISOString(), params: moduleParams(manifest) }, network: false, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes });
      tests.push({ stdout: result.output.slice(0, RUN_LIMITS.jobOutputBytes), stderr: (result.error ?? "").slice(0, RUN_LIMITS.jobOutputBytes), exitCode: result.exitCode ?? 1 });
      if (result.status !== "succeeded" || result.exitCode !== 0) passed = false;
    } catch { passed = false; }
    finally { await rm(data, { recursive: true, force: true }); }
  }
  return passed;
}
function fail(continuity: ContinuityReport, reason: string) {
  continuity.status = "failed"; continuity.reason = reason;
}
type ContinuityCopy = { staging: string; data: string; manifest: Manifest; continuity: ContinuityReport };
async function checkEntry(context: ModuleContext, copy: ContinuityCopy, now: string) {
  const { staging, data, manifest, continuity } = copy;
  const entry = await runOffline(context.ports, staging, data, manifest.entry, { trigger: { id: manifest.triggers[0]!.id, kind: "schedule", firedAt: now }, now, params: moduleParams(manifest) });
  continuity.output = entry.output;
  if (!entry.succeeded) { fail(continuity, "entry failed"); return; }
  let output;
  try { output = moduleOutputSchema.parse(JSON.parse(entry.result.output)); } catch { /* Public output only; no parser diagnostics. */ }
  if (!output) { fail(continuity, "invalid moduleOutput"); return; }
  continuity.status = "passed"; delete continuity.reason; continuity.effects = output.effects;
}
async function checkCopy(context: ModuleContext, live: string, copy: ContinuityCopy) {
  const { staging, data, manifest, continuity } = copy;
  if (!await copyData(live, data)) { continuity.reason = "data too large"; return; }
  const { fromSchema: from, toSchema: to } = continuity, now = context.ports.now().toISOString();
  if (from !== null && to > from) {
    const migration = await runOffline(context.ports, staging, data, manifest.data.migrate!, { migrate: { from, to }, now });
    continuity.migration = migration.output;
    if (!migration.succeeded) { fail(continuity, "migrate failed"); return; }
    continuity.migrated = true;
  }
  await checkEntry(context, copy, now);
}
function schemaFailure(from: number | null, to: number, empty: boolean, manifest: Manifest) {
  if (from !== null && to < from) return "schema 不能降低；降级只能经回滚";
  if (from !== null && to > from && !empty && !manifest.data.migrate) return "schema 升级需要 migrate";
  return null;
}
export async function checkContinuity(context: ModuleContext, staging: string, module: Module, manifest: Manifest, continuity: ContinuityReport) {
  const from = module.dataSchema, to = manifest.data.schema, live = join(context.platform, "data", module.id);
  let data: string | undefined, needsMigration = false;
  try {
    const empty = await dataEmpty(live);
    needsMigration = from !== null && to > from && !empty;
    const reason = schemaFailure(from, to, empty, manifest);
    if (reason) fail(continuity, reason);
    else if (module.activeHash && !empty) {
      data = await mkdtemp(join(tmpdir(), "chrona-module-continuity-"));
      await checkCopy(context, live, { staging, data, manifest, continuity });
    }
  } catch { fail(continuity, "continuity check failed"); }
  finally { if (data) await rm(data, { recursive: true, force: true }); }
  return { passed: continuity.status !== "failed", needsMigration };
}
