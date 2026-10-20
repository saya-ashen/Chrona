import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { requireAffair } from "./affairs";
import { createApprovals } from "./approvals";
import { createRuns } from "./runs";
import { createNotifications } from "./notify";
import { intentSchema, json, requireModule, expireModuleApprovals, type ModuleContext, type ModuleVersion, type BuildReport, type Proposal } from "./module-context";
import { runTests, checkContinuity } from "./module-continuity";
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
type Review = { version: ModuleVersion; module: Awaited<ReturnType<typeof requireModule>>; affairId: string; report: BuildReport; files: { path: string; bytes: Buffer }[]; needsMigration: boolean };
async function requestReview(context: ModuleContext, review: Review): Promise<Proposal> {
  const { db, store } = context, { version, module, affairId, report, files, needsMigration } = review, { hash } = version;
  const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  const diff = ["--- active", "+++ proposed", ...JSON.stringify(active?.manifest ?? null, null, 2).split("\n").map(line => `- ${line}`), ...JSON.stringify(manifest, null, 2).split("\n").map(line => `+ ${line}`)].join("\n");
  const results = report.tests.map((result, index) => ({ test: manifest.tests[index], exitCode: result.exitCode }));
  const prefix = `联网：${manifest.effects.includes("network") ? "是" : "否"}\n${diff}\n`;
  const suffix = `${continuityPreview(report.continuity!, needsMigration)}意图：${JSON.stringify(intent)}\n测试：${JSON.stringify(results)}\nhash: ${hash}`;
  // Fail closed rather than silently hiding manifest or intent being approved.
  let preview: string | null = null;
  if ((prefix + suffix).length <= 20_000) preview = insertCodeDiff(prefix, suffix, await codeDifference(store, module.activeHash, files), hash);
  if (preview === null) {
    await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "rejected" } });
    return { moduleId: module.id, hash, status: "rejected", report };
  }
  await expireModuleApprovals(context, module.id);
  const approval = await createApprovals(context).create({ affairId, action: "activate_module", title: `启用模块 ${manifest.name}`, detail: "审查此版本的清单、意图与测试结果", payload: { kind: "activate_module", moduleId: module.id, hash }, preview });
  return { moduleId: module.id, hash, status: "pending_review", approvalId: approval.id, report };
}
async function buildVersion(context: ModuleContext, version: ModuleVersion): Promise<Proposal> {
  const { db, workspaceId, platform } = context, { hash } = version;
  const staging = join(platform, "staging", version.id), report: BuildReport = { tests: [] };
  try {
    const module = await requireModule(context, db, version.moduleId);
    const affair = await requireAffair(db, workspaceId, module.affairId);
    const manifest = moduleManifestSchema.parse(version.manifest);
    intentSchema.parse(version.intent);
    const files = await stagingFiles(context, version, report);
    if (!files) return { moduleId: module.id, hash, status: "rejected", report };
    let passed = await runTests(context, staging, manifest, report.tests), needsMigration = false;
    if (passed) {
      const continuity = { status: "skipped" as const, reason: "no data", fromSchema: module.dataSchema, toSchema: manifest.data.schema, migrated: false };
      report.continuity = continuity;
      ({ passed, needsMigration } = await checkContinuity(context, staging, module, manifest, continuity));
    }
    // Only engine-owned immutable copies are tested, hashed and installed.
    if (passed) await installBuild(context, staging, hash);
    const status = passed ? "pending_review" : "rejected";
    await db.moduleVersion.update({ where: { id: version.id }, data: { report: json(report), status } });
    if (!passed) return { moduleId: module.id, hash, status, report };
    return await requestReview(context, { version, module, affairId: affair.id, report, files, needsMigration });
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
    await createNotifications(ports, workspaceId).enqueue({ affairId: module.affairId, level: "digest", title: `模块 ${module.name} 构建失败`, body: "连续构建失败，已停止自动重试。请检查测试报告后重新提交。", dedupeKey: `module-build-failed:${module.id}:${versions[failures]?.id ?? "initial"}` });
  } else {
    // Keep continuity diagnostics visible even when successful tests printed a lot.
    const summary = result.report.continuity ? { continuity: result.report.continuity } : result.report;
    const publicReport = JSON.stringify(summary, (key, value: unknown) => ["stdout", "stderr"].includes(key) && typeof value === "string" ? value.slice(0, 1500) : value);
    await createRuns(ports, workspaceId).enqueue({ affairId: module.affairId, lane: "background", trigger: "schedule", label: module.name, prompt: `Module ${module.name} build failed (untrusted test output):\n${publicReport.slice(0, 8000)}` });
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
