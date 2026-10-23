import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { approvalSchema, moduleManifestSchema, resolveApprovalSchema, isEntryModule } from "@chrona/contracts/steward";
import { decidePolicy } from "@chrona/domain/steward/policy";
import type { OnApproved, StewardPorts } from "./ports";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toApproval, toGrant } from "./store";
const inputSchema = approvalSchema.pick({ action: true, title: true, detail: true, preview: true }).extend({ moduleId: z.string().min(1).optional(), payload: z.json() }).strict();
async function grantApproval(tx: Prisma.TransactionClient, context: RecordContext, row: Parameters<typeof toApproval>[0], scope: z.infer<typeof resolveApprovalSchema>["scope"]) {
  const { workspaceId, now } = context;
  const action = toApproval(row).action;
  const grant = await tx.grant.create({ data: { workspaceId, action, mode: "preapproved", scope: row.moduleId ? { kind: "module", moduleId: row.moduleId } : { kind: "global" }, once: scope === "once", createdAt: now() } });
  const decision = decidePolicy(action, row.moduleId ? { moduleId: row.moduleId } : {}, (await tx.grant.findMany({ where: { workspaceId, action } })).map(toGrant), now());
  if (decision.mode === "never" || decision.mode === "ask") throw new StewardError("forbidden", "Policy does not allow this approval");
  return grant.id;
}
export function createApprovals({ db, workspaceId, now }: RecordContext, onApproved?: OnApproved) {
  return {
    list: async (status?: "open" | "approved" | "denied" | "expired") => (await db.approval.findMany({ where: { workspaceId, status }, orderBy: { createdAt: "desc" } })).map(toApproval),
    create: (raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(inputSchema, raw);
      if (input.moduleId && !await tx.module.findFirst({ where: { workspaceId, id: input.moduleId } })) throw new StewardError("not_found", "Module not found");
      if (input.payload === null) throw new StewardError("invalid", "Approval payload must not be null");
      let rescueOnly = input.action === "change_policy";
      if (input.action === "activate_module") {
        const payload = input.payload;
        if (!input.moduleId || !payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.hash !== "string") throw new StewardError("invalid", "Module activation must be bound to a version hash");
        const version = await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: input.moduleId, hash: payload.hash } } });
        if (!version) throw new StewardError("not_found", "Module version not found");
        const module = await tx.module.findUniqueOrThrow({ where: { id: input.moduleId } });
        const active = module.activeHash ? await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
        rescueOnly = isEntryModule(moduleManifestSchema.parse(version.manifest)) || Boolean(active && isEntryModule(moduleManifestSchema.parse(active.manifest)));
      }
      const row = await tx.approval.create({ data: { ...input, rescueOnly, payload: input.payload as Prisma.InputJsonValue, workspaceId, createdAt: now() } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: row.id, details: { action: input.action } });
      return toApproval(row);
    }),
    resolve: (id: string, raw: unknown, source: "rescue" | "cli" | "web" | "mcp" | "qq" | "entry" = "entry") => db.$transaction(async tx => {
      const input = parseInput(resolveApprovalSchema, raw);
      const row = await tx.approval.findFirst({ where: { workspaceId, id } });
      if (!row) throw new StewardError("not_found", "Approval not found");
      if (row.rescueOnly && source !== "rescue" && source !== "cli") throw new StewardError("forbidden", "Approve or reject this item in the rescue console (or chrona admin)");
      if (row.status !== "open") throw new StewardError("conflict", "Approval already resolved");
      let grantId: string | null = null;
      if (input.decision === "approve") {
        grantId = await grantApproval(tx, { db, workspaceId, now }, row, input.scope);
      }
      const changed = await tx.approval.updateMany({ where: { workspaceId, id, status: "open" }, data: { status: input.decision === "approve" ? "approved" : "denied", scope: input.scope, grantId, resolvedAt: now() } });
      if (!changed.count) throw new StewardError("conflict", "Approval already resolved");
      await audit(tx, { workspaceId, actor: "user", kind: "approval_resolved", subjectId: id, details: { ...input, grantId, source } });
      return { approval: toApproval(await tx.approval.findUniqueOrThrow({ where: { id } })), grantId, payload: input.decision === "approve" ? row.payload : null };
    }).then(async result => {
      if (onApproved && result.grantId && result.payload !== null) await onApproved({ workspaceId, approvalId: id, grantId: result.grantId, payload: result.payload });
      return result;
    }),
  };
}
