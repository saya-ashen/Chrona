import { createHash } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { StewardError } from "../errors";

export async function authenticateRun(tx: Prisma.TransactionClient, token: string, now: Date, _tool?: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await tx.run.findUnique({ where: { tokenHash }, include: { session: true } });
  if (!row || row.status !== "running" || (row.deadlineAt !== null && row.deadlineAt <= now) || (row.leaseUntil !== null && row.leaseUntil <= now) || row.cancelRequestedAt) throw new StewardError("forbidden", "Run capability is no longer valid");
  const { session, ...run } = row;
  return { run, session, workspaceId: row.workspaceId };
}
