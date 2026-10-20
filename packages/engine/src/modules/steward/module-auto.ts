import { join } from "node:path";
import type { Prisma } from "@chrona/db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { effectivePolicyIn } from "./grants";
import { audit } from "./audit";
import { activateApprovedIn } from "./module-activation";
import { dataEmpty } from "./module-data";
import { intentSchema, requireModule, type BuildReport, type ModuleContext, type ModuleVersion } from "./module-context";
import { createNotifications } from "./notify";

type ReviewCard = { affairId: string; action: "activate_module"; title: string; detail: string; payload: { kind: "activate_module"; moduleId: string; hash: string }; preview: string };
async function eligible(context: ModuleContext, tx: Prisma.TransactionClient, version: ModuleVersion, report: BuildReport) {
  const module = await requireModule(context, tx, version.moduleId), manifest = moduleManifestSchema.parse(version.manifest);
  if (!module.activeHash || module.status === "migrating") return false;
  const active = await tx.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
  const effects = moduleManifestSchema.parse(active.manifest).effects;
  if (!manifest.effects.every(effect => effects.includes(effect))) return false;
  if (manifest.data.schema !== module.dataSchema && !await dataEmpty(join(context.platform, "data", module.id))) return false;
  const continuity = report.continuity;
  return (continuity?.status === "passed" || (continuity?.status === "skipped" && continuity.reason === "no data")) && report.replay?.status === "identical" && report.replay.steps === 10;
}
async function autoActivateIn(context: ModuleContext, tx: Prisma.TransactionClient, version: ModuleVersion, report: BuildReport, card: ReviewCard) {
  if (!await eligible(context, tx, version, report)) return null;
  const { workspaceId, now } = context;
  const decision = await effectivePolicyIn(tx, workspaceId, "activate_module", { affairId: card.affairId }, now());
  if (!["auto", "notify_after", "preapproved"].includes(decision.mode)) return null;
  const grantId = decision.grantId ?? null;
  if (grantId && (await tx.grant.findUniqueOrThrow({ where: { id: grantId } })).once) return null;
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
  await createNotifications(context.ports, context.workspaceId).enqueue({ affairId: card.affairId, level: "digest", title: `模块 ${manifest.name} 已自动更新`, body: `${intent.changes.join("；").slice(0, 3500)}\n可在模块历史中回滚`, dedupeKey: `module-auto-activated:${version.id}` });
  return approval;
}
