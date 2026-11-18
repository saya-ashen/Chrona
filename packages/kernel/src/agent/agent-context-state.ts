import { createHash } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { CallError } from "../modules/module-call-error";
import { moduleRequestDigest } from "../modules/module-request-digest";

export type AgentPrincipal = {
  workspaceId: string;
  ownerId: string;
  caller: { kind: "owner" } | { kind: "module"; moduleId: string; hash: string };
};
export type ModulePrincipal = AgentPrincipal & { caller: { kind: "module"; moduleId: string; hash: string } };

export async function assertApprovedAgentPrincipal(tx: Prisma.TransactionClient, principal: ModulePrincipal, allowFenced = true) {
  const { workspaceId, caller } = principal;
  const module = await tx.module.findFirst({ where: { workspaceId, id: caller.moduleId, activeHash: caller.hash, status: "active",
    ...(allowFenced ? {} : { executionFenceAt: null }), versions: { some: { hash: caller.hash, status: "approved" } } }, select: { id: true } });
  if (!module) throw new CallError("forbidden", "Agent caller is no longer its approved active module");
}

export const contextDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Delivery-local accounting scope is charged only on first admission, not part of the caller's durable request. */
export function contextRequestDigest(args: Record<string, unknown>) {
  const { callScope: _callScope, ...request } = args;
  return moduleRequestDigest(request);
}
export function modulePrincipal(principal: AgentPrincipal): ModulePrincipal {
  if (principal.caller.kind !== "module") throw new CallError("forbidden", "Agent context requires a module caller");
  return principal as ModulePrincipal;
}
export async function ownedContext(tx: Prisma.TransactionClient, principal: ModulePrincipal, contextId: string) {
  const context = await tx.agentContext.findFirst({ where: { id: contextId, workspaceId: principal.workspaceId, ownerId: principal.ownerId,
    moduleId: principal.caller.moduleId, hash: principal.caller.hash } });
  if (!context) throw new CallError("not_found", "Agent context not found");
  return context;
}
export async function ownedRun(tx: Prisma.TransactionClient, principal: ModulePrincipal, runId: string) {
  const row = await tx.run.findFirst({ where: { id: runId, workspaceId: principal.workspaceId } });
  if (!row?.sessionId) throw new CallError("not_found", "Agent run not found");
  await ownedContext(tx, principal, row.sessionId);
  return row;
}
export function view(run: { id: string; sessionId: string | null; status: string; stopStatus: string }) {
  const uncertain = run.stopStatus === "unknown";
  return { runId: run.id, contextId: run.sessionId!, status: uncertain ? "unknown" : run.status, active: uncertain ||
    run.status === "queued" || run.status === "running" };
}
