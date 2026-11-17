import type { Prisma } from "@chrona/db";
import { StewardError } from "../errors";

export async function assertExecutionModuleIdle(tx: Prisma.TransactionClient, moduleId: string) {
  if (await tx.agentRunProvider.findFirst({ where: { moduleId, run: { OR: [{ status: { in: ["queued", "running"] } }, { stopStatus: "unknown" }] } }, select: { runId: true } })) throw new StewardError("conflict", "Provider 仍有排队、运行或停止待确认的执行，请先停止并核对结果");
  if (await tx.run.findFirst({ where: { AND: [{ OR: [{ agentAdmission: { moduleId } }, { session: { moduleId } }] }, { OR: [{ status: { in: ["queued", "running"] } }, { stopStatus: "unknown" }] }] }, select: { id: true } })) throw new StewardError("conflict", "应用仍有排队、运行或停止待确认的 Agent 执行，请先停止并核对结果");
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
}
