import { grantedUses, type ExecutionPrincipal } from "@chrona/contracts/steward";
import { CallError, type Caller } from "./module-calls";
import { callerManifest } from "./system/shared";
import type { StewardPorts } from "./ports";
import type { Prisma } from "@chrona/db";

/** The principal was admitted by the router; recheck its immutable active identity at each write boundary. */
export async function assertExecutionPrincipal(tx: Prisma.TransactionClient, principal: ExecutionPrincipal) {
  if (principal.caller.kind === "owner") return;
  const row = await tx.module.findFirst({ where: { workspaceId: principal.workspaceId, id: principal.caller.moduleId, activeHash: principal.caller.hash, status: "active" }, select: { id: true } });
  if (!row) throw new CallError("forbidden", "Execution caller is no longer active");
}

/** Called by system/executions after routed admission. No body/header can supply this identity. */
export async function resolveExecutionPrincipal(ports: StewardPorts, workspaceId: string, caller: Caller): Promise<ExecutionPrincipal> {
  const owner = { workspaceId, ownerId: "owner", caller: { kind: "owner" as const } };
  if (caller.kind === "owner") return owner;
  if (caller.kind !== "module") throw new CallError("forbidden", "Executions require an owner or active module caller");
  const row = await ports.db.module.findFirst({ where: { workspaceId, id: caller.moduleId, activeHash: caller.hash, status: "active" } });
  const manifest = row ? await callerManifest(ports.db, caller) : null;
  if (!manifest) throw new CallError("forbidden", "Execution caller is no longer active");
  // Same owner authority as admitted(): an approved uses:["*"] entry, never a name-based exception.
  return grantedUses(manifest).includes("*") ? owner : { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: caller.moduleId, hash: caller.hash } };
}
