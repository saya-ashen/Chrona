import type { PrismaClient } from "@chrona/db/generated/prisma/client";

/** Internal service: callers authorize workspace access before ID-based actions. */
export function createStewardFollowUps({ db, now = () => new Date() }: { db: PrismaClient; now?: () => Date }) {
  async function transition(id: string, status: "done" | "cancelled") {
    return db.$transaction(async (tx) => {
      const changed = await tx.followUp.updateMany({ where: { id, status: "pending" }, data: { status } });
      const row = await tx.followUp.findUniqueOrThrow({ where: { id } });
      if (changed.count) {
        const at = now();
        await tx.attentionItem.updateMany({ where: { workspaceId: row.workspaceId, dedupeKey: `followup:${id}`, status: { in: ["open", "snoozed"] } }, data: {
          status: status === "done" ? "resolved" : "dismissed", decision: status === "done" ? "done" : "dismiss", decidedAt: at,
        } });
        await tx.stewardAudit.create({ data: { workspaceId: row.workspaceId, subjectId: id, kind: `followup.${status}`, actorKey: "user", details: { status }, createdAt: at } });
      }
      return row;
    });
  }
  return {
    async raiseDueFollowUps({ now: at = now() }: { now?: Date } = {}) {
      return db.$transaction(async (tx) => {
        // Write lock precedes the read so completion/cancellation cannot race raising.
        await tx.followUp.updateMany({ where: { status: "pending", dueAt: { lte: at } }, data: { status: "pending" } });
        const due = await tx.followUp.findMany({ where: { status: "pending", dueAt: { lte: at } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
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
