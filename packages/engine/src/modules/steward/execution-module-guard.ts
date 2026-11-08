import type { Prisma } from "@chrona/db";
import { StewardError } from "./errors";

/** A version switch or removal must not orphan the module's pending execution or writable directory. */
export async function assertExecutionModuleIdle(tx: Prisma.TransactionClient, moduleId: string) {
  const contexts = await tx.audit.findMany({ where: { actorKey: moduleId, kind: "agent_context", subjectId: { not: null } }, select: { subjectId: true } });
  if (await tx.run.findFirst({ where: { sessionId: { in: contexts.flatMap(row => row.subjectId ? [row.subjectId] : []) }, session: { moduleId, source: "module" }, OR: [{ status: { in: ["queued", "running"] } }, { error: "Execution stop is unconfirmed" }] }, select: { id: true } })) throw new StewardError("conflict", "应用仍有排队、运行或停止待确认的 Agent 执行，请先停止并核对结果");
  if (await tx.executionAttempt.findFirst({ where: { moduleId, heldDirectory: { not: null } }, select: { id: true } })) {
    throw new StewardError("conflict", "应用仍有排队、运行或停止待确认的编码工作，请先停止并核对结果");
  }
}
