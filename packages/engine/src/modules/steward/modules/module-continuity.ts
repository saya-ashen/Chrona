import { assertBuildOwnership, buildOwnershipError, holdBuildOwnership } from "./module-build-ownership";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, RUN_LIMITS } from "@chrona/contracts/steward";
import type { z } from "zod";
import { copyData, dataEmpty, runOffline } from "./module-data";
import type { ModuleContext, ContinuityReport, TestReport, requireModule } from "./module-context";

type Manifest = z.output<typeof moduleManifestSchema>;
type Module = Awaited<ReturnType<typeof requireModule>>;
async function copyTestData(source: string | undefined, target: string) { return source ? copyData(source, target) : true; }
export const moduleParams = (manifest: Manifest) => Object.fromEntries(Object.entries(manifest.params).map(([key, param]) => [key, param.value]));
async function prepareTestContent(data: string, manifest: Manifest) {
  if (!manifest.content) return undefined;
  const contentDir = join(data, ".build-content");
  await mkdir(contentDir, { recursive: true });
  return contentDir;
}
async function runOneTest(context: ModuleContext, staging: string, manifest: Manifest, entry: string, options: { tests: TestReport; sourceData?: string }) {
  assertBuildOwnership(context, staging);
  const { tests, sourceData } = options, { ports } = context, sandbox = ports.sandbox;
  if (!sandbox?.available || !sandbox.runModule) return false;
  const data = await mkdtemp(join(tmpdir(), "chrona-module-test-"));
  try {
    if (!await copyTestData(sourceData, data)) return false;
    const contentDir = await prepareTestContent(data, manifest);
    const result = await sandbox.runModule({ codeDir: staging, dataDir: data, ...(contentDir ? { contentDir } : {}), entry, input: { now: ports.now().toISOString(), params: moduleParams(manifest) }, network: false, timeoutMs: RUN_LIMITS.jobTimeoutMs, maxOutputBytes: RUN_LIMITS.jobOutputBytes });
    tests.push({ stdout: result.output.slice(0, RUN_LIMITS.jobOutputBytes), stderr: (result.error ?? "").slice(0, RUN_LIMITS.jobOutputBytes), exitCode: result.exitCode ?? 1 });
    return result.status === "succeeded" && result.exitCode === 0;
  } catch (error) {
    if (holdBuildOwnership(context, staging, error)) throw error;
    return false;
  } finally { if (!buildOwnershipError(context, staging)) await rm(data, { recursive: true, force: true }); }
}
export async function runTests(context: ModuleContext, staging: string, manifest: Manifest, tests: TestReport, sourceData?: string) {
  let passed = true;
  for (const entry of manifest.tests) {
    if (!await runOneTest(context, staging, manifest, entry, { tests, sourceData })) passed = false;
  }
  return passed;
}
function fail(continuity: ContinuityReport, reason: string) {
  continuity.status = "failed"; continuity.reason = reason;
}
type ContinuityCopy = { staging: string; data: string; manifest: Manifest; continuity: ContinuityReport };
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
  const tests: TestReport = [];
  const passed = await runTests(context, staging, manifest, tests, data);
  // Tests can read private live-data copies: keep outcomes, never publish their contents through stdout/stderr.
  continuity.tests = tests.map(test => ({ exitCode: test.exitCode, stdout: "", stderr: "" }));
  if (!passed) { fail(continuity, "author tests failed on copied data"); return; }
  continuity.status = "passed"; delete continuity.reason;
}
function schemaFailure(from: number | null, to: number, empty: boolean, manifest: Manifest) {
  if (from !== null && to < from) return "schema 不能降低；降级只能经回滚";
  if (from !== null && to > from && !empty && !manifest.data.migrate) return "schema 升级需要 migrate";
  return null;
}
export async function checkContinuity(context: ModuleContext, staging: string, module: Module, manifest: Manifest, continuity: ContinuityReport) {
  assertBuildOwnership(context, staging);
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
  } catch (error) {
    if (holdBuildOwnership(context, staging, error)) throw error;
    fail(continuity, "continuity check failed");
  } finally { if (data && !buildOwnershipError(context, staging)) await rm(data, { recursive: true, force: true }); }
  return { passed: continuity.status !== "failed", needsMigration };
}
