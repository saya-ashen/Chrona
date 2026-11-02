import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { moduleManifestSchema, isEntryModule } from "@chrona/contracts/steward";
import { effectivePolicyIn } from "./grants";
import { audit } from "./audit";
import { activateApprovedIn } from "./module-activation";
import { dataEmpty } from "./module-data";
import { intentSchema, requireModule, type BuildReport, type ModuleContext, type ModuleVersion } from "./module-context";
import { notifyUser } from "./notify-user";
import { moduleOutputImpacts } from "./module-output-impact";

type Manifest = ReturnType<typeof moduleManifestSchema.parse>;
type ReviewCard = { moduleId: string; action: "activate_module"; title: string; detail: string; payload: { kind: "activate_module"; moduleId: string; hash: string }; preview: string };
function checksPassed(report: BuildReport) {
  const continuity = report.continuity;
  return (continuity?.status === "passed" || (continuity?.status === "skipped" && continuity.reason === "no data"))
    && !continuity.migrated && report.tests.length > 0 && report.tests.every(test => test.exitCode === 0)
    && !report.errors?.length && (!report.keyProbe || report.keyProbe.status === "passed");
}
function toolsDoNotExpand(previous: Manifest, next: Manifest) {
  return next.tools.every(tool => {
    const old = previous.tools.find(candidate => candidate.name === tool.name);
    const wider = (visibility: string[]) => visibility.some(value => value !== "provider" && value !== "owner");
    if (!old) return !wider(tool.visibility);
    const callers = !tool.visibility.includes("modules") || old.callers === undefined || (tool.callers?.every(name => old.callers!.includes(name)) ?? false);
    return tool.visibility.every(value => old.visibility.includes(value)) && callers;
  });
}
async function dependenciesUnchanged(context: ModuleContext, version: ModuleVersion, activeHash: string, manifest: Manifest, current: Manifest) {
  if (!manifest.packages.every(name => current.packages.includes(name))) return false;
  for (const lockfile of ["package.json", "bun.lock", "pyproject.toml", "uv.lock"]) {
    const [next, previous] = await Promise.all([version.hash, activeHash].map(hash => readFile(join(context.store, hash, lockfile)).catch(() => null)));
    if (!(next === null ? previous === null : previous !== null && next.equals(previous))) return false;
  }
  return true;
}
async function capabilitiesUnchanged(context: ModuleContext, { module, active, version, current, manifest }: { module: Awaited<ReturnType<typeof requireModule>>; active: ModuleVersion; version: ModuleVersion; current: Manifest; manifest: Manifest }) {
  if (isEntryModule(current) || !manifest.effects.every(effect => current.effects.includes(effect))
    || !manifest.uses.every(target => current.uses.includes(target)) || !toolsDoNotExpand(current, manifest)) return false;
  // New or changed dependencies count as new capabilities (v2-6 §4).
  if (!await dependenciesUnchanged(context, version, active.hash, manifest, current)) return false;
  return manifest.data.schema === module.dataSchema || await dataEmpty(join(context.platform, "data", module.id));
}
async function eligible(context: ModuleContext, tx: Prisma.TransactionClient, version: ModuleVersion, report: BuildReport) {
  const module = await requireModule(context, tx, version.moduleId), manifest = moduleManifestSchema.parse(version.manifest);
  // Trusted-local accepts the owner's OS-user trust boundary; required isolation fails closed when unavailable.
  // A credential (v2-16) is the user's to hand over: such versions always ask.
  if ((context.ports.sandbox?.executionMode !== "trusted-local" && !context.ports.sandbox?.isolated) || isEntryModule(manifest) || manifest.secrets.length) return false;
  if (!module.activeHash || module.status === "migrating") return false;
  const active = await tx.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
  const current = moduleManifestSchema.parse(active.manifest);
  if ((await moduleOutputImpacts(tx as unknown as StewardPorts["db"], context.workspaceId, module.id, manifest)).length) return false;
  if (!await capabilitiesUnchanged(context, { module, active, version, current, manifest })) return false;
  return checksPassed(report);
}
/**
 * Legacy isolated updates may mint a one-time grant as before. Trusted-local updates require a current standing module grant;
 * execution-mode selection alone never authorizes automatic updates.
 */
