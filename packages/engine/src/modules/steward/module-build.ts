import { moduleModelSettings } from "./settings";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isEntryModule, listenPaths, moduleManifestSchema, secretNames } from "@chrona/contracts/steward";
import { createApprovals } from "./approvals";
import { createRuns, createRunSession } from "./runs";
import { notifyUser } from "./notify-user";
import { intentSchema, groupPayloadSchema, json, requireModule, expireModuleApprovals, type ModuleContext, type ModuleVersion, type BuildReport, type Proposal } from "./module-context";
import { runTests, checkContinuity } from "./module-continuity";
import { isGroupCandidate, recordGroupReview } from "./module-group";
import { dataEmpty } from "./module-data";
import { redactSensitiveText } from "@chrona/logging/redaction";
import { activateIn } from "./module-generation";
import { audit } from "./audit";
import { probeKeys, keyProbePreview, smokeRun } from "./module-probe";
import { typecheckBuild, typecheckErrors } from "./module-typecheck";
import { moduleOutputImpacts, outputImpactSummary } from "./module-output-impact";
import { moduleToolExampleError } from "./module-calls";
import { readModuleFiles, codeDifference, compactDiff, continuityPreview, insertCodeDiff } from "./module-preview";

async function stagingFiles(context: ModuleContext, version: ModuleVersion, report: BuildReport) {
  try { return await readModuleFiles(join(context.platform, "staging", version.id), "Unsafe module staging file"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    report.tests.push({ stdout: "", stderr: "Module staging files are missing; build interrupted. Submit the module again.", exitCode: 1 });
    await context.db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
    return null;
  }
}
/** Lockfile libraries and system programs go into the staging copy before anything runs it. */
async function installDependencies(context: ModuleContext, staging: string, manifest: ReturnType<typeof moduleManifestSchema.parse>, hash: string) {
  if (!manifest.packages.length && !existsSync(join(staging, "package.json")) && !existsSync(join(staging, "pyproject.toml"))) return null;
  // The host installer may execute package build backends; do not cross an explicitly required isolation boundary.
  if (context.ports.sandbox?.executionMode === "required-isolation") return { errors: ["required-isolation: dependency installation is not isolated yet; builds with language or system packages are unavailable in this mode"], installed: { npm: false, python: false, packages: {} } };
  if (!context.ports.packages) return { errors: ["Dependency installation is not available on this host"], installed: { npm: false, python: false, packages: {} } };
  return context.ports.packages.install({ dir: staging, packages: manifest.packages, gcroot: join(context.platform, "gcroots", hash) });
}
async function installBuild(context: ModuleContext, staging: string, hash: string) {
  await mkdir(context.store, { recursive: true });
  try { await rename(staging, join(context.store, hash)); }
  catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
}
type Review = { version: ModuleVersion; module: Awaited<ReturnType<typeof requireModule>>; report: BuildReport; files: { path: string; bytes: Buffer }[]; needsMigration: boolean };
function exposedTools(manifest: ReturnType<typeof moduleManifestSchema.parse>) {
  return manifest.tools.filter(tool => tool.visibility.some(value => value === "modules" || value === "kernel")).map(tool => tool.name);
}
function reviewPrefix(manifest: ReturnType<typeof moduleManifestSchema.parse>, report: BuildReport, diff: string) {
  const libraries = [report.dependencies?.npm && "npm（bun.lock）", report.dependencies?.python && "Python（uv.lock）"].filter(Boolean).join("、") || "无";
  const exposed = exposedTools(manifest);
  return `联网：${manifest.effects.includes("network") ? "是" : "否"}\n调用其他模块：${manifest.uses.map(target => target === "*" ? "所有对你开放的工具（*）" : target).join("、") || "无"}；供其他模块调用：${exposed.join("、") || "无"}\n系统程序：${manifest.packages.join("、") || "无"}；语言库：${libraries}${manifest.limits ? `；内存地址空间上限：${manifest.limits.virtualMemoryMb} MB（默认 1024）` : ""}\n${diff}\n`;
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
  const { store } = context, { version, module, report, files, needsMigration } = review, { hash } = version;
  const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
  // Only what changes (v2-22): two whole manifests could fill an approval, and a group's would not fit one.
  const diff = ["--- active", "+++ proposed", ...compactDiff(active?.manifest ? reviewManifest(active.manifest) : "", reviewManifest(manifest))].join("\n");
  const results = report.tests.map((result, index) => ({ test: manifest.tests[index], exitCode: result.exitCode }));
  const prefix = reviewPrefix(manifest, report, diff);
  const impactPreview = report.outputImpacts?.length ? `依赖这些工具契约的应用需随本次更新一并检查（不会自动修改调用方）：\n${outputImpactSummary(report.outputImpacts).join("\n")}\n` : "";
  const suffix = `${impactPreview}${continuityPreview(report.continuity!, needsMigration)}${keyProbePreview(report.keyProbe)}意图：${JSON.stringify(intent)}\n测试：${JSON.stringify(results)}\nhash: ${hash}`;
  // Fail closed rather than silently hiding manifest or intent being approved.
  let preview: string | null = null, codeDiff = "";
  if ((prefix + suffix).length <= 20_000) preview = insertCodeDiff(prefix, suffix, codeDiff = await codeDifference(store, module.activeHash, files), hash);
  return { active, manifest, hash, preview, parts: { prefix, suffix, codeDiff } };
}
const SUPERSEDED = "Superseded by newer candidate ";
const superseded = (report: unknown) => (report as BuildReport | null)?.errors?.[0]?.startsWith(SUPERSEDED) === true;
/** Their approvals just expired: say so on the versions too, instead of leaving them pending forever. Built-in releases stay on file. */
async function supersedeCandidates(context: ModuleContext, moduleId: string, hash: string) {
  const { db } = context;
  for (const row of await db.moduleVersion.findMany({ where: { moduleId, status: "pending_review", source: { not: "builtin" }, hash: { not: hash } } })) {
    const report = row.report && typeof row.report === "object" && !Array.isArray(row.report) ? row.report : {};
    await db.moduleVersion.updateMany({ where: { id: row.id, status: "pending_review" }, data: { status: "rejected", report: json({ ...report, errors: [`${SUPERSEDED}${hash}`] }) } });
  }
}
/** A release built-in is trusted code; its credentials are still entered by the owner on the app page. */
function addsCredentials(version: ModuleVersion, active: ModuleVersion | null) {
  if (version.source === "builtin") return false;
  const had = active ? secretNames(moduleManifestSchema.parse(active.manifest)) : [];
  return secretNames(moduleManifestSchema.parse(version.manifest)).some(name => !had.includes(name));
}
/** Checks passed and nothing needs the owner: activate now and tell them afterwards. */
async function activateChecked(context: ModuleContext, { version, module }: Review, update: boolean) {
  const { hash } = version, manifest = moduleManifestSchema.parse(version.manifest);
  await context.db.$transaction(async tx => {
    const current = await requireModule(context, tx, module.id);
    if (current.status === "migrating" || current.activeHash !== module.activeHash) throw new Error("Module changed during build; submit again");
    await expireModuleApprovals(context, module.id, tx);
    await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
    await tx.module.update({ where: { id: module.id }, data: { dataSchema: manifest.data.schema } });
    await activateIn(context, tx, { moduleId: module.id, hash, reason: "activate" });
    await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "module_auto_activated", subjectId: module.id, details: { versionId: version.id, hash } });
    if (version.source !== "builtin") await activationNotice(context, tx, version, update);
  });
  await supersedeCandidates(context, module.id, hash);
}
async function requestReview(context: ModuleContext, review: Review): Promise<Proposal> {
  const { db } = context, { version, module, report } = review, { hash } = version;
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  // A customized module keeps its version: the tested built-in stays inactive, for an explicit `admin rollback <m> builtin`.
  if (version.source === "builtin" && active && active.source !== "builtin") {
    await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "approved" } });
    return { moduleId: module.id, hash, status: "approved", report };
  }
  if (!await isGroupCandidate(context, version) && !review.needsMigration && !addsCredentials(version, active)) {
    await activateChecked(context, review, !!active);
    return { moduleId: module.id, hash, status: "approved", report };
  }
  const { preview, parts } = await reviewPreview(context, review, active);
  if (preview === null) {
    report.errors = ["Review preview exceeds 20000 characters (manifest diff, intent and results); shrink the manifest change or split the update"];
    await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "rejected", report: json(report) } });
    return { moduleId: module.id, hash, status: "rejected", report };
  }
  await expireModuleApprovals(context, module.id);
  await supersedeCandidates(context, module.id, hash);
  const card = { moduleId: module.id, action: "activate_module" as const, title: `启用模块 ${module.name}`,
    detail: review.needsMigration ? "此版本需要迁移已有数据" : addsCredentials(version, active) ? "此版本需要新的凭据" : "与同一构建的其他应用一起启用", payload: { kind: "activate_module" as const, moduleId: module.id, hash }, preview };
  // v2-15: one module of a group build waits for the group's single approval (modules.request-group), never alone or automatically.
  if (await recordGroupReview(context, version, { ...parts, detail: card.detail, needsMigration: review.needsMigration })) return { moduleId: module.id, hash, status: "pending_review", report };
  const approval = await createApprovals(context).create(card);
  return { moduleId: module.id, hash, status: "pending_review", approvalId: approval.id, report };
}
async function modelManifestError(context: ModuleContext, manifest: ReturnType<typeof moduleManifestSchema.parse>) {
  if (!manifest.model) return null;
  const workspace = await context.db.workspace.findUniqueOrThrow({ where: { id: context.workspaceId } });
  const limits = moduleModelSettings(workspace.settings);
  return !limits ? "Module model capability unavailable: the owner must configure moduleModel first (web page Settings > 模块模型, or settings.update); Chrona cannot set it for them"
    : !Object.hasOwn(limits.models, manifest.model.tier) ? `Module model tier "${manifest.model.tier}" is not configured in owner moduleModel settings (configured: ${Object.keys(limits.models).join(", ")})`
    : manifest.model.maxCalls > limits.maxCallsPerEvent || manifest.model.maxOutputTokens > limits.maxOutputTokens ? "Module model limits exceed owner moduleModel settings" : null;
}
async function validateBuildManifest(context: ModuleContext, version: ModuleVersion, manifest: ReturnType<typeof moduleManifestSchema.parse>, report: BuildReport) {
  const { db } = context;
  let error: string | null = null;
  const missingOutput = manifest.tools.find(tool => tool.visibility.some(value => value === "owner" || value === "modules") && !tool.output);
  if (missingOutput) error = `Public tool ${missingOutput.name} must declare an output schema`;
  if (!error) error = manifest.tools.map(moduleToolExampleError).find((value): value is string => value !== null) ?? null;
  if (!error && listenPaths(manifest).length && !isEntryModule(manifest)) error = "listen is only for entry modules (web, MCP): expose tools instead; the web module shows them";
  if (!error) error = await modelManifestError(context, manifest);
  if (!error) return null;
  report.errors = [error];
  await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
  return { moduleId: version.moduleId, hash: version.hash, status: "rejected" as const, report };
}
export async function activationNotice(context: ModuleContext, tx: Parameters<typeof notifyUser>[0], version: ModuleVersion, update: boolean) {
  const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
  await notifyUser(tx, context.ports, context.workspaceId, { module: version.moduleId, app: manifest.name, level: "digest", title: `应用 ${manifest.name} 已自动${update ? "更新" : "启用"}`, body: `${[`变更：${intent.changes.join("；")}`, intent.preserves.length ? `保持：${intent.preserves.join("；")}` : ""].filter(Boolean).join("\n").slice(0, 3500)}\n版本 hash: ${version.hash}\n可在应用历史中回滚`, key: `module-auto-activated:${version.id}` });
}
/** v2-25: tests run only on an entry that type-checks against the SDK and call contracts. */
async function typecheckAndTest(context: ModuleContext, staging: string, manifest: ReturnType<typeof moduleManifestSchema.parse>, report: BuildReport) {
  const typecheck = await typecheckBuild(context, staging, manifest);
  if (typecheck.status !== "skipped") report.typecheck = typecheck;
  if (typecheck.status !== "failed") return runTests(context, staging, manifest, report.tests);
  report.errors = typecheckErrors(typecheck);
  return false;
}
/** Versions activate without review, so a failed key probe (repeated effects on a redelivered fire) rejects the build. */
async function probeAndInstall(context: ModuleContext, staging: string, manifest: ReturnType<typeof moduleManifestSchema.parse>, hash: string, report: BuildReport) {
  const keyProbe = await probeKeys(context, staging, manifest);
  if (keyProbe.status !== "skipped" || !["no schedule trigger", "no effects on both fires"].includes(keyProbe.reason ?? "")) report.keyProbe = keyProbe;
  if (report.keyProbe && report.keyProbe.status !== "passed") {
    report.errors = [keyProbePreview(report.keyProbe).trim()];
    return false;
  }
  await installBuild(context, staging, hash);
  return true;
}
function buildHasErrors(report: BuildReport) { return Boolean(report.errors?.length); }
async function checkBuildCandidate({ context, module, version, manifest, staging, report }: { context: ModuleContext; module: Awaited<ReturnType<typeof requireModule>>; version: ModuleVersion; manifest: ReturnType<typeof moduleManifestSchema.parse>; staging: string; report: BuildReport }): Promise<{ passed: boolean; needsMigration: boolean; dependencyFailure: boolean }> {
  const { platform } = context, { hash } = version;
  const dependencies = await installDependencies(context, staging, manifest, hash);
  if (dependencies) report.dependencies = dependencies.installed;
  if (dependencies?.errors.length) {
    report.errors = dependencies.errors.map(error => error.slice(0, 4000));
    await rm(join(platform, "gcroots", hash), { recursive: true, force: true });
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
  if (passed) passed = await probeAndInstall(context, staging, manifest, hash, report);
  // shortcut: GC roots of approved versions are kept until the version is deleted; nothing deletes versions yet.
  if (!passed) await rm(join(platform, "gcroots", hash), { recursive: true, force: true });
  return { passed, needsMigration, dependencyFailure: false };
}
async function customized(db: ModuleContext["db"], module: { id: string; activeHash: string | null }) {
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  return !!active && active.source !== "builtin";
}
async function consumersBlock(context: ModuleContext, { module, version, manifest, report }: { module: { id: string; activeHash: string | null }; version: ModuleVersion; manifest: ReturnType<typeof moduleManifestSchema.parse>; report: BuildReport }) {
  if (!report.outputImpacts?.length || await checkDependentCallers(context, manifest, report.outputImpacts, report)) return false;
  // A customized module's release built-in is switched to only by an explicit `admin rollback`, usually together with
  // its customized consumers (which may never type-check): the checks stay in the report, but do not reject it.
  return !(version.source === "builtin" && await customized(context.db, module));
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
  const staging = join(platform, "staging", version.id), report: BuildReport = { tests: [] };
  try {
    const module = await requireModule(context, db, version.moduleId);
    const manifest = moduleManifestSchema.parse(version.manifest);
    intentSchema.parse(version.intent);
    const files = await stagingFiles(context, version, report);
    if (!files) return { moduleId: module.id, hash, status: "rejected", report };
    // Manifest capabilities are checked before dependencies or code can run.
    const invalidManifest = await validateBuildManifest(context, version, manifest, report);
    if (invalidManifest) return invalidManifest;
    const checks = await checkBuildCandidate({ context, module, version, manifest, staging, report });
    // requestReview suppresses replacements if a custom version is active.
    return await finishBuild({ context, module, version, manifest, report, checks, files });
  } finally { await rm(staging, { recursive: true, force: true }); }
}
async function recoverBuilds(context: ModuleContext, now: Date) {
  const { db, workspaceId } = context;
  // Audit claim time keeps submission timestamps intact and out of public output.
  await db.$transaction(async tx => {
    const testing = await tx.moduleVersion.findMany({ where: { module: { workspaceId }, status: "testing" } });
    for (const version of testing) {
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
    await notifyUser(db, ports, workspaceId, { module: module.id, app: module.name, level: "digest", title: `模块 ${module.name} 构建失败`, body: "连续构建失败，已停止自动重试。请检查测试报告后重新提交。", key: `module-build-failed:${module.id}:${versions[failures]?.id ?? "initial"}` });
  } else {
    // Keep continuity diagnostics visible even when successful tests printed a lot.
    const summary = result.report.continuity ? { continuity: result.report.continuity } : result.report;
    const publicReport = JSON.stringify(summary, (key, value: unknown) => ["stdout", "stderr"].includes(key) && typeof value === "string" ? value.slice(0, 1500) : value);
    await db.$transaction(async tx => {
      const session = await createRunSession(tx, workspaceId, "module", ports.now(), { moduleId: module.id });
      await createRuns(ports, workspaceId).enqueue({ sessionId: session.id, lane: "background", trigger: "source", label: module.name, prompt: `Module ${module.name} build failed (untrusted test output):\n${publicReport.slice(0, 8000)}` }, tx);
    });
  }
}
function approvalCoversVersion(payload: unknown, version: ModuleVersion) {
  const single = payload as { hash?: unknown } | null;
  return single?.hash === version.hash || groupPayloadSchema.safeParse(payload).data?.versions.some(member => member.moduleId === version.moduleId && member.hash === version.hash) === true;
}
async function recoverReview(context: ModuleContext, version: ModuleVersion) {
  const { db, workspaceId } = context;
  const latest = await db.moduleVersion.findFirst({ where: { moduleId: version.moduleId, source: { not: "builtin" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (latest?.id !== version.id || latest.status !== "pending_review" || await isGroupCandidate(context, version)) return;
  const approvals = await db.approval.findMany({ where: { workspaceId, action: "activate_module" } });
  if (approvals.some(row => approvalCoversVersion(row.payload, version))) return;
  const module = await requireModule(context, db, version.moduleId);
  if (module.activeHash === version.hash) return;
  const report = version.report as BuildReport | null;
  if (!report?.continuity) return;
  const files = await readModuleFiles(join(context.store, version.hash), "Unsafe module store file");
  const manifest = moduleManifestSchema.parse(version.manifest);
  const needsMigration = module.dataSchema !== null && manifest.data.schema > module.dataSchema && !await dataEmpty(join(context.platform, "data", module.id));
  await requestReview(context, { version, module, report, files, needsMigration });
}
const recoveringReviews = new WeakMap<ModuleContext["db"], Set<string>>();
/** Repair only never-created standalone reviews; a resolved/expired card is a deliberate decision, not a retry. */
async function recoverReviews(context: ModuleContext) {
  const { db, workspaceId } = context;
  let running = recoveringReviews.get(db);
  if (!running) { running = new Set(); recoveringReviews.set(db, running); }
  if (running.has(workspaceId)) return;
  running.add(workspaceId);
  try {
    const candidates = await db.moduleVersion.findMany({ where: { module: { workspaceId }, source: { not: "builtin" }, status: "pending_review" } });
    for (const version of candidates) {
      try {
        await recoverReview(context, version);
      } catch (error) {
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
    let result: Proposal;
    try { result = await buildVersion(context, version); }
    catch (error) {
      if (version.source !== "builtin") throw error;
      const report: BuildReport = { tests: [], errors: [String(error).slice(0, 4000)] };
      await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
      result = { moduleId: version.moduleId, hash: version.hash, status: "rejected", report };
    }
    if (result.status === "rejected" && version.source === "builtin") {
      const module = await requireModule(context, db, version.moduleId);
      console.error(JSON.stringify({ level: "error", component: "module-build", event: "builtin.rejected", module: module.name, hash: version.hash, errors: result.report.errors?.map(error => error.slice(0, 1000)).slice(0, 10) ?? [], tests: result.report.tests.filter(test => test.exitCode !== 0).map(test => ({ exitCode: test.exitCode, stderr: test.stderr.slice(0, 1000) })).slice(0, 10) }));
    }
    if (result.status === "rejected" && version.source === "provider") await reportFailure(context, version, result);
  }
}
