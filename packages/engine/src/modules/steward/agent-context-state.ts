import { createHash } from "node:crypto";
import type { Prisma } from "@chrona/db";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
import { CallError } from "./module-call-error";
import { moduleRequestDigest } from "./module-request-digest";

export const contextDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Delivery-local accounting scope is charged only on first admission, not part of the caller's durable request. */
export function contextRequestDigest(args: Record<string, unknown>) {
  const { callScope: _callScope, ...request } = args;
  return moduleRequestDigest(request);
}
export type ModulePrincipal = ExecutionPrincipal & { caller: { kind: "module"; moduleId: string; hash: string } };
export function modulePrincipal(principal: ExecutionPrincipal): ModulePrincipal {
  if (principal.caller.kind !== "module") throw new CallError("forbidden", "Agent context requires a module caller");
  return principal as ModulePrincipal;
}
export async function ownedContext(tx: Prisma.TransactionClient, principal: ModulePrincipal, contextId: string) {
  const row = await tx.session.findFirst({ where: { id: contextId, workspaceId: principal.workspaceId, moduleId: principal.caller.moduleId, source: "module" } });
  const grant = await tx.agentContext.findUnique({ where: { sessionId: contextId } });
  if (!row || grant?.hash !== principal.caller.hash || grant.moduleId !== principal.caller.moduleId || grant.workspaceId !== principal.workspaceId) throw new CallError("not_found", "Agent context not found");
  return { ...row, providerId: grant.providerId, providerRevision: grant.providerRevision };
}
export async function ownedRun(tx: Prisma.TransactionClient, principal: ModulePrincipal, runId: string) {
  const row = await tx.run.findFirst({ where: { id: runId, workspaceId: principal.workspaceId, execution: null } });
  if (!row?.sessionId) throw new CallError("not_found", "Agent run not found");
  await ownedContext(tx, principal, row.sessionId);
  return row;
}
export function view(run: { id: string; sessionId: string | null; status: string; stopStatus: string }) {
  const uncertain = run.stopStatus === "unknown";
  return { runId: run.id, contextId: run.sessionId!, status: uncertain ? "unknown" : run.status, active: uncertain || run.status === "queued" || run.status === "running" };
}
