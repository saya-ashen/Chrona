import { moduleModelSettings } from "./settings";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createApprovals } from "./approvals";
import { createRuns, createRunSession } from "./runs";
import { createNotifications } from "./notify";
import { intentSchema, json, requireModule, expireModuleApprovals, type ModuleContext, type ModuleVersion, type BuildReport, type Proposal } from "./module-context";
import { runTests, checkContinuity } from "./module-continuity";
import { tryAutoActivate } from "./module-auto";
import { activateIn } from "./module-generation";
import { settleBuildVersion } from "./module-build-lane";
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
async function installBuild(context: ModuleContext, staging: string, hash: string) {
  await mkdir(context.store, { recursive: true });
  try { await rename(staging, join(context.store, hash)); }
  catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
}
type Review = { version: ModuleVersion; module: Awaited<ReturnType<typeof requireModule>>; report: BuildReport; files: { path: string; bytes: Buffer }[]; needsMigration: boolean };
async function requestReview(context: ModuleContext, review: Review): Promise<Proposal> {
  const { db, store } = context, { version, module, report, files, needsMigration } = review, { hash } = version;
  const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  const diff = ["--- active", "+++ proposed", ...JSON.stringify(active?.manifest ?? null, null, 2).split("\n").map(line => `- ${line}`), ...JSON.stringify(manifest, null, 2).split("\n").map(line => `+ ${line}`)].join("\n");
  const results = report.tests.map((result, index) => ({ test: manifest.tests[index], exitCode: result.exitCode }));
  const prefix = `联网：${manifest.effects.includes("network") ? "是" : "否"}\n${diff}\n`;
  const suffix = `${continuityPreview(report.continuity!, needsMigration)}${keyProbePreview(report.keyProbe)}意图：${JSON.stringify(intent)}\n测试：${JSON.stringify(results)}\nhash: ${hash}`;
  // Fail closed rather than silently hiding manifest or intent being approved.
  let preview: string | null = null;
  if ((prefix + suffix).length <= 20_000) preview = insertCodeDiff(prefix, suffix, await codeDifference(store, module.activeHash, files), hash);
  if (preview === null) {
    await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "rejected" } });
    return { moduleId: module.id, hash, status: "rejected", report };
  }
  await expireModuleApprovals(context, module.id);
  const card = { moduleId: module.id, action: "activate_module" as const, title: `启用模块 ${manifest.name}`, detail: "审查此版本的清单、意图与测试结果", payload: { kind: "activate_module" as const, moduleId: module.id, hash }, preview };
  const automatic = version.source === "builtin" ? null : await tryAutoActivate(context, version, report, card);
  if (automatic) return { moduleId: module.id, hash, status: "approved", approvalId: automatic.id, report };
  const approval = await createApprovals(context).create(card);
  return { moduleId: module.id, hash, status: "pending_review", approvalId: approval.id, report };
}
async function buildVersion(context: ModuleContext, version: ModuleVersion): Promise<Proposal> {
  const { db, workspaceId, platform } = context, { hash } = version;
  const staging = join(platform, "staging", version.id), report: BuildReport = { tests: [] };
  try {
    const module = await requireModule(context, db, version.moduleId);
    const manifest = moduleManifestSchema.parse(version.manifest);
    intentSchema.parse(version.intent);
    const files = await stagingFiles(context, version, report);
    if (!files) return { moduleId: module.id, hash, status: "rejected", report };
    if (manifest.model) {
      const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      const limits = moduleModelSettings(workspace.settings);
      const error = !limits ? "Module model capability unavailable: configure moduleModel in owner settings" : manifest.model.maxCalls > limits.maxCallsPerEvent || manifest.model.maxOutputTokens > limits.maxOutputTokens ? "Module model limits exceed owner moduleModel settings" : null;
      if (error) {
        report.errors = [error];
        await db.moduleVersion.update({ where: { id: version.id }, data: { status: "rejected", report: json(report) } });
        return { moduleId: module.id, hash, status: "rejected", report };
      }
    }
    let passed = await runTests(context, staging, manifest, report.tests), needsMigration = false;
    if (passed) {
      const continuity = { status: "skipped" as const, reason: "no data", fromSchema: module.dataSchema, toSchema: manifest.data.schema, migrated: false };
      report.continuity = continuity;
      ({ passed, needsMigration } = await checkContinuity(context, staging, module, manifest, continuity));
    }
    if (passed) report.errors = await smokeRun(context, staging, manifest);
    if (report.errors?.length) passed = false; else delete report.errors;
    // Only engine-owned immutable copies are tested, hashed and installed.
    if (passed) {
      const keyProbe = await probeKeys(context, staging, manifest);
      // Keep failed probes visible so they cannot silently permit automatic activation.
      if (keyProbe.status !== "skipped" || !["no schedule trigger", "no effects on both fires"].includes(keyProbe.reason ?? "")) report.keyProbe = keyProbe;
      await installBuild(context, staging, hash);
    }
    const status = passed ? "pending_review" : "rejected";
    await db.moduleVersion.update({ where: { id: version.id }, data: { report: json(report), status } });
    if (!passed) return { moduleId: module.id, hash, status, report };
    if (version.source === "builtin") {
      const activated = await db.$transaction(async tx => {
        const current = await requireModule(context, tx, module.id);
        const previous = await tx.moduleVersion.findFirst({ where: { moduleId: module.id, source: "builtin", id: { not: version.id } }, orderBy: { createdAt: "desc" } });
        if (current.status === "migrating" || (current.activeHash !== null && current.activeHash !== previous?.hash) || needsMigration) return false;
        await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
        await tx.module.update({ where: { id: module.id }, data: { dataSchema: manifest.data.schema } });
        await activateIn(context, tx, module.id, hash, "activate");
        return true;
      });
      if (activated) return { moduleId: module.id, hash, status: "approved", report };
      await createNotifications(context.ports, workspaceId).enqueue({ moduleId: module.id, level: "web", title: `内置模块 ${module.name} 有新版本`, body: "已保留当前版本；新内置版本可在模块历史中审查启用。", dedupeKey: `builtin:${module.id}:${hash}` });
      // Candidates use the same review/activation gateway as user proposals.
    }
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
  for (const row of versions) { if (row.status !== "rejected") break; failures++; }
  if (failures >= 3) {
    // Key streak by preceding successful build; failures may share timestamps.
    await createNotifications(ports, workspaceId).enqueue({ moduleId: module.id, level: "digest", title: `模块 ${module.name} 构建失败`, body: "连续构建失败，已停止自动重试。请检查测试报告后重新提交。", dedupeKey: `module-build-failed:${module.id}:${versions[failures]?.id ?? "initial"}` });
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
    if (version.source === "build") await settleBuildVersion(context.ports, workspaceId, version.id);
    else if (result.status === "rejected" && version.source === "provider") await reportFailure(context, version, result);
  }
}
