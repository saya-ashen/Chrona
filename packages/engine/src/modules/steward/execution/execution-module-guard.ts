import type { Prisma } from "@chrona/db";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
import { CallError } from "../modules/module-call-error";
import { StewardError } from "../errors";

/** A version switch or removal must not orphan the module's pending execution or writable directory. */
export async function assertExecutionModuleIdle(tx: Prisma.TransactionClient, moduleId: string) {
  if (await tx.agentRunProvider.findFirst({ where: { moduleId, run: { OR: [{ status: { in: ["queued", "running"] } }, { stopStatus: "unknown" }] } }, select: { runId: true } })) throw new StewardError("conflict", "Provider 仍有排队、运行或停止待确认的执行，请先停止并核对结果");
  if (await tx.run.findFirst({ where: { session: { moduleId, source: "module" }, OR: [{ status: { in: ["queued", "running"] } }, { stopStatus: "unknown" }] }, select: { id: true } })) throw new StewardError("conflict", "应用仍有排队、运行或停止待确认的 Agent 执行，请先停止并核对结果");
  if (await tx.agentCommand.findFirst({ where: { moduleId, settled: false }, select: { id: true } })) throw new StewardError("conflict", "Application has an unsettled Agent command");
  // operationId is kernel receipt output, never native request data. Bind it to the
  // admitted caller hash and retained provider, even after confirmed Run stop.
  const pendingProviderCommands = await tx.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "AgentCommand" c
    JOIN "Run" r ON r."id" = json_extract(c."output", '$.operationId') AND r."workspaceId" = c."workspaceId"
    JOIN "AgentRunAdmission" a ON a."runId" = r."id" AND a."moduleId" = c."moduleId" AND a."hash" = c."hash"
    JOIN "AgentRunProvider" p ON p."runId" = r."id"
    WHERE c."settled" = false AND p."moduleId" = ${moduleId}
    LIMIT 1
  `;
  if (pendingProviderCommands.length) throw new StewardError("conflict", "Provider has an unsettled Agent command");
  if (await tx.executionAttempt.findFirst({ where: { heldDirectory: { not: null }, OR: [{ moduleId }, { delivery: { receiverModuleId: moduleId } }, { placement: { path: "$.applicationId", equals: moduleId } }] }, select: { id: true } })) {
    throw new StewardError("conflict", "应用仍有排队、运行或停止待确认的编码工作，请先停止并核对结果");
  }
  if (await tx.executionDelivery.findFirst({ where: { OR: [{ receiverModuleId: moduleId }, { attempt: { moduleId } }], receipts: { some: { operation: "cleanup", direction: "outbound", acceptedAt: null } } }, select: { id: true } })) throw new StewardError("conflict", "Application has an unresolved workspace cleanup delivery");
  const commands = await tx.executionCommand.findMany({ where: { attempt: { OR: [{ moduleId }, { delivery: { receiverModuleId: moduleId } }, { placement: { path: "$.applicationId", equals: moduleId } }] }, OR: [{ effect: "unknown" }, { operation: { startsWith: "workspace-cleanup-" } }] }, select: { operation: true, effect: true, receipt: true } });
  if (commands.some(command => {
    const result = (command.receipt as { result?: { state?: string } } | null)?.result;
    return command.effect === "unknown" || command.operation.startsWith("workspace-cleanup-") && (!result || result.state === "unknown");
  })) throw new StewardError("conflict", "Application has an unresolved execution control or workspace cleanup");
}

/** Retained reads and exact receipts remain usable during drain, only for the active caller hash. */
export async function assertRetainedExecutionPrincipal(tx: Prisma.TransactionClient, principal: ExecutionPrincipal) {
  if (principal.caller.kind === "owner") return;
  if (!await tx.module.findFirst({ where: { workspaceId: principal.workspaceId, id: principal.caller.moduleId, activeHash: principal.caller.hash, status: "active" }, select: { id: true } })) throw new CallError("forbidden", "Execution caller is no longer active");
}