async function standingAutoGrant(tx: Prisma.TransactionClient, context: ModuleContext, moduleId: string, now: Date) {
  const decision = await effectivePolicyIn(tx, context.workspaceId, "activate_module", { moduleId }, now);
  if (!decision.grantId || !["auto", "notify_after", "preapproved"].includes(decision.mode)) return null;
  const grant = await tx.grant.findUniqueOrThrow({ where: { id: decision.grantId } });
  const scope = grant.scope as { kind?: string; moduleId?: string };
  return !grant.once && !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > now) && ["auto", "notify_after", "preapproved"].includes(grant.mode) && scope.kind === "module" && scope.moduleId === moduleId ? grant.id : null;
}
async function autoGrant(tx: Prisma.TransactionClient, context: ModuleContext, moduleId: string) {
  const now = context.now();
  const standing = await standingAutoGrant(tx, context, moduleId, now);
  if (standing) return standing;
  if (context.ports.sandbox?.executionMode === "trusted-local") return null;
  const decision = await effectivePolicyIn(tx, context.workspaceId, "activate_module", { moduleId }, now);
  if (decision.grantId && !["auto", "notify_after", "preapproved"].includes(decision.mode)) return null;
  const created = await tx.grant.create({ data: { workspaceId: context.workspaceId, action: "activate_module", mode: "preapproved", scope: { kind: "module", moduleId }, once: true, createdAt: now } });
  await audit(tx, { workspaceId: context.workspaceId, actor: "chrona", kind: "grant_created", subjectId: created.id, details: { reason: "green module update", moduleId } });
  return created.id;
}
async function autoActivateIn(context: ModuleContext, tx: Prisma.TransactionClient, input: { version: ModuleVersion; report: BuildReport; card: ReviewCard & { approvalId: string }; reviewed: "passed" | "skipped" }) {
  const { version, report, card, reviewed } = input;
  const { approvalId } = card;
  if (!await eligible(context, tx, version, report)) return null;
  const { workspaceId, now } = context;
  const grantId = await autoGrant(tx, context, card.moduleId);
  if (!grantId) return null;
  // The open card (reviewed and passed, v2-17 §3) is approved in place.
  const row = await tx.approval.findFirst({ where: { id: approvalId, workspaceId, status: "open", level: "green" } });
  if (!row) return null;
  const brief = row.brief as Record<string, unknown>;
  const approved = await tx.approval.updateMany({ where: { id: approvalId, workspaceId, status: "open", level: "green" }, data: { status: "approved", grantId, resolvedAt: now(), brief: { ...brief, reviewed, ...(reviewed === "skipped" ? { reason: "已选择仅检查模式；确定性更新检查通过且存在当前有效的模块长期授权，因此跳过 AI 复核。" } : {}) } } });
  if (!approved.count) return null;
  const approval = await tx.approval.findUniqueOrThrow({ where: { id: approvalId } });
  const migration = await activateApprovedIn(context, tx, { workspaceId, approvalId: approval.id, grantId, payload: approval.payload });
  if (migration) throw new Error("Automatic module activation cannot migrate data");
  if (reviewed === "skipped") await audit(tx, { workspaceId, actor: "chrona", kind: "approval_review", subjectId: approvalId, details: { outcome: "skipped", reason: "checks-only policy; eligible trusted-local update with standing module grant" } });
  await audit(tx, { workspaceId, actor: "chrona", kind: "module_auto_activated", subjectId: version.moduleId, details: { versionId: version.id, hash: version.hash, grantId } });
  return approval;
}
export async function tryAutoActivate(context: ModuleContext, input: { version: ModuleVersion; report: BuildReport; card: ReviewCard; approvalId: string; reviewed?: "passed" | "skipped" }) {
  const { version, report, card, approvalId, reviewed = "passed" } = input;
  let approval;
  // All activation writes roll back together on failure; the card then stays open for the user.
  try { approval = await context.db.$transaction(tx => autoActivateIn(context, tx, { version, report, card: { ...card, approvalId }, reviewed })); }
  catch { return null; }
  if (!approval) return null;
  const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
  await notifyUser(context.db, context.ports, context.workspaceId, { module: card.moduleId, app: manifest.name, level: "digest", title: `🟢 模块 ${manifest.name} 已自动更新`, body: `${[`变更：${intent.changes.join("；")}`, intent.preserves.length ? `保持：${intent.preserves.join("；")}` : ""].filter(Boolean).join("\n").slice(0, 3500)}\n完整意图与代码差异见审批预览；版本 hash: ${version.hash}\n可在模块历史中回滚`, key: `module-auto-activated:${version.id}` });
  return approval;
}
