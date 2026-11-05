import { z } from "zod";
import type { Prisma } from "@chrona/db";

type Db = Prisma.TransactionClient;
type Version = Prisma.ModuleVersionGetPayload<{ include: { module: true } }>;
const memberSchema = z.object({ moduleId: z.string(), hash: z.string() });
const approvalSchema = z.union([memberSchema.extend({ kind: z.literal("activate_module") }), z.object({ kind: z.literal("activate_modules"), versions: z.array(memberSchema) })]);

/** Approval and activation are separate facts; an approved version can already have been replaced or paused. */
export async function moduleVersionOutcome(db: Db, workspaceId: string, version: Version) {
  const active = version.module.status === "active" && version.module.activeHash === version.hash;
  if (active) return { status: "active", active, reason: "已启用" };
  if (version.status === "pending_review") {
    const approvals = await db.approval.findMany({ where: { workspaceId, action: "activate_module", status: "open" } });
    const approval = approvals.find(row => {
      const payload = approvalSchema.safeParse(row.payload).data;
      const members = payload?.kind === "activate_modules" ? payload.versions : payload ? [payload] : [];
      return members.some(member => member.moduleId === version.moduleId && member.hash === version.hash);
    });
    if (approval) return { status: "pending_approval", active, reason: approval.detail.replace(/\s+/g, " ").slice(0, 200) };
    return { status: "pending_review", active, reason: "检查已通过，尚未完成启用申请" };
  }
  const reasons: Record<string, string> = { building: "检查尚未完成", testing: "检查尚未完成", rejected: "版本检查未通过或已被撤回", approved: "该版本当前未启用" };
  const reason = reasons[version.status] ?? "该版本当前未启用";
  return { status: version.status === "rejected" ? "failed" : version.status, active, reason };
}

export async function proposedVersionOutcome(db: Db, workspaceId: string, proposal: { moduleId: string | null; hash: string }) {
  const version = proposal.moduleId ? await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: proposal.moduleId, hash: proposal.hash } }, include: { module: true } }) : null;
  return version ? moduleVersionOutcome(db, workspaceId, version) : { status: "failed", active: false, reason: "提交的版本未通过检查" };
}

/** Submission receipts bind the result to this conversation, even if another build submitted a newer version. */
export async function buildOutcomeLine(db: Db, workspaceId: string, sessionId: string) {
  const runs = await db.run.findMany({ where: { workspaceId, sessionId, lane: "build" }, select: { id: true } });
  const submissions = await db.audit.findMany({ where: { workspaceId, kind: "module_submission", actorKey: { in: runs.map(run => `provider:${run.id}`) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!submissions.length) return "未启用：本次构建未提交版本";
  if (submissions[0]!.subjectId === null) return "未启用：最后提交的版本未通过检查";
  const seen = new Set<string | null>(), lines: string[] = [];
  for (const submission of submissions) {
    if (seen.has(submission.subjectId)) continue;
    seen.add(submission.subjectId);
    const hash = z.object({ hash: z.string() }).safeParse(submission.details).data?.hash;
    const version = hash && submission.subjectId ? await db.moduleVersion.findFirst({ where: { moduleId: submission.subjectId, hash, module: { workspaceId } }, include: { module: true } }) : null;
    if (!version) { lines.push("未启用：提交的版本未通过检查"); continue; }
    const outcome = await moduleVersionOutcome(db, workspaceId, version);
    lines.push(outcome.active ? `已启用：${version.module.name} 版本 ${version.hash.slice(0, 8)}`
      : outcome.status === "pending_approval" ? `等待你确认：${outcome.reason}（网页「待你决定」）`
      : `未启用：${version.module.name} ${outcome.reason}`);
  }
  return lines.join("；");
}

/** Reserve room for the kernel's final line before downstream notice/wake length limits. */
export function appendBuildOutcome(text: string, line: string, limit = Infinity) {
  const body = text.slice(0, Math.max(0, limit - line.length - 2));
  return body ? `${body}\n\n${line}` : line;
}
