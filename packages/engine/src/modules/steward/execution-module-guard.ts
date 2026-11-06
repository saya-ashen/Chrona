import type { Prisma } from "@chrona/db";
import { StewardError } from "./errors";

/** A version switch or removal must not orphan the module's pending execution or writable directory. */
export async function assertExecutionModuleIdle(tx: Prisma.TransactionClient, moduleId: string) {
  if (await tx.executionAttempt.findFirst({ where: { moduleId, heldDirectory: { not: null } }, select: { id: true } })) {
    throw new StewardError("conflict", "应用仍有排队、运行或停止待确认的编码工作，请先停止并核对结果");
  }
}
