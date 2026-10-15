import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { approvalSchema, resolveApprovalSchema } from "@chrona/contracts/steward";
import { decidePolicy } from "@chrona/domain/steward/policy";
import { type RecordContext, requireAffair } from "./affairs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toApproval, toGrant } from "./store";
const inputSchema = approvalSchema.pick({ action: true, title: true, detail: true, preview: true }).extend({ affairId: z.string().min(1).optional(), payload: z.json() }).strict();
/** Only trusted owner routes may resolve. The caller executes the returned payload,
 * rechecking policy and atomically consuming a once grant with its action claim. */
export function createApprovals({ db, workspaceId, now }: RecordContext) {
  return {
    list: async (status?: "open" | "approved" | "denied" | "expired") => (await db.approval.findMany({ where: { workspaceId, status }, include: { affair: true }, orderBy: { createdAt: "desc" } })).map(toApproval),
    create: (raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(inputSchema, raw);
      if (input.affairId) await requireAffair(tx, workspaceId, input.affairId);
      if (input.payload === null) throw new StewardError("invalid", "Approval payload must not be null");
      const row = await tx.approval.create({ data: { ...input, payload: input.payload as Prisma.InputJsonValue, workspaceId, createdAt: now() }, include: { affair: true } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: row.id, details: { action: input.action } });
      return toApproval(row);
    }),
    resolve: (id: string, raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(resolveApprovalSchema, raw);
      const row = await tx.approval.findFirst({ where: { workspaceId, id }, include: { affair: true } });
      if (!row) throw new StewardError("not_found", "Approval not found");
      if (row.status !== "open") throw new StewardError("conflict", "Approval already resolved");
      let grantId: string | null = null;
      if (input.decision === "approve") {
        if (input.scope === "affair" && !row.affairId) throw new StewardError("invalid", "Affair scope requires an affair");
        const action = toApproval(row).action;
        const grant = await tx.grant.create({ data: { workspaceId, action, mode: "preapproved", scope: row.affairId ? { kind: "affair", affairId: row.affairId } : { kind: "global" }, once: input.scope === "once", createdAt: now() } });
        const decision = decidePolicy(action, row.affairId ? { affairId: row.affairId } : {}, (await tx.grant.findMany({ where: { workspaceId, action } })).map(toGrant), now());
        if (decision.mode === "never" || decision.mode === "ask") throw new StewardError("forbidden", "Policy does not allow this approval");
        grantId = grant.id;
      }
      const changed = await tx.approval.updateMany({ where: { workspaceId, id, status: "open" }, data: { status: input.decision === "approve" ? "approved" : "denied", scope: input.scope, grantId, resolvedAt: now() } });
      if (!changed.count) throw new StewardError("conflict", "Approval already resolved");
      await audit(tx, { workspaceId, actor: "user", kind: "approval_resolved", subjectId: id, details: { ...input, grantId } });
      return { approval: toApproval(await tx.approval.findUniqueOrThrow({ where: { id }, include: { affair: true } })), grantId, payload: input.decision === "approve" ? row.payload : null };
    }),
  };
}
