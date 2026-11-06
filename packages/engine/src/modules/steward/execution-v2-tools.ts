import type { Prisma } from "@chrona/db";
import { WORK_LIMITS, type ExecutionPrincipal, type ExecutionStartV2, type WorkCleanupInput, type WorkLocation, type WorkPlacement } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError } from "./module-calls";
import { assertExecutionPrincipal } from "./execution-principal";
import { executionCallerKey, executionScope, executionDigest } from "./execution-state";
import { executionPlacementIn } from "./execution-admission";
import { executionGrant } from "./execution-claim";

/** V2 tool lookups never inherit v1 owner's cross-module read authority. */
async function scopedAttempt(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, workId: string) {
  await assertExecutionPrincipal(tx, principal);
  const rows = await tx.executionAttempt.findMany({ where: { ...executionScope(principal), callerKey: executionCallerKey(principal), workId }, include: { run: true }, take: 2 });
  if (!rows.length) throw new CallError("not_found", "Execution not found");
  if (rows.length !== 1) throw new CallError("conflict", "Execution reference is ambiguous");
  return rows[0]!;
}
async function online(ports: StewardPorts, tx: Prisma.TransactionClient, executorId: string) {
  return executorId === "server" || !!await ports.executorAdmission?.online(tx, { executorId, now: ports.now() });
}
async function placement(ports: StewardPorts, principal: ExecutionPrincipal, workId: string) {
  return ports.db.$transaction(async tx => {
    const row = await scopedAttempt(tx, principal, workId);
    return executionPlacementIn(tx, row, await online(ports, tx, row.executorId));
  });
}
async function location(ports: StewardPorts, tx: Prisma.TransactionClient, principal: ExecutionPrincipal, selected: WorkPlacement): Promise<WorkLocation> {
  const grant = await executionGrant(ports, tx, principal, selected);
  return { executorId: grant.executorId, projectRef: grant.projectRef, mappingRevision: grant.mappingRevision, label: grant.label, kind: grant.executor,
    online: await online(ports, tx, grant.executorId), baseline: grant.baseline, workspaceModes: grant.baseline.kind === "commit" ? ["existing", "independent_worktree"] : ["existing"] };
}
async function locations(ports: StewardPorts, principal: ExecutionPrincipal, input: { after?: string; limit: number }) {
  if (!ports.executionLocations) throw new CallError("unavailable", "Execution locations are not configured");
  return ports.db.$transaction(async tx => {
    await assertExecutionPrincipal(tx, principal);
    const configured = await ports.executionLocations!(principal, tx);
    const choices = [...new Map(configured.map(item => [executionDigest(item), item])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const index = input.after ? choices.findIndex(([key]) => key === input.after) : -1;
    if (input.after && index < 0) throw new CallError("not_found", "Location cursor is not in the authorized configuration");
    const entries = choices.slice(index + 1, index + 1 + input.limit), result: WorkLocation[] = [];
    for (const [, selected] of entries) result.push(await location(ports, tx, principal, selected));
    while (Buffer.byteLength(JSON.stringify({ locations: result, after: entries.at(-1)?.[0] ?? null })) > WORK_LIMITS.responseBytes && result.length) { result.pop(); entries.pop(); }
    if (entries.length === 0 && choices.length > index + 1) throw new CallError("too_large", "Location exceeds response budget");
    return { locations: result, after: choices.length > index + 1 + entries.length ? entries.at(-1)![0] : null };
  });
}
async function cleanup(ports: StewardPorts, principal: ExecutionPrincipal, input: WorkCleanupInput) {
  if (!ports.executionWorkspaces) throw new CallError("unavailable", "Workspace cleanup is unavailable");
  const row = await ports.db.$transaction(tx => scopedAttempt(tx, principal, input.workId));
  if (!row.workspaceRef || row.workspaceMode !== "independent_worktree") throw new CallError("unsupported", "No owned independent workspace");
  // Trusted adapter owns receipt-first replay and fresh physical stop/retain/integration checks.
  const receipt = await ports.executionWorkspaces.cleanup(principal, input);
  if (receipt.workId !== row.workId || receipt.workspaceRef !== row.workspaceRef) throw new CallError("conflict", "Cleanup receipt belongs to another workspace");
  return receipt;
}
export async function handleExecutionV2Tool(ports: StewardPorts, principal: ExecutionPrincipal, name: string, args: Record<string, unknown>) {
  if (name === "start-v2") {
    if (!ports.executionV2Admission) throw new CallError("unavailable", "Execution admission is unavailable");
    return ports.executionV2Admission.start(principal, args as ExecutionStartV2);
  }
  if (name === "placement") return placement(ports, principal, args.workId as string);
  if (name === "locations") return locations(ports, principal, args as { after?: string; limit: number });
  if (name === "workspace-cleanup") return cleanup(ports, principal, args as WorkCleanupInput);
  throw new CallError("not_found", "Execution tool not found");
}
