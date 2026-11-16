import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { approvalSchema, resolveApprovalSchema } from "@chrona/contracts/steward";
import type { OnApproved, StewardPorts } from "./ports";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
import { audit } from "./audit";
import { recordApprovalFact, recordWithdrawal } from "./notification-facts";
import { parseInput, StewardError } from "./errors";
import { toApproval } from "./store";
import { assertDynamicModuleActivation, groupPayloadSchema, isGroupPayload } from "./modules/module-context";
import { assertExternalModule } from "./modules/module-identity";
import { moduleRemovePayloadSchema } from "./modules/module-remove-payload";
import { drainCalls, settleWaiting } from "./modules/module-calls";
const inputSchema = approvalSchema.pick({ action: true, title: true, detail: true, preview: true }).extend({ moduleId: z.string().min(1).optional(), payload: z.json() }).strict();
/** Module activation must still pass its current identity and payload guards. */
async function approve(tx: Prisma.TransactionClient, workspaceId: string, row: Parameters<typeof toApproval>[0]) {
  if (row.action === "activate_module") await assertDynamicModuleActivation(tx, workspaceId, row.moduleId, row.payload);
}
/** v2-16: something a module asked the user to decide (`approvals.request`); the decision goes back to its waiting call. */
export const isModuleRequest = (payload: unknown): payload is { kind: "module_request"; hash: string; call: string } =>
  !!payload && typeof payload === "object" && !Array.isArray(payload) && (payload as { kind?: unknown }).kind === "module_request" && typeof (payload as { call?: unknown }).call === "string";
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
const moduleEffectPayloadSchema = z.union([
  groupPayloadSchema, moduleRemovePayloadSchema,
  z.object({ kind: z.literal("activate_module"), moduleId: z.string(), hash: z.string() }).passthrough(),
]);
// Replaying after a newer activation would roll the app back to an older version.
async function pendingModuleEffect(tx: Prisma.TransactionClient, workspaceId: string, row: Parameters<typeof toApproval>[0]) {
  if (row.status !== "approved" || !row.resolvedAt) return false;
  const parsed = moduleEffectPayloadSchema.safeParse(row.payload);
  if (!parsed.success) return false;
  const payload = parsed.data;
  if (payload.kind === "module_remove") return !await tx.moduleRemoval.findFirst({ where: { workspaceId, moduleId: payload.moduleId } });
  const versions = payload.kind === "activate_modules" ? payload.versions : [{ moduleId: payload.moduleId, hash: payload.hash }];
  const modules = await tx.module.findMany({ where: { workspaceId, id: { in: versions.map(version => version.moduleId) } } });
  if (versions.some(version => !modules.some(module => module.id === version.moduleId && module.status !== "migrating"))) return false;
  if (versions.every(version => modules.some(module => module.id === version.moduleId && module.activeHash === version.hash && module.status === "active"))) return false;
  const newer = await tx.moduleActivation.findFirst({ where: {
    moduleId: { in: versions.map(version => version.moduleId) }, activatedAt: { gt: row.resolvedAt.toISOString() }, module: { workspaceId },
  } });
  return !newer;
}
async function afterResolve<T extends { payload: Prisma.JsonValue | null; request: boolean }>(result: T, id: string, workspaceId: string, ports: StewardPorts | undefined, onApproved: OnApproved | undefined): Promise<T> {
  if (onApproved && !result.request && result.payload !== null) await onApproved({ workspaceId, approvalId: id, payload: result.payload });
  if (ports && result.request) void drainCalls(ports, workspaceId).catch(error => console.error(JSON.stringify({ component: "approvals", event: "drain_calls.failed", workspaceId: workspaceId, error: String(error).slice(0, 2000) })));
  return result;
}
export function createApprovals(context: RecordContext & { ports?: StewardPorts }, onApproved?: OnApproved, ports?: StewardPorts) {
  const { db, workspaceId, now } = context;
  return {
    list: async (status?: "open" | "approved" | "denied" | "expired") => (await db.approval.findMany({ where: { workspaceId, status }, orderBy: { createdAt: "desc" } })).map(toApproval),
    create: (raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(inputSchema, raw);
      if (input.moduleId && !await tx.module.findFirst({ where: { workspaceId, id: input.moduleId } })) throw new StewardError("not_found", "Module not found");
      if (input.payload === null) throw new StewardError("invalid", "Approval payload must not be null");
      if (input.action === "activate_module") {
        await assertActivationTarget(tx, workspaceId, input.moduleId, input.payload);
        await assertDynamicModuleActivation(tx, workspaceId, input.moduleId ?? null, input.payload);
      }
      if (input.action === "delete_data" && (input.payload as { kind?: unknown }).kind === "module_remove") {
        const removal = parseInput(moduleRemovePayloadSchema, input.payload);
        if (input.moduleId && input.moduleId !== removal.moduleId) throw new StewardError("invalid", "Removal approval must bind the same module");
        await assertExternalModule(tx, workspaceId, removal.moduleId, "remove");
      }
      const row = await tx.approval.create({ data: { ...input, payload: input.payload as Prisma.InputJsonValue, workspaceId, createdAt: now() } });
      await recordApprovalFact(tx, row);
      await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: row.id, details: { action: input.action } });
      return toApproval(row);
    }),
    resolve: (id: string, raw: unknown, source: string = "entry") => db.$transaction(async tx => {
      const input = parseInput(resolveApprovalSchema, raw);
      const status = input.decision === "approve" ? "approved" : "denied";
      const row = await tx.approval.findFirst({ where: { workspaceId, id } });
      if (!row) throw new StewardError("not_found", "Approval not found");
      if (row.status !== "open") {
        if (row.status !== status) throw new StewardError("conflict", "Approval already resolved differently");
        const replay = input.decision === "approve" && await pendingModuleEffect(tx, workspaceId, row);
        if (replay) await audit(tx, { workspaceId, actor: "user", kind: "approval_replayed", subjectId: id, details: { source } });
        return { approval: toApproval(row), payload: replay ? row.payload : null, request: isModuleRequest(row.payload) };
      }
      if (input.decision === "approve") await approve(tx, workspaceId, row);
      const changed = await tx.approval.updateMany({ where: { workspaceId, id, status: "open" }, data: { status, resolvedAt: now() } });
      if (!changed.count) throw new StewardError("conflict", "Approval already resolved");
      await recordWithdrawal(tx, workspaceId, `approval:${id}`, now());
      await audit(tx, { workspaceId, actor: "user", kind: "approval_resolved", subjectId: id, details: { ...input, source } });
      if (isModuleRequest(row.payload)) await settleWaiting(tx, row.payload.call, { approval: id, decision: status }, now());
      return { approval: toApproval(await tx.approval.findUniqueOrThrow({ where: { id } })), payload: input.decision === "approve" ? row.payload : null, request: isModuleRequest(row.payload) };
    }).then(result => afterResolve(result, id, workspaceId, ports, onApproved)),
  };
}
