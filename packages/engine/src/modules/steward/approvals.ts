import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { approvalSchema, resolveApprovalSchema } from "@chrona/contracts/steward";
import { decidePolicy } from "@chrona/domain/steward/policy";
import type { OnApproved, StewardPorts } from "./ports";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toApproval, toGrant } from "./store";
import { assertBuiltinUpgrade, groupPayloadSchema, isGroupPayload } from "./module-context";
import { createRuns } from "./runs";
const inputSchema = approvalSchema.pick({ action: true, title: true, detail: true, preview: true }).extend({ moduleId: z.string().min(1).optional(), payload: z.json() }).strict();
async function grantApproval(tx: Prisma.TransactionClient, context: RecordContext, row: Parameters<typeof toApproval>[0], scope: z.infer<typeof resolveApprovalSchema>["scope"]) {
  const { workspaceId, now } = context;
  const action = toApproval(row).action;
  const grant = await tx.grant.create({ data: { workspaceId, action, mode: "preapproved", scope: row.moduleId ? { kind: "module", moduleId: row.moduleId } : { kind: "global" }, once: scope === "once", createdAt: now() } });
  const decision = decidePolicy(action, row.moduleId ? { moduleId: row.moduleId } : {}, (await tx.grant.findMany({ where: { workspaceId, action } })).map(toGrant), now());
  if (decision.mode === "never" || decision.mode === "ask") throw new StewardError("forbidden", "Policy does not allow this approval");
  return grant.id;
}
/** A run that asked does not wait: the decision continues its conversation as a new run, which retries under the new grant. */
async function resume(tx: Prisma.TransactionClient, ports: StewardPorts, workspaceId: string, row: Parameters<typeof toApproval>[0], { decision, scope }: z.infer<typeof resolveApprovalSchema>) {
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.sessionId !== "string") return false;
  // A closed conversation is not reopened; the decision still stands.
  if (!await tx.session.findFirst({ where: { workspaceId, id: payload.sessionId, status: "active" } })) return false;
  const prompt = decision === "approve"
    ? `The user approved approval ${row.id} ("${row.title}", scope ${scope}). Continue the task that was waiting for it; the approved action is now allowed.`
    : `The user denied approval ${row.id} ("${row.title}"). Do not retry it; continue another way or tell the user.`;
  await createRuns(ports, workspaceId).enqueue({ sessionId: payload.sessionId, lane: payload.lane === "background" ? "background" : "foreground", trigger: "approval", label: row.title, prompt }, tx);
  return true;
}
/** A module activation is bound to its version hash; a group (v2-15) to every version and no single module. */
async function assertActivationTarget(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string | undefined, payload: Prisma.JsonValue) {
  if (isGroupPayload(payload)) {
    const group = groupPayloadSchema.safeParse(payload);
    if (moduleId || !group.success) throw new StewardError("invalid", "A group activation binds every version and no single module");
    for (const version of group.data.versions) if (!await tx.moduleVersion.findFirst({ where: { ...version, module: { workspaceId } } })) throw new StewardError("not_found", "Module version not found");
    return;
  }
  if (!moduleId || !payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.hash !== "string") throw new StewardError("invalid", "Module activation must be bound to a version hash");
  if (!await tx.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId, hash: payload.hash } } })) throw new StewardError("not_found", "Module version not found");
}
export function createApprovals({ db, workspaceId, now }: RecordContext, onApproved?: OnApproved, ports?: StewardPorts) {
  return {
    list: async (status?: "open" | "approved" | "denied" | "expired") => (await db.approval.findMany({ where: { workspaceId, status }, orderBy: { createdAt: "desc" } })).map(toApproval),
    create: (raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(inputSchema, raw);
      if (input.moduleId && !await tx.module.findFirst({ where: { workspaceId, id: input.moduleId } })) throw new StewardError("not_found", "Module not found");
      if (input.payload === null) throw new StewardError("invalid", "Approval payload must not be null");
      if (input.action === "activate_module") await assertActivationTarget(tx, workspaceId, input.moduleId, input.payload);
      const row = await tx.approval.create({ data: { ...input, payload: input.payload as Prisma.InputJsonValue, workspaceId, createdAt: now() } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: row.id, details: { action: input.action } });
      return toApproval(row);
    }),
    resolve: (id: string, raw: unknown, source: "rescue" | "cli" | "web" | "mcp" | "qq" | "entry" = "entry") => db.$transaction(async tx => {
      const input = parseInput(resolveApprovalSchema, raw);
      const row = await tx.approval.findFirst({ where: { workspaceId, id } });
      if (!row) throw new StewardError("not_found", "Approval not found");
      if (row.status !== "open") throw new StewardError("conflict", "Approval already resolved");
      let grantId: string | null = null;
      if (input.decision === "approve") {
        // A group never becomes a standing grant: it is approved once, by the user.
        if (isGroupPayload(row.payload) && input.scope !== "once") throw new StewardError("invalid", "A group activation can only be approved once");
        if (row.action === "activate_module") await assertBuiltinUpgrade(tx, workspaceId, row.moduleId, row.payload);
        grantId = await grantApproval(tx, { db, workspaceId, now }, row, input.scope);
      }
      const changed = await tx.approval.updateMany({ where: { workspaceId, id, status: "open" }, data: { status: input.decision === "approve" ? "approved" : "denied", scope: input.scope, grantId, resolvedAt: now() } });
      if (!changed.count) throw new StewardError("conflict", "Approval already resolved");
      await audit(tx, { workspaceId, actor: "user", kind: "approval_resolved", subjectId: id, details: { ...input, grantId, source } });
      const resumed = ports ? await resume(tx, ports, workspaceId, row, input) : false;
      return { approval: toApproval(await tx.approval.findUniqueOrThrow({ where: { id } })), grantId, payload: input.decision === "approve" ? row.payload : null, resumed };
    }).then(async result => {
      if (onApproved && result.grantId && result.payload !== null) await onApproved({ workspaceId, approvalId: id, grantId: result.grantId, payload: result.payload });
      if (result.resumed) await ports!.onQueued?.();
      return result;
    }),
  };
}
