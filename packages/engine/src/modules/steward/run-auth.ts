import { createHash } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { StewardError } from "./errors";
import { providerCancelKey } from "./provider-journal";

/** Shared capability enforcement for native tools and the trusted execution module. */
export async function authenticateRun(tx: Prisma.TransactionClient, token: string, now: Date, _tool?: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await tx.run.findUnique({ where: { tokenHash }, include: { session: true } });
  if (!row || row.status !== "running" || !row.deadlineAt || row.deadlineAt <= now || !row.leaseUntil || row.leaseUntil <= now || (await tx.executionAttempt.findUnique({ where: { runId: row.id }, select: { capabilityRevokedAt: true } }))?.capabilityRevokedAt || await tx.audit.findUnique({ where: { id: providerCancelKey(row.id) } })) throw new StewardError("forbidden", "Run capability is no longer valid");
  const { session, ...run } = row;
  return { run, session, workspaceId: row.workspaceId };
}
