import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { effectivePolicyIn } from "./grants";
import { audit } from "./audit";
import { activateApprovedIn } from "./module-activation";
import { dataEmpty } from "./module-data";
import { intentSchema, requireModule, type BuildReport, type ModuleContext, type ModuleVersion } from "./module-context";
import { createNotifications } from "./notify";

type ReviewCard = { moduleId: string; action: "activate_module"; title: string; detail: string; payload: { kind: "activate_module"; moduleId: string; hash: string }; preview: string };
function checksPassed(report: BuildReport) {
  const continuity = report.continuity;
  return (continuity?.status === "passed" || (continuity?.status === "skipped" && continuity.reason === "no data"))
    && !continuity.migrated && report.tests.length > 0 && report.tests.every(test => test.exitCode === 0)
    && !report.errors?.length && (!report.keyProbe || report.keyProbe.status === "passed");
}
async function eligible(context: ModuleContext, tx: Prisma.TransactionClient, version: ModuleVersion, report: BuildReport) {
  const module = await requireModule(context, tx, version.moduleId), manifest = moduleManifestSchema.parse(version.manifest);
  // Without isolation any code change can do anything the Chrona user can: every version needs the user.
  if (!context.ports.sandbox?.isolated || manifest.effects.includes("owner")) return false;
  if (!module.activeHash || module.status === "migrating") return false;
  const active = await tx.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
  const effects = moduleManifestSchema.parse(active.manifest).effects;
  if (effects.includes("owner")) return false;
  if (!manifest.effects.every(effect => effects.includes(effect))) return false;
  // New or changed dependencies count as new capabilities (v2-6 §4).
  if (!manifest.packages.every(name => moduleManifestSchema.parse(active.manifest).packages.includes(name))) return false;
  for (const lockfile of ["package.json", "bun.lock", "pyproject.toml", "uv.lock"]) {
    const [next, current] = await Promise.all([version.hash, active.hash].map(hash => readFile(join(context.store, hash, lockfile)).catch(() => null)));
    if (!(next === null ? current === null : current !== null && next.equals(current))) return false;
  }
  if (manifest.data.schema !== module.dataSchema && !await dataEmpty(join(context.platform, "data", module.id))) return false;
  return checksPassed(report);
}
async function autoActivateIn(context: ModuleContext, tx: Prisma.TransactionClient, version: ModuleVersion, report: BuildReport, card: ReviewCard) {
  if (!await eligible(context, tx, version, report)) return null;
  const { workspaceId, now } = context;
  const decision = await effectivePolicyIn(tx, workspaceId, "activate_module", { moduleId: card.moduleId }, now());
  if (!["auto", "notify_after", "preapproved"].includes(decision.mode)) return null;
  const grantId = decision.grantId ?? null;
  if (!grantId) return null;
  const grant = await tx.grant.findUniqueOrThrow({ where: { id: grantId } });
  const scope = grant.scope as { kind?: string; moduleId?: string };
  if (grant.once || scope.kind !== "module" || scope.moduleId !== card.moduleId) return null;
  const approval = await tx.approval.create({ data: { ...card, workspaceId, status: "approved", grantId, createdAt: now(), resolvedAt: now() } });
  await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: approval.id, details: { action: card.action } });
  const migration = await activateApprovedIn(context, tx, { workspaceId, approvalId: approval.id, grantId, payload: approval.payload });
  if (migration) throw new Error("Automatic module activation cannot migrate data");
  await audit(tx, { workspaceId, actor: "chrona", kind: "module_auto_activated", subjectId: version.moduleId, details: { versionId: version.id, hash: version.hash, grantId } });
  return approval;
}
export async function tryAutoActivate(context: ModuleContext, version: ModuleVersion, report: BuildReport, card: ReviewCard) {
  let approval;
  // All activation writes roll back together on failure; the caller creates the ordinary open card.
  try { approval = await context.db.$transaction(tx => autoActivateIn(context, tx, version, report, card)); }
  catch { return null; }
  if (!approval) return null;
  const manifest = moduleManifestSchema.parse(version.manifest), intent = intentSchema.parse(version.intent);
  await createNotifications(context.ports, context.workspaceId).enqueue({ moduleId: card.moduleId, level: "digest", title: `模块 ${manifest.name} 已自动更新`, body: `${[`变更：${intent.changes.join("；")}`, intent.preserves.length ? `保持：${intent.preserves.join("；")}` : ""].filter(Boolean).join("\n").slice(0, 3500)}\n完整意图与代码差异见审批预览；版本 hash: ${version.hash}\n可在模块历史中回滚`, dedupeKey: `module-auto-activated:${version.id}` });
  return approval;
}
