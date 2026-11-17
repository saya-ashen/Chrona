import { moduleMaterialDigest, moduleMaterialRecord, snapshotModuleMaterial } from "./module-artifacts";
import { installDependencies } from "./checks/module-dependencies";
import { assertBuildOwnership, buildOwnershipError } from "./checks/module-build-ownership";
import { StewardError } from "../errors";
import { checkoutModule } from "./module-files";
import { versionMaterial } from "./module-source";
import { moduleModelSettings } from "../settings";
import { assertExternalModule, ModuleIdentityError } from "./module-identity";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { notifyLifecycle } from "../notify-user";
import { intentSchema, json, requireModule, type ModuleContext, type ModuleVersion, type BuildReport, type Proposal } from "./module-context";
import { runTests, checkContinuity } from "./checks/module-continuity";
import { advanceFixedCandidateSet } from "./module-group";
import { audit } from "../audit";
import { smokeRun } from "./checks/module-probe";
import { typecheckBuild, typecheckErrors } from "./checks/module-typecheck";
import { moduleOutputImpacts } from "./module-output-impact";
import { moduleToolExampleError } from "./module-tool-contract";

import { assertExactReleaseUpdateIn, ExactReleaseUpdateError } from "./module-exact-release";
import { requestReview, recoverReviews, superseded } from "./module-build-review";

