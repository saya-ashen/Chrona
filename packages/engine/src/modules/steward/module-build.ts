import { moduleModelSettings } from "./settings";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isEntryModule, listenPaths, moduleManifestSchema } from "@chrona/contracts/steward";
import { createApprovals } from "./approvals";
import { createRuns, createRunSession } from "./runs";
import { notifyUser } from "./notify-user";
import { intentSchema, json, requireModule, expireModuleApprovals, type ModuleContext, type ModuleVersion, type BuildReport, type Proposal } from "./module-context";
import { runTests, checkContinuity } from "./module-continuity";
import { recordGroupReview } from "./module-group";
import { activateIn } from "./module-generation";
import { probeKeys, keyProbePreview, smokeRun } from "./module-probe";
import { readModuleFiles, codeDifference, continuityPreview, insertCodeDiff } from "./module-preview";

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
  return manifest.tools.filter(tool => tool.visibility.some(value => value === "modules" || value === "kernel")).map(tool => `${tool.name}${tool.callers ? `（仅 ${tool.callers.join("、")}）` : ""}`);
}
function reviewPrefix(manifest: ReturnType<typeof moduleManifestSchema.parse>, report: BuildReport, diff: string) {
  const libraries = [report.dependencies?.npm && "npm（bun.lock）", report.dependencies?.python && "Python（uv.lock）"].filter(Boolean).join("、") || "无";
  const exposed = exposedTools(manifest);
  return `联网：${manifest.effects.includes("network") ? "是" : "否"}\n调用其他模块：${manifest.uses.map(target => target === "*" ? "所有对你开放的工具（*）" : target).join("、") || "无"}；供其他模块调用：${exposed.join("、") || "无"}\n系统程序：${manifest.packages.join("、") || "无"}；语言库：${libraries}\n${diff}\n`;
}
async function reviewPreview(context: ModuleContext, review: Review, active: Awaited<ReturnType<ModuleContext["db"]["moduleVersion"]["findUnique"]>>) {
  const { store } = context, { version, module, report, files, needsMigration } = review, { hash } = version;
  const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
  const diff = ["--- active", "+++ proposed", ...JSON.stringify(active?.manifest ?? null, null, 2).split("\n").map(line => `- ${line}`), ...JSON.stringify(manifest, null, 2).split("\n").map(line => `+ ${line}`)].join("\n");
  const results = report.tests.map((result, index) => ({ test: manifest.tests[index], exitCode: result.exitCode }));
  const prefix = reviewPrefix(manifest, report, diff);
  const suffix = `${continuityPreview(report.continuity!, needsMigration)}${keyProbePreview(report.keyProbe)}意图：${JSON.stringify(intent)}\n测试：${JSON.stringify(results)}\nhash: ${hash}`;
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
async function requestReview(context: ModuleContext, review: Review): Promise<Proposal> {
  const { db } = context, { version, module, report } = review, { hash } = version;
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  // A custom version may have become active while the built-in candidate was testing.
  if (version.source === "builtin" && active && active.source !== "builtin") return { moduleId: module.id, hash, status: "pending_review", report };
  const { manifest, preview, parts } = await reviewPreview(context, review, active);
  if (preview === null) {
    await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "rejected" } });
    return { moduleId: module.id, hash, status: "rejected", report };
  }
  await expireModuleApprovals(context, module.id);
  await supersedeCandidates(context, module.id, hash);
  const card = { moduleId: module.id, action: "activate_module" as const, title: `启用模块 ${manifest.name}`,
    detail: context.ports.sandbox?.isolated ? "审查此版本的清单、意图与测试结果" : "审查此版本的清单、意图与测试结果。未隔离运行：模块能访问 Chrona 运行用户的所有文件和网络", payload: { kind: "activate_module" as const, moduleId: module.id, hash }, preview };
  // v2-15: one module of a group build waits for the group's single approval (modules.request-group), never alone or automatically.
  if (await recordGroupReview(context, version, { ...parts, detail: card.detail, needsMigration: review.needsMigration })) return { moduleId: module.id, hash, status: "pending_review", report };
  // v2-17: every card is reviewed first; a green one that passes activates by itself (approval-review).
  const approval = await createApprovals(context).create(card);
  return { moduleId: module.id, hash, status: "pending_review", approvalId: approval.id, report };
}
async function validateBuildManifest(context: ModuleContext, version: ModuleVersion, manifest: ReturnType<typeof moduleManifestSchema.parse>, report: BuildReport) {
  const { db, workspaceId } = context;
  let error: string | null = null;
  if (listenPaths(manifest).length && !isEntryModule(manifest)) error = "listen is only for entry modules (web, MCP): expose tools instead; the web module shows them";
  if (!error && manifest.model) {
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const limits = moduleModelSettings(workspace.settings);
    error = !limits ? "Module model capability unavailable: the owner must configure moduleModel first (web page Settings > 模块模型, or settings.update); Chrona cannot set it for them"
      : !Object.hasOwn(limits.models, manifest.model.tier) ? `Module model tier "${manifest.model.tier}" is not configured in owner moduleModel settings (configured: ${Object.keys(limits.models).join(", ")})`
      : manifest.model.maxCalls > limits.maxCallsPerEvent || manifest.model.maxOutputTokens > limits.maxOutputTokens ? "Module model limits exceed owner moduleModel settings" : null;
  }
  if (!error) return null;
  report.errors = [error];
  await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
  return { moduleId: version.moduleId, hash: version.hash, status: "rejected" as const, report };
}
async function activateBuiltin(context: ModuleContext, module: Awaited<ReturnType<typeof requireModule>>, version: ModuleVersion, manifest: ReturnType<typeof moduleManifestSchema.parse>, needsMigration: boolean) {
  const { hash } = version;
  return context.db.$transaction(async tx => {
    const current = await requireModule(context, tx, module.id);
    const previous = await tx.moduleVersion.findFirst({ where: { moduleId: module.id, source: "builtin", id: { not: version.id } }, orderBy: { createdAt: "desc" } });
    if (current.status === "migrating" || (current.activeHash !== null && current.activeHash !== previous?.hash) || needsMigration) return false;
    await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
    await tx.module.update({ where: { id: module.id }, data: { dataSchema: manifest.data.schema } });
    await activateIn(context, tx, module.id, hash, "activate");
    return true;
  });
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
  let passed = await runTests(context, staging, manifest, report.tests), needsMigration = false;
  if (passed) {
    const continuity = { status: "skipped" as const, reason: "no data", fromSchema: module.dataSchema, toSchema: manifest.data.schema, migrated: false };
    report.continuity = continuity;
    ({ passed, needsMigration } = await checkContinuity(context, staging, module, manifest, continuity));
  }
  if (passed) report.errors = await smokeRun(context, staging, manifest);
  if (buildHasErrors(report)) passed = false; else delete report.errors;
  // Only engine-owned immutable copies are tested, hashed and installed.
  if (passed) {
    const keyProbe = await probeKeys(context, staging, manifest);
    // Keep failed probes visible so they cannot silently permit automatic activation.
    if (keyProbe.status !== "skipped" || !["no schedule trigger", "no effects on both fires"].includes(keyProbe.reason ?? "")) report.keyProbe = keyProbe;
    await installBuild(context, staging, hash);
  }
  // shortcut: GC roots of approved versions are kept until the version is deleted; nothing deletes versions yet.
  if (!passed) await rm(join(platform, "gcroots", hash), { recursive: true, force: true });
  return { passed, needsMigration, dependencyFailure: false };
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
    if (checks.dependencyFailure) {
      await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
      return { moduleId: module.id, hash, status: "rejected", report };
    }
    const { passed, needsMigration } = checks;
    const status = passed ? "pending_review" : "rejected";
    await db.moduleVersion.update({ where: { id: version.id }, data: { report: json(report), status } });
    if (!passed) return { moduleId: module.id, hash, status, report };
    if (version.source === "builtin" && await activateBuiltin(context, module, version, manifest, needsMigration)) return { moduleId: module.id, hash, status: "approved", report };
    // requestReview suppresses replacements if a custom version is active.
    return await requestReview(context, { version, module, report, files, needsMigration });
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
export async function buildPending(context: ModuleContext, now = context.ports.now()) {
  const { db, workspaceId } = context;
  await recoverBuilds(context, now);
  const pending = await db.moduleVersion.findMany({ where: { module: { workspaceId }, status: "building" }, orderBy: { createdAt: "asc" }, take: 3 });
  for (const version of pending) {
    const claimed = await db.$transaction(async tx => {
      const changed = await tx.moduleVersion.updateMany({ where: { id: version.id, status: "building" }, data: { status: "testing" } });
      if (changed.count) await tx.audit.create({ data: { workspaceId, actorKey: "chrona", kind: "module_build_started", subjectId: version.id, details: {}, createdAt: now } });
      return changed.count > 0;
    });
    if (!claimed) continue;
    const result = await buildVersion(context, version);
    if (result.status === "rejected" && version.source === "provider") await reportFailure(context, version, result);
  }
}
