import type { Prisma } from "@chrona/db";
import { redactSensitiveValue } from "@chrona/logging/redaction";

/** One transactional cursor shared by telemetry and actual routed tool results. */
export async function appendRunEventIn(tx: Prisma.TransactionClient, runId: string, kind: string, payload: Prisma.InputJsonValue, at: Date) {
  const run = await tx.run.update({ where: { id: runId }, data: { eventSequence: { increment: 1 } }, select: { eventSequence: true } });
  return tx.runEvent.create({ data: { runId, sequence: run.eventSequence, kind, payload, createdAt: at } });
}

/** A filtered/oversized result is explicitly incomplete and cannot prove delivery. */
export function retainedToolOutput(output: unknown, sensitive: boolean) {
  if (sensitive) return { outputState: "omitted" as const, output: null };
  const original = JSON.stringify(output), safe = redactSensitiveValue(output, { maxLength: 16000 });
  const text = JSON.stringify(safe);
  if (Buffer.byteLength(text, "utf8") > 32000) return { outputState: "omitted" as const, output: null };
  return { outputState: text === original ? "complete" as const : "filtered" as const, output: safe as Prisma.InputJsonValue };
}

/** The target identity was frozen before delivery, not inferred from a same-name current app. */
export function appendRunToolResultIn(tx: Prisma.TransactionClient, row: { id: string; runId: string | null; target: string; tool: string; targetModuleId: string | null; targetHash: string | null; targetContractHash: string | null; status: string; output: Prisma.JsonValue }, at: Date, sensitive: boolean) {
  if (!row.runId) return;
  return appendRunEventIn(tx, row.runId, "tool-result", { type: "tool-result", at: at.toISOString(), value: {
    runId: row.runId, callId: row.id, target: `${row.target}.${row.tool}`, moduleId: row.targetModuleId!, hash: row.targetHash!, contractHash: row.targetContractHash!,
    status: row.status, ...retainedToolOutput(row.output, sensitive),
  } }, at);
}

/** A stopped Provider does not prove whether an outstanding application tool took effect. */
export async function interruptRunCallsIn(tx: Prisma.TransactionClient, runId: string, at: Date) {
  const pending = await tx.moduleInvocation.findMany({ where: { runId, mode: "sync", status: "running" } });
  for (const row of pending) {
    const updated = await tx.moduleInvocation.update({ where: { id: row.id }, data: { status: "unknown", error: "Run interrupted before a tool receipt was committed", finishedAt: at } });
    await appendRunToolResultIn(tx, updated, at, true);
  }
}
