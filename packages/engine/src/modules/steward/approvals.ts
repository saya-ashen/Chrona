import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { ACTIONS, APPROVAL_LEVELS, approvalSchema, resolveApprovalSchema } from "@chrona/contracts/steward";
import { decidePolicy } from "@chrona/domain/steward/policy";
import type { OnApproved, StewardPorts } from "./ports";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toApproval, toGrant } from "./store";
import { assertBuiltinUpgrade, groupPayloadSchema, isGroupPayload } from "./module-context";
import { createRuns } from "./runs";
import { drainCalls, settleWaiting } from "./module-calls";
import { assessApproval, RED_ACTIONS } from "./approval-level";
/** `level` may only raise what the kernel computes (e.g. a module marking its own request red). */
const inputSchema = approvalSchema.pick({ action: true, title: true, detail: true, preview: true }).extend({ moduleId: z.string().min(1).optional(), payload: z.json(), level: z.enum(APPROVAL_LEVELS).optional() }).strict();
/** Approving a red approval needs the page (or local administration): chat buttons and agents cannot. Denying is always allowed. */
const RED_SOURCES = new Set(["web", "cli", "rescue"]);
async function grantApproval(tx: Prisma.TransactionClient, context: RecordContext, row: Parameters<typeof toApproval>[0], scope: z.infer<typeof resolveApprovalSchema>["scope"]) {
  const { workspaceId, now } = context;
  const action = toApproval(row).action;
  const grant = await tx.grant.create({ data: { workspaceId, action, mode: "preapproved", scope: row.moduleId ? { kind: "module", moduleId: row.moduleId } : { kind: "global" }, once: scope === "once", createdAt: now() } });
  const decision = decidePolicy(action, row.moduleId ? { moduleId: row.moduleId } : {}, (await tx.grant.findMany({ where: { workspaceId, action } })).map(toGrant), now());
  if (decision.mode === "never" || decision.mode === "ask") throw new StewardError("forbidden", "Policy does not allow this approval");
  return grant.id;
}
function assertSource(level: string, decision: string, source: string) {
  if (decision === "approve" && level === "red" && !RED_SOURCES.has(source)) throw new StewardError("forbidden", "高风险操作请在网页「待你决定」中批准");
}
/** v2-17 §5: a weekly suggestion to stop asking about one yellow kind of Chrona's own requests. */
const isGrantSuggestion = (payload: unknown): payload is { kind: "grant_suggestion"; action: string } =>
  !!payload && typeof payload === "object" && (payload as { kind?: unknown }).kind === "grant_suggestion" && typeof (payload as { action?: unknown }).action === "string";
/** Approving it creates the standing grant it describes, and no other; never for a red kind. */
async function suggestedGrant(tx: Prisma.TransactionClient, { workspaceId, now }: RecordContext, action: string) {
  if (!(ACTIONS as readonly string[]).includes(action) || RED_ACTIONS.has(action) || action === "activate_module") throw new StewardError("invalid", "This kind of action cannot be pre-approved");
  const grant = await tx.grant.create({ data: { workspaceId, action, mode: "preapproved", scope: { kind: "global" }, createdAt: now() } });
  return grant.id;
}
/** The grant an approval leaves, if any. */
async function approve(tx: Prisma.TransactionClient, context: RecordContext, row: Parameters<typeof toApproval>[0], scope: z.infer<typeof resolveApprovalSchema>["scope"]) {
  // A group never becomes a standing grant: it is approved once, by the user.
  if (isGroupPayload(row.payload) && scope !== "once") throw new StewardError("invalid", "A group activation can only be approved once");
  if (row.level === "red" && scope !== "once") throw new StewardError("invalid", "A red approval can only be approved once");
  // A module's request is one decision, never a standing grant that would let it approve itself later.
  if (isModuleRequest(row.payload)) {
    if (scope !== "once") throw new StewardError("invalid", "A module's request can only be approved once");
    return null;
  }
  if (isGrantSuggestion(row.payload)) return suggestedGrant(tx, context, row.payload.action);
  if (row.action === "activate_module") await assertBuiltinUpgrade(tx, context.workspaceId, row.moduleId, row.payload);
  return grantApproval(tx, context, row, scope);
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
export function createApprovals(context: RecordContext & { ports?: StewardPorts }, onApproved?: OnApproved, ports?: StewardPorts) {
  const { db, workspaceId, now } = context, known = ports ?? context.ports, facts = { isolated: !!known?.sandbox?.isolated, ...(known ? { dataDir: known.dataDir } : {}) };
  return {
    list: async (status?: "open" | "approved" | "denied" | "expired") => (await db.approval.findMany({ where: { workspaceId, status }, orderBy: { createdAt: "desc" } })).map(toApproval),
    create: (raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(inputSchema, raw);
      if (input.moduleId && !await tx.module.findFirst({ where: { workspaceId, id: input.moduleId } })) throw new StewardError("not_found", "Module not found");
      if (input.payload === null) throw new StewardError("invalid", "Approval payload must not be null");
      if (input.action === "activate_module") await assertActivationTarget(tx, workspaceId, input.moduleId, input.payload);
      const { level, brief } = await assessApproval(tx, facts, input);
      const row = await tx.approval.create({ data: { ...input, level, brief, payload: input.payload as Prisma.InputJsonValue, workspaceId, createdAt: now() } });
      await audit(tx, { workspaceId, actor: "chrona", kind: "approval_created", subjectId: row.id, details: { action: input.action } });
      return toApproval(row);
    }),
    resolve: (id: string, raw: unknown, source: "rescue" | "cli" | "web" | "mcp" | "qq" | "entry" = "entry") => db.$transaction(async tx => {
      const input = parseInput(resolveApprovalSchema, raw);
      const row = await tx.approval.findFirst({ where: { workspaceId, id } });
      if (!row) throw new StewardError("not_found", "Approval not found");
      if (row.status !== "open") throw new StewardError("conflict", "Approval already resolved");
      const grantId = input.decision === "approve" ? await approve(tx, { db, workspaceId, now }, row, input.scope) : null;
      // Checked after the approval's own rules; the transaction drops any grant made above.
      assertSource(row.level, input.decision, source);
      const changed = await tx.approval.updateMany({ where: { workspaceId, id, status: "open" }, data: { status: input.decision === "approve" ? "approved" : "denied", scope: input.scope, grantId, resolvedAt: now() } });
      if (!changed.count) throw new StewardError("conflict", "Approval already resolved");
      await audit(tx, { workspaceId, actor: "user", kind: "approval_resolved", subjectId: id, details: { ...input, grantId, source } });
      if (isModuleRequest(row.payload)) await settleWaiting(tx, row.payload.call, { approval: id, decision: input.decision === "approve" ? "approved" : "denied" }, now());
      const resumed = ports ? await resume(tx, ports, workspaceId, row, input) : false;
      return { approval: toApproval(await tx.approval.findUniqueOrThrow({ where: { id } })), grantId, payload: input.decision === "approve" ? row.payload : null, resumed, request: isModuleRequest(row.payload) };
    }).then(async result => {
      if (onApproved && result.grantId && result.payload !== null) await onApproved({ workspaceId, approvalId: id, grantId: result.grantId, payload: result.payload });
      if (result.resumed) await ports!.onQueued?.();
      if (ports && result.request) void drainCalls(ports, workspaceId).catch(() => {});
      return result;
    }),
  };
}