async function stagingFiles(context: ModuleContext, version: ModuleVersion, report: BuildReport) {
  try {
    const staging = join(context.platform, "staging", version.id);
    assertBuildOwnership(context, staging);
    const source = await versionMaterial(context, version, staging);
    report.git = source.revision;
    await rm(staging, { recursive: true, force: true });
    await checkoutModule(context.platform, `staging/${version.id}`, source.files);
    const checked = await snapshotModuleMaterial(context.platform, `staging/${version.id}`, { verifyTree: true });
    if (moduleMaterialDigest(checked) !== moduleMaterialDigest(source.files)) throw new StewardError("conflict", "Module staging differs from its Git source");
    await Promise.all(source.files.map(file => chmod(join(staging, file.path), file.executable ? 0o555 : 0o444)));
    return source.sourceFiles;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof StewardError)) throw error;
    report.tests.push({ stdout: "", stderr: error instanceof StewardError ? error.message : "Module source files are missing; build interrupted. Submit the module again.", exitCode: 1 });
    await context.db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
    return null;
  }
}
async function installBuild(context: ModuleContext, staging: string, version: ModuleVersion) {
  const source = await versionMaterial(context, version, staging), explicit = moduleMaterialRecord(source.sourceFiles);
  const verify = async (path: string) => {
    if (explicit && moduleMaterialDigest(await snapshotModuleMaterial(context.platform, relative(context.platform, path), { verifyTree: true })) !== moduleMaterialDigest(source.files)) throw new StewardError("conflict", "Checked material changed before installation; existing files preserved");
  };
  await verify(staging);
  await mkdir(context.store, { recursive: true });
  const target = join(context.store, version.hash);
  try { await rename(staging, target); }
  catch (error) {
    if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await verify(target);
  }
}
async function modelManifestError(context: ModuleContext, manifest: ReturnType<typeof moduleManifestSchema.parse>) {
  if (!manifest.model) return null;
  const workspace = await context.db.workspace.findUniqueOrThrow({ where: { id: context.workspaceId } });
  const limits = moduleModelSettings(workspace.settings);
  return !limits ? "Module model capability unavailable: the owner must configure moduleModel through settings.update first; Chrona cannot set it for them"
    : manifest.model.maxCalls > limits.maxCallsPerEvent || manifest.model.maxOutputTokens > limits.maxOutputTokens ? "Module model limits exceed owner moduleModel settings" : null;
}
async function validateBuildManifest(context: ModuleContext, version: ModuleVersion, manifest: ReturnType<typeof moduleManifestSchema.parse>, report: BuildReport) {
  const { db } = context;
  let error = manifest.tools.map(moduleToolExampleError).find((value): value is string => value !== null) ?? null;
  if (!error) error = await modelManifestError(context, manifest);
  if (!error) return null;
  report.errors = [error];
  await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
  return { moduleId: version.moduleId, hash: version.hash, status: "rejected" as const, report };
}
/** v2-25: tests run only on an entry that type-checks against the SDK and call contracts. */
async function typecheckAndTest(context: ModuleContext, staging: string, manifest: ReturnType<typeof moduleManifestSchema.parse>, report: BuildReport) {
  const typecheck = await typecheckBuild(context, staging, manifest);
  if (typecheck.status !== "skipped") report.typecheck = typecheck;
  if (typecheck.status !== "failed") return runTests(context, staging, manifest, report.tests);
  report.errors = typecheckErrors(typecheck);
  return false;
}
function buildHasErrors(report: BuildReport) { return Boolean(report.errors?.length); }
async function checkBuildCandidate({ context, module, version, manifest, staging, report }: { context: ModuleContext; module: Awaited<ReturnType<typeof requireModule>>; version: ModuleVersion; manifest: ReturnType<typeof moduleManifestSchema.parse>; staging: string; report: BuildReport }): Promise<{ passed: boolean; needsMigration: boolean; dependencyFailure: boolean }> {
  const dependencies = await installDependencies(context, staging, manifest);
  if (dependencies) report.dependencies = dependencies.installed;
  if (dependencies?.errors.length) {
    report.errors = dependencies.errors.map(error => error.slice(0, 4000));
    return { passed: false, needsMigration: false, dependencyFailure: true };
  }
  let passed = await typecheckAndTest(context, staging, manifest, report), needsMigration = false;
  if (passed) {
    const continuity = { status: "skipped" as const, reason: "no data", fromSchema: module.dataSchema, toSchema: manifest.data.schema, migrated: false };
    report.continuity = continuity;
    ({ passed, needsMigration } = await checkContinuity(context, staging, module, manifest, continuity));
  }
  if (passed) report.errors = await smokeRun(context, staging, manifest);
  if (buildHasErrors(report)) passed = false; else delete report.errors;
  // Only engine-owned immutable copies are tested, hashed and installed.
  if (passed) {
    try { await installBuild(context, staging, version); }
    catch (error) {
      if (!(error instanceof StewardError)) throw error;
      passed = false; report.errors = [error.message];
    }
  }
  return { passed, needsMigration, dependencyFailure: false };
}
async function consumersBlock(context: ModuleContext, { manifest, report }: { module: { id: string; activeHash: string | null }; version: ModuleVersion; manifest: ReturnType<typeof moduleManifestSchema.parse>; report: BuildReport }) {
  if (!report.outputImpacts?.length || await checkDependentCallers(context, manifest, report.outputImpacts, report)) return false;
  return true;
}
async function checkDependentCallers(context: ModuleContext, manifest: ReturnType<typeof moduleManifestSchema.parse>, impacts: { caller: string; targets: string[] }[], report: BuildReport) {
  report.dependentChecks = [];
  const consumers = await context.db.module.findMany({ where: { workspaceId: context.workspaceId, name: { in: impacts.map(item => item.caller) }, status: "active", activeHash: { not: null } } });
  for (const caller of consumers) {
    const active = await context.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.id, hash: caller.activeHash! } } });
    const source = moduleManifestSchema.safeParse(active?.manifest);
    if (!source.success) {
      report.dependentChecks.push({ caller: caller.name, status: "skipped", reason: "active caller manifest unavailable" });
      continue;
    }
    const checked = await typecheckBuild(context, join(context.store, caller.activeHash!), source.data, { moduleName: manifest.name, manifest });
    report.dependentChecks.push({ caller: caller.name, status: checked.status, ...(checked.reason ? { reason: checked.reason } : {}), ...(checked.errors ? { errors: checked.errors } : {}) });
    if (checked.status === "failed") return false;
  }
  return true;
}
async function finishBuild(input: { context: ModuleContext; module: Awaited<ReturnType<typeof requireModule>>; version: ModuleVersion; manifest: ReturnType<typeof moduleManifestSchema.parse>; report: BuildReport; checks: Awaited<ReturnType<typeof checkBuildCandidate>>; files: NonNullable<Awaited<ReturnType<typeof stagingFiles>>> }): Promise<Proposal> {
  const { context, module, version, manifest, report, checks, files } = input;
  const { db } = context, { hash } = version;
  if (checks.dependencyFailure) {
    await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
    return { moduleId: module.id, hash, status: "rejected", report };
  }
  let { passed } = checks;
  const { needsMigration } = checks;
  if (passed) {
    report.outputImpacts = await moduleOutputImpacts(db, module.workspaceId, module.id, manifest);
    if (await consumersBlock(context, { module, version, manifest, report })) {
      passed = false;
      report.errors = ["An affected caller failed type checking against the candidate contract; update/review caller compatibility before activating this version."];
    }
  }
  const status = passed ? "pending_review" : "rejected";
  await db.moduleVersion.update({ where: { id: version.id }, data: { report: json(report), status } });
  if (!passed) return { moduleId: module.id, hash, status, report };
  return requestReview(context, { version, module, report, files, needsMigration });
}
async function buildVersion(context: ModuleContext, version: ModuleVersion): Promise<Proposal> {
  const { db, platform } = context, { hash } = version;
  const staging = join(platform, "staging", version.id);
  const { git, exactReleaseUpdate } = version.report as BuildReport;
  const report: BuildReport = { tests: [], ...(git ? { git } : {}), ...(exactReleaseUpdate ? { exactReleaseUpdate } : {}) };
  assertBuildOwnership(context, staging);
  try {
    const module = await assertExternalModule(db, context.workspaceId, version.moduleId, "build");
    await assertExactReleaseUpdateIn(context, db, module.id, report, module);
    const manifest = moduleManifestSchema.parse(version.manifest);
    intentSchema.parse(version.intent);
    const files = await stagingFiles(context, version, report);
    if (!files) return { moduleId: module.id, hash, status: "rejected", report };
    // Manifest capabilities are checked before dependencies or code can run.
    const invalidManifest = await validateBuildManifest(context, version, manifest, report);
    if (invalidManifest) return invalidManifest;
    const checks = await checkBuildCandidate({ context, module, version, manifest, staging, report });
    return await finishBuild({ context, module, version, manifest, report, checks, files });
  } finally { if (!buildOwnershipError(context, staging)) await rm(staging, { recursive: true, force: true }); }
}
async function recoverBuilds(context: ModuleContext, now: Date) {
  const { db, workspaceId } = context;
  // Audit claim time keeps submission timestamps intact and out of public output.
  await db.$transaction(async tx => {
    const testing = await tx.moduleVersion.findMany({ where: { module: { workspaceId }, status: "testing" } });
    for (const version of testing) {
      if (buildOwnershipError(context, join(context.platform, "staging", version.id))) continue;
      const claim = await tx.audit.findFirst({ where: { workspaceId, kind: "module_build_started", subjectId: version.id }, orderBy: { createdAt: "desc" } });
      if ((claim?.createdAt ?? version.createdAt).getTime() <= now.getTime() - 15 * 60_000) await tx.moduleVersion.updateMany({ where: { id: version.id, status: "testing" }, data: { status: "building" } });
    }
  });
}
async function reportFailure(context: ModuleContext, version: ModuleVersion, result: Proposal) {
  const { db, ports, workspaceId } = context;
  const module = await requireModule(context, db, version.moduleId);
  const versions = await db.moduleVersion.findMany({ where: { moduleId: module.id, status: { in: ["rejected", "pending_review", "approved"] } }, orderBy: { createdAt: "desc" } });
  let failures = 0;
  // A superseded version passed its checks: it ends a failure streak like a pending one.
  for (const row of versions) { if (row.status !== "rejected" || superseded(row.report)) break; failures++; }
  if (failures >= 3) {
    // Key streak by preceding successful build; failures may share timestamps.
    await notifyLifecycle(db, ports, workspaceId, `module-build-failed:${module.id}:${versions[failures]?.id ?? "initial"}`, { kind: "module-build-failed", app: module.name, module: module.id });
  } else {
    // Keep continuity diagnostics visible even when successful tests printed a lot.
    const summary = result.report.continuity ? { continuity: result.report.continuity } : result.report;
    const publicReport = JSON.stringify(summary, (key, value: unknown) => ["stdout", "stderr"].includes(key) && typeof value === "string" ? value.slice(0, 1500) : value);
    await audit(db, { workspaceId, actor: "chrona", kind: "module_build_failed", subjectId: module.id, details: { versionId: version.id, hash: version.hash, report: publicReport.slice(0, 8000) } });
  }
}
export async function buildPending(context: ModuleContext, now = context.ports.now()) {
  const { db, workspaceId } = context;
  await recoverBuilds(context, now);
  await recoverReviews(context);
  const pending = await db.moduleVersion.findMany({ where: { module: { workspaceId }, status: "building" }, orderBy: { createdAt: "asc" }, take: 3 });
  for (const version of pending) {
    const claimed = await db.$transaction(async tx => {
      const changed = await tx.moduleVersion.updateMany({ where: { id: version.id, status: "building" }, data: { status: "testing" } });
      if (changed.count) await tx.audit.create({ data: { workspaceId, actorKey: "chrona", kind: "module_build_started", subjectId: version.id, details: {}, createdAt: now } });
      return changed.count > 0;
    });
    if (!claimed) continue;
    let result: Proposal, identityRejected = false;
    try { result = await buildVersion(context, version); }
    catch (error) {
      if (!(error instanceof ModuleIdentityError || error instanceof ExactReleaseUpdateError)) throw error;
      identityRejected = true;
      console.error(JSON.stringify({ component: "module-build", event: "candidate.rejected", versionId: version.id, error: error.message }));
      const report: BuildReport = { ...(version.report as BuildReport), tests: [], errors: [String(error).slice(0, 4000)] };
      await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
      result = { moduleId: version.moduleId, hash: version.hash, status: "rejected", report };
    }
    await advanceFixedCandidateSet(context, version);
    if (result.status === "rejected" && version.source === "provider" && !identityRejected) await reportFailure(context, version, result);
  }
}
