import { onApproved } from "./module-activation";
import { assertExecutionModuleIdle } from "./execution-module-guard";
import { requiresCapabilityApproval } from "./module-owner";
import { isTrustedInitialInstallation, matchesInitialInstallation } from "./module-install";
import { moduleMaterialDigest, moduleMaterialRecord, snapshotModuleMaterial } from "./module-artifacts";
import { activationNotice } from "./module-activation-notice";
import { installDependencies } from "./module-dependencies";
import { fenceExecutionVersionChange } from "./execution-delivery-controls";
import { assertBuildOwnership, buildOwnershipError } from "./module-build-ownership";
import { StewardError } from "./errors";
import { checkoutModule } from "./module-files";
import { readVersionSource, versionSource, versionMaterial } from "./module-source";
import { moduleModelSettings } from "./settings";
import { assertExternalModule, ModuleIdentityError } from "./module-identity";
import { ModuleUnavailableError } from "./module-availability";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createApprovals } from "./approvals";
import { notifyLifecycle } from "./notify-user";
import { intentSchema, groupPayloadSchema, json, requireModule, expireModuleApprovals, type ModuleContext, type ModuleVersion, type BuildReport, type Proposal } from "./module-context";
import { runTests, checkContinuity } from "./module-continuity";
import { advanceFixedCandidateSet, isGroupCandidate, recordGroupReview } from "./module-group";
import { findCandidateSet } from "./module-candidate-records";
import { dataEmpty } from "./module-data";
import { redactSensitiveText } from "@chrona/logging/redaction";
import { activateIn } from "./module-generation";
import { audit } from "./audit";
import { smokeRun } from "./module-probe";
import { typecheckBuild, typecheckErrors } from "./module-typecheck";
import { moduleOutputImpacts, outputImpactSummary } from "./module-output-impact";
import { moduleToolExampleError } from "./module-tool-contract";
import { codeDifference, compactDiff, continuityPreview, insertCodeDiff } from "./module-preview";

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
type Review = { version: ModuleVersion; module: Awaited<ReturnType<typeof requireModule>>; report: BuildReport; files: { path: string; bytes: Buffer }[]; needsMigration: boolean };
/** Only an automatic activation that actually waited for drain may bypass submission order. */
type DrainReport = BuildReport & { activationWait?: Pick<Review["module"], "activeHash" | "activationId"> };
function exposedTools(manifest: ReturnType<typeof moduleManifestSchema.parse>) {
  return manifest.tools.filter(tool => tool.visibility.some(value => value === "modules" || value === "kernel")).map(tool => tool.name);
}
function reviewPrefix(manifest: ReturnType<typeof moduleManifestSchema.parse>, report: BuildReport, diff: string) {
  const libraries = [report.dependencies?.npm && "npm（bun.lock）", report.dependencies?.python && "Python（uv.lock）"].filter(Boolean).join("、") || "无";
  const exposed = exposedTools(manifest);
  return `联网：${manifest.effects.includes("network") ? "是" : "否"}\n调用其他模块：${manifest.uses.map(target => target === "*" ? "所有对你开放的工具（*）" : target).join("、") || "无"}；供其他模块调用：${exposed.join("、") || "无"}\n系统程序：${manifest.packages.join("、") || "无"}；语言库：${libraries}\n${diff}\n`;
}
/** Output schemas and examples describe results, not authority: the review shows their digest, so declaring contracts still fits the preview. */
export function reviewManifest(value: unknown) {
  const digest = (part: unknown) => { const text = JSON.stringify(part); return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 12)}（${text.length} 字符，完整内容见版本）`; };
  const manifest = value as { tools?: unknown } | null;
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.tools)) return JSON.stringify(value ?? "", null, 2);
  const tools = manifest.tools.map(tool => tool && typeof tool === "object"
    ? Object.fromEntries(Object.entries(tool).map(([key, part]) => [key, (key === "output" || key === "examples") && part != null ? digest(part) : part])) : tool);
  return JSON.stringify({ ...manifest, tools }, null, 2);
}
async function reviewPreview(context: ModuleContext, review: Review, active: Awaited<ReturnType<ModuleContext["db"]["moduleVersion"]["findUnique"]>>) {
  const { version, module, report, files, needsMigration } = review, { hash } = version;
  const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
  // Only what changes (v2-22): two whole manifests could fill an approval, and a group's would not fit one.
  const diff = ["--- active", "+++ proposed", ...compactDiff(active?.manifest ? reviewManifest(active.manifest) : "", reviewManifest(manifest))].join("\n");
  const results = report.tests.map((result, index) => ({ test: manifest.tests[index], exitCode: result.exitCode }));
  const prefix = reviewPrefix(manifest, report, diff);
  const impactPreview = report.outputImpacts?.length ? `依赖这些工具契约的应用需随本次更新一并检查（不会自动修改调用方）：\n${outputImpactSummary(report.outputImpacts).join("\n")}\n` : "";
  const suffix = `${impactPreview}${continuityPreview(report.continuity!, needsMigration)}意图：${JSON.stringify(intent)}\n测试：${JSON.stringify(results)}\nhash: ${hash}`;
  // Fail closed rather than silently hiding manifest or intent being approved.
  let preview: string | null = null, codeDiff = "";
  if ((prefix + suffix).length <= 20_000) preview = insertCodeDiff(prefix, suffix, codeDiff = codeDifference(module.activeHash ? await readVersionSource(context, module.id, module.activeHash) : [], files), hash);
  return { active, manifest, hash, preview, parts: { prefix, suffix, codeDiff } };
}
const SUPERSEDED = "Superseded by newer candidate ";
const superseded = (report: unknown) => (report as BuildReport | null)?.errors?.[0]?.startsWith(SUPERSEDED) === true;
/** Expired approvals also reject their superseded candidates. */
async function supersedeCandidates(context: ModuleContext, moduleId: string, hash: string) {
  const { db } = context;
  for (const row of await db.moduleVersion.findMany({ where: { moduleId, status: "pending_review", hash: { not: hash } } })) {
    const report = row.report && typeof row.report === "object" && !Array.isArray(row.report) ? row.report : {};
    await db.moduleVersion.updateMany({ where: { id: row.id, status: "pending_review" }, data: { status: "rejected", report: json({ ...report, errors: [`${SUPERSEDED}${hash}`] }) } });
  }
}
/** New credential declarations require the owner's confirmation. */
function addsCredentials(version: ModuleVersion, active: ModuleVersion | null) {
  const manifest = moduleManifestSchema.parse(version.manifest), previous = active ? moduleManifestSchema.parse(active.manifest) : null;
  return requiresCapabilityApproval(manifest, previous);
}
/** Checks passed and nothing needs the owner: activate now and tell them afterwards. */
async function activateChecked(context: ModuleContext, { version, module }: Review, update: boolean, initialRelease = false) {
  const { hash } = version, manifest = moduleManifestSchema.parse(version.manifest);
  await fenceExecutionVersionChange(context.ports, context.workspaceId, module.id, hash);
  await context.db.$transaction(async tx => {
    if (await findCandidateSet({ ...context, db: tx as ModuleContext["db"] }, version)) throw new StewardError("conflict", "Fixed candidates activate only through their receipt");
    const candidate = await tx.moduleVersion.findUnique({ where: { id: version.id } });
    if (candidate?.status !== "pending_review") throw new StewardError("conflict", "Module candidate is no longer pending review");
    const current = await assertExternalModule(tx, context.workspaceId, module.id, "activate");
    if (current.status === "migrating" || current.activeHash !== module.activeHash || current.activationId !== module.activationId) throw new Error("Module changed during build; submit again");
    if (initialRelease && !await matchesInitialInstallation({ ...context, db: tx as ModuleContext["db"] }, version, current)) throw new StewardError("conflict", "Initial release installation changed before activation");
    await expireModuleApprovals(context, module.id, tx);
    await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
    await tx.module.update({ where: { id: module.id }, data: { dataSchema: manifest.data.schema } });
    await activateIn(context, tx, { moduleId: module.id, hash, reason: "activate" });
    await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "module_auto_activated", subjectId: module.id, details: { versionId: version.id, hash } });
    await activationNotice(context, tx, version, update);
  });
  await supersedeCandidates(context, module.id, hash);
}
async function groupReview(context: ModuleContext, { version, module, report }: Review, parts: Parameters<typeof recordGroupReview>[2]): Promise<Proposal | null> {
  if (!await recordGroupReview(context, version, parts)) return null;
  const set = await advanceFixedCandidateSet(context, version);
  const status = set?.state === "approved" ? "approved" : set?.state === "rejected" ? "rejected" : "pending_review";
  return { moduleId: module.id, hash: version.hash, status, ...(set?.approvalId ? { approvalId: set.approvalId } : {}), report };
}
async function requestReview(context: ModuleContext, review: Review): Promise<Proposal> {
  const { db } = context, { version, module, report } = review, { hash } = version;
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  await assertExternalModule(db, context.workspaceId, module.id, "activate");
  const initialRelease = !active && addsCredentials(version, active) && await isTrustedInitialInstallation(context, version, module);
  if (!await isGroupCandidate(context, version) && !review.needsMigration && (!addsCredentials(version, active) || initialRelease)) {
    try { await activateChecked(context, review, !!active, initialRelease); }
    catch (error) {
      // Only unresolved execution is a retryable wait; keep this exact checked version.
      if (!(error instanceof StewardError) || error.code !== "conflict") throw error;
      await db.$transaction(async tx => {
        try { await assertExecutionModuleIdle(tx, module.id); }
        catch (busy) {
          if (!(busy instanceof StewardError) || busy.code !== "conflict") throw busy;
          const current = await assertExternalModule(tx, context.workspaceId, module.id, "activate");
          if (current.activeHash !== module.activeHash || current.activationId !== module.activationId) throw error;
          const waiting: DrainReport = { ...report, activationWait: { activeHash: module.activeHash, activationId: module.activationId } };
          await tx.moduleVersion.updateMany({ where: { id: version.id, status: "pending_review" }, data: { report: json(waiting) } });
          return;
        }
        throw error;
      });
      return { moduleId: module.id, hash, status: "pending_review", report };
    }
    return { moduleId: module.id, hash, status: "approved", report };
  }
  const { preview, parts } = await reviewPreview(context, review, active);
  if (preview === null) {
    report.errors = ["Review preview exceeds 20000 characters (manifest diff, intent and results); shrink the manifest change or split the update"];
    await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "rejected", report: json(report) } });
    return { moduleId: module.id, hash, status: "rejected", report };
  }
  const card = { moduleId: module.id, action: "activate_module" as const, title: `启用模块 ${module.name}`,
    detail: review.needsMigration ? "此版本需要迁移已有数据" : addsCredentials(version, active) ? "此版本需要新的凭据或 owner 权限" : "与同一构建的其他应用一起启用", payload: { kind: "activate_module" as const, moduleId: module.id, hash }, preview };
  // v2-15: one module of a group build waits for the group's single approval (modules.request-group), never alone or automatically.
  const group = await groupReview(context, review, { ...parts, detail: card.detail, needsMigration: review.needsMigration });
  if (group) return group;
  await expireModuleApprovals(context, module.id);
  await supersedeCandidates(context, module.id, hash);
  const approval = await createApprovals(context).create(card);
  return { moduleId: module.id, hash, status: "pending_review", approvalId: approval.id, report };
}
async function modelManifestError(context: ModuleContext, manifest: ReturnType<typeof moduleManifestSchema.parse>) {
  if (!manifest.model) return null;
  const workspace = await context.db.workspace.findUniqueOrThrow({ where: { id: context.workspaceId } });
  const limits = moduleModelSettings(workspace.settings);
  return !limits ? "Module model capability unavailable: the owner must configure moduleModel first (web page Settings > 模块模型, or settings.update); Chrona cannot set it for them"
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
  const staging = join(platform, "staging", version.id), report: BuildReport = { tests: [], ...((version.report as BuildReport).git ? { git: (version.report as BuildReport).git } : {}) };
  assertBuildOwnership(context, staging);
  try {
    const module = await assertExternalModule(db, context.workspaceId, version.moduleId, "build");
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
function approvalCoversVersion(payload: unknown, version: ModuleVersion) {
  const single = payload as { hash?: unknown } | null;
  return single?.hash === version.hash || groupPayloadSchema.safeParse(payload).data?.versions.some(member => member.moduleId === version.moduleId && member.hash === version.hash) === true;
}
async function recoverReview(context: ModuleContext, version: ModuleVersion) {
  const { db, workspaceId } = context;
  const fixed = await findCandidateSet(context, version);
  if (fixed) {
    const set = await advanceFixedCandidateSet(context, version);
    if (!set || set.state !== "submitted") return;
  }
  const module = await assertExternalModule(db, workspaceId, version.moduleId, "activate");
  if (version.status !== "pending_review" || (!fixed && await isGroupCandidate(context, version))) return;
  const approvals = await db.approval.findMany({ where: { workspaceId, action: "activate_module" } });
  const covering = approvals.filter(row => row.moduleId === version.moduleId && approvalCoversVersion(row.payload, version));
  if (covering.length) {
    const approved = covering.find(row => row.status === "approved");
    if (approved) await createApprovals(context, action => onApproved(context, action)).resolve(approved.id, { decision: "approve" }, "recovery");
    return;
  }
  if (approvals.some(row => approvalCoversVersion(row.payload, version))) return;
  const waiting = (version.report as DrainReport | null)?.activationWait;
  // A later activation (even of the same hash) invalidates the original automatic intent.
  if (waiting && (!module.executionFenceAt || waiting.activeHash !== module.activeHash || waiting.activationId !== module.activationId)) return;
  const latest = await db.moduleVersion.findFirst({ where: { moduleId: version.moduleId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!fixed && !waiting && latest?.id !== version.id) return;
  if (module.activeHash === version.hash) return;
  const review = await recoveredReviewMaterial(context, version, module);
  if (review) await requestReview(context, review);
}
async function recoveredReviewMaterial(context: ModuleContext, version: ModuleVersion, module: Review["module"]): Promise<Review | null> {
  const report = version.report as BuildReport | null;
  if (!report?.continuity) return null;
  const source = await versionSource(context, version);
  const files = source.files;
  report.git = source.revision;
  const manifest = moduleManifestSchema.parse(version.manifest);
  const needsMigration = module.dataSchema !== null && manifest.data.schema > module.dataSchema && !await dataEmpty(join(context.platform, "data", module.id));
  return { version, module, report, files, needsMigration };
}
const recoveringReviews = new WeakMap<ModuleContext["db"], Set<string>>();
/** Resume exact approved effects or repair never-created reviews; denied/expired cards stay resolved. */
async function recoverReviews(context: ModuleContext) {
  const { db, workspaceId } = context;
  let running = recoveringReviews.get(db);
  if (!running) { running = new Set(); recoveringReviews.set(db, running); }
  if (running.has(workspaceId)) return;
  running.add(workspaceId);
  try {
    const candidates = await db.moduleVersion.findMany({ where: { module: { workspaceId }, status: { in: ["pending_review", "rejected"] } } });
    for (const version of candidates) {
      try {
        if (version.status === "rejected") { await advanceFixedCandidateSet(context, version); continue; }
        await recoverReview(context, version);
      } catch (error) {
        if (error instanceof ModuleIdentityError || error instanceof ModuleUnavailableError) {
          await db.moduleVersion.updateMany({ where: { id: version.id, status: "pending_review" }, data: { status: "rejected", report: json({ ...(version.report as BuildReport), errors: [error.message] }) } });
          await expireModuleApprovals(context, version.moduleId);
          continue;
        }
        console.error(JSON.stringify({ level: "error", component: "module-build", event: "review.recovery_failed", versionId: version.id,
          name: redactSensitiveText(error instanceof Error ? error.name : typeof error),
          message: redactSensitiveText(error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error") }));
      }
    }
  } finally { running.delete(workspaceId); }
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
      if (!(error instanceof ModuleIdentityError || error instanceof ModuleUnavailableError)) throw error;
      identityRejected = true;
      const report: BuildReport = { tests: [], errors: [String(error).slice(0, 4000)] };
      await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
      result = { moduleId: version.moduleId, hash: version.hash, status: "rejected", report };
    }
    await advanceFixedCandidateSet(context, version);
    if (result.status === "rejected" && version.source === "provider" && !identityRejected) await reportFailure(context, version, result);
  }
}
