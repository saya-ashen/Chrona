import { assertExactReleaseUpdateIn, ExactReleaseUpdateError } from "./module-exact-release";
import { onApproved } from "./module-activation";
import { assertExecutionModuleIdle } from "../execution/execution-module-guard";
import { requiresCapabilityApproval } from "./module-owner";
import { activationNotice } from "./module-activation-notice";
import { fenceAgentVersionChange } from "../agent/module-drain";
import { StewardError } from "../errors";
import { readVersionSource, versionSource } from "./module-source";
import { assertExternalModule, ModuleIdentityError } from "./module-identity";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createApprovals } from "../approvals";
import { intentSchema, json, requireModule, expireModuleApprovals, type ModuleContext, type ModuleVersion, type BuildReport, type Proposal } from "./module-context";
import { CandidateIdentityError, assertCandidateVersionIn, refreshCandidateReceipt, setCandidateSetStateIn } from "./module-candidate-records";
import { recordApprovalFact } from "../notification-facts";
import { dataEmpty } from "./module-data";
import { redactSensitiveText } from "@chrona/logging/redaction";
import { activateIn } from "./module-generation";
import { audit } from "../audit";
import { codeDifference, compactDiff, continuityPreview, insertCodeDiff } from "./module-preview";


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
  const diff = ["--- active", "+++ proposed", ...compactDiff(active?.manifest ? reviewManifest(active.manifest) : "", reviewManifest(manifest))].join("\n");
  const prefix = reviewPrefix(manifest, report, diff);
  const suffix = `${continuityPreview(report.continuity!, needsMigration)}意图：${JSON.stringify(intent)}\nhash: ${hash}`;
  // Fail closed rather than silently hiding manifest or intent being approved.
  let preview: string | null = null;
  if ((prefix + suffix).length <= 20_000) preview = insertCodeDiff(prefix, suffix, codeDifference(module.activeHash ? await readVersionSource(context, module.id, module.activeHash) : [], files), hash);
  return { active, manifest, hash, preview };
}
const SUPERSEDED = "Superseded by newer candidate ";
export const superseded = (report: unknown) => (report as BuildReport | null)?.errors?.[0]?.startsWith(SUPERSEDED) === true;
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
async function activateChecked(context: ModuleContext, { version, module }: Review, update: boolean) {
  const { hash } = version, manifest = moduleManifestSchema.parse(version.manifest);
  await fenceAgentVersionChange(context.ports, context.workspaceId, module.id, hash,
    async (tx, current) => {
      await assertCandidateVersionIn(context, tx, version);
      await assertExactReleaseUpdateIn(context, tx, module.id, version.report as BuildReport, current);
    });
  await context.db.$transaction(async tx => {
    const receipt = await assertCandidateVersionIn(context, tx, version);
    const candidate = await tx.moduleVersion.findUnique({ where: { id: version.id } });
    if (candidate?.status !== "pending_review") throw new StewardError("conflict", "Module candidate is no longer pending review");
    const current = await assertExternalModule(tx, context.workspaceId, module.id, "activate");
    await assertExactReleaseUpdateIn(context, tx, module.id, candidate.report as BuildReport, current);
    if (current.status === "migrating" || current.activeHash !== module.activeHash || current.activationId !== module.activationId) throw new Error("Module changed during build; submit again");
    await expireModuleApprovals(context, module.id, tx);
    await tx.moduleVersion.update({ where: { id: version.id }, data: { status: "approved" } });
    await tx.module.update({ where: { id: module.id }, data: { dataSchema: manifest.data.schema } });
    await activateIn(context, tx, { moduleId: module.id, hash, reason: "activate" });
    await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "module_auto_activated", subjectId: module.id, details: { versionId: version.id, hash } });
    await activationNotice(context, tx, version, update);
    if (receipt) await setCandidateSetStateIn(context, tx, receipt, "approved");
  });
  await supersedeCandidates(context, module.id, hash);
}
export async function requestReview(context: ModuleContext, review: Review): Promise<Proposal> {
  const { db } = context, { version, module, report } = review, { hash } = version;
  await assertExactReleaseUpdateIn(context, db, module.id, report);
  await assertCandidateVersionIn(context, db, version);
  const active = module.activeHash ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
  await assertExternalModule(db, context.workspaceId, module.id, "activate");
  if (!review.needsMigration && !addsCredentials(version, active)) {
    try { await activateChecked(context, review, !!active); }
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
  const { preview } = await reviewPreview(context, review, active);
  if (preview === null) {
    report.errors = ["Review preview exceeds 20000 characters (manifest diff, intent and results); shrink the manifest change or split the update"];
    await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash } }, data: { status: "rejected", report: json(report) } });
    return { moduleId: module.id, hash, status: "rejected", report };
  }
  const card = { moduleId: module.id, action: "activate_module" as const, title: `启用模块 ${module.name}`,
    detail: review.needsMigration ? "此版本需要迁移已有数据" : addsCredentials(version, active) ? "此版本需要新的凭据或 owner 权限" : "启用此固定版本", payload: { kind: "activate_module" as const, moduleId: module.id, hash }, preview };
  await supersedeCandidates(context, module.id, hash);
  const approval = await db.$transaction(async tx => {
    const receipt = await assertCandidateVersionIn(context, tx, version);
    await assertExactReleaseUpdateIn(context, tx, module.id, report);
    const candidate = await tx.moduleVersion.findUnique({ where: { id: version.id } });
    if (candidate?.status !== "pending_review") throw new StewardError("conflict", "Module candidate is no longer pending review");
    const current = await assertExternalModule(tx, context.workspaceId, module.id, "activate");
    if (current.activeHash !== module.activeHash || current.activationId !== module.activationId) throw new StewardError("conflict", "Module changed during review");
    await expireModuleApprovals(context, module.id, tx);
    const row = await tx.approval.create({ data: { ...card, workspaceId: context.workspaceId, createdAt: context.now() } });
    await recordApprovalFact(tx, row);
    await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "approval_created", subjectId: row.id, details: { action: card.action } });
    if (receipt) await setCandidateSetStateIn(context, tx, receipt, "pending_approval", row.id);
    return row;
  });
  return { moduleId: module.id, hash, status: "pending_review", approvalId: approval.id, report };
}
function approvalCoversVersion(payload: unknown, version: ModuleVersion) {
  const single = payload as { hash?: unknown } | null;
  return single?.hash === version.hash;
}
async function recoverReview(context: ModuleContext, version: ModuleVersion) {
  const { db, workspaceId } = context;
  const fixed = await refreshCandidateReceipt(context, version);
  if (fixed?.state === "approved" || fixed?.state === "rejected") return;
  const module = await assertExternalModule(db, workspaceId, version.moduleId, "activate");
  if (module.status === "migrating") return;
  await assertExactReleaseUpdateIn(context, db, module.id, version.report as BuildReport, module);
  if (version.status !== "pending_review") return;
  const approvals = await db.approval.findMany({ where: { workspaceId, action: "activate_module" } });
  const covering = approvals.filter(row => row.moduleId === version.moduleId && approvalCoversVersion(row.payload, version) && (!fixed || row.id === fixed.approvalId));
  if (covering.length) {
    const approved = covering.find(row => row.status === "approved");
    if (approved) await createApprovals(context, action => onApproved(context, action)).resolve(approved.id, { decision: "approve" }, "recovery");
    return;
  }
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
  const manifest = moduleManifestSchema.parse(version.manifest);
  const needsMigration = module.dataSchema !== null && manifest.data.schema > module.dataSchema && !await dataEmpty(join(context.platform, "data", module.id));
  return { version, module, report, files, needsMigration };
}
const recoveringReviews = new WeakMap<ModuleContext["db"], Set<string>>();
/** Resume exact approved effects or repair never-created reviews; denied/expired cards stay resolved. */
export async function recoverReviews(context: ModuleContext) {
  const { db, workspaceId } = context;
  let running = recoveringReviews.get(db);
  if (!running) { running = new Set(); recoveringReviews.set(db, running); }
  if (running.has(workspaceId)) return;
  running.add(workspaceId);
  try {
    const candidates = await db.moduleVersion.findMany({ where: { module: { workspaceId }, status: { in: ["pending_review", "rejected"] } } });
    for (const version of candidates) {
      try {
        if (version.status === "rejected") { await refreshCandidateReceipt(context, version); continue; }
        await recoverReview(context, version);
      } catch (error) {
        if (error instanceof ModuleIdentityError || error instanceof ExactReleaseUpdateError || error instanceof CandidateIdentityError) {
          console.error(JSON.stringify({ component: "module-build", event: "review.rejected", versionId: version.id, error: error.message }));
          await db.moduleVersion.updateMany({ where: { id: version.id, status: "pending_review" }, data: { status: "rejected", report: json({ ...(version.report as BuildReport), errors: [error.message] }) } });
          await expireModuleApprovals(context, version.moduleId);
          await refreshCandidateReceipt(context, version);
          continue;
        }
        console.error(JSON.stringify({ level: "error", component: "module-build", event: "review.recovery_failed", versionId: version.id,
          name: redactSensitiveText(error instanceof Error ? error.name : typeof error),
          message: redactSensitiveText(error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error") }));
      }
    }
  } finally { running.delete(workspaceId); }
}
