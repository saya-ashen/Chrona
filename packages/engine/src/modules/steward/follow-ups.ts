import type { PrismaClient } from "@chrona/db/generated/prisma/client";

import { StewardError } from "./mappers";

/** Internal service: callers supply their authorized workspace. */
export function createStewardFollowUps({ db, workspaceId, actorKey = "system:steward", now = () => new Date() }: { db: PrismaClient; workspaceId: string; actorKey?: string; now?: () => Date }) {
  if (!workspaceId) throw new StewardError("FORBIDDEN", "Workspace access required");
  async function transition(id: string, status: "done" | "cancelled") {
    return db.$transaction(async (tx) => {
      const changed = await tx.followUp.updateMany({ where: { id, workspaceId, status: "pending" }, data: { status } });
      const row = await tx.followUp.findFirst({ where: { id, workspaceId } });
      if (!row) throw new StewardError("NOT_FOUND", "Follow-up not found");
      if (changed.count) {
        const at = now();
        await tx.attentionItem.updateMany({ where: { workspaceId: row.workspaceId, dedupeKey: `followup:${id}`, status: { in: ["open", "snoozed"] } }, data: {
          status: status === "done" ? "resolved" : "dismissed", decision: status === "done" ? "done" : "dismiss", decidedAt: at,
        } });
        await tx.stewardAudit.create({ data: { workspaceId: row.workspaceId, subjectId: id, kind: `followup.${status}`, actorKey, details: { status }, createdAt: at } });
      }
      return row;
    });
  }
  return {
    async raiseDueFollowUps({ now: at = now() }: { now?: Date } = {}) {
      return db.$transaction(async (tx) => {
        // Write lock precedes the read so completion/cancellation cannot race raising.
        await tx.followUp.updateMany({ where: { workspaceId, status: "pending", dueAt: { lte: at } }, data: { status: "pending" } });
        const due = await tx.followUp.findMany({ where: { workspaceId, status: "pending", dueAt: { lte: at } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
        let raised = 0;
        for (const row of due) {
          const dedupeKey = `followup:${row.id}`;
          const existing = await tx.attentionItem.findUnique({ where: { workspaceId_dedupeKey: { workspaceId: row.workspaceId, dedupeKey } } });
          if (existing) continue;
          await tx.attentionItem.create({ data: {
            workspaceId: row.workspaceId, dedupeKey, kind: "commitment", affairId: row.affairId, title: row.note.slice(0, 200),
            whatHappened: row.note, whyItMatters: "A recorded follow-up is due.", nextStep: "Review this commitment and mark the follow-up done when complete.", dueAt: row.dueAt,
          } });
          await tx.stewardAudit.create({ data: { workspaceId: row.workspaceId, subjectId: row.id, kind: "followup.raised", actorKey: "system:steward", details: { dedupeKey }, createdAt: at } });
          raised++;
        }
        return { raised };
      });
    },
    completeFollowUp(id: string) { return transition(id, "done"); },
    cancelFollowUp(id: string) { return transition(id, "cancelled"); },
  };
}
