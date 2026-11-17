import type { StewardPorts } from "../ports";
import { StewardError } from "../errors";
import { createRuns, liveRuns } from "../execution/runs";
export async function cancelProviderRun(ports: StewardPorts, workspaceId: string, id: string): Promise<{ ok: true }> {
  const { db, now } = ports;
  const run = await db.run.findFirst({ where: { workspaceId, id } });
  if (!run) throw new StewardError("not_found", "Run not found");
  const prior = run.cancelRequestedAt;
  if (!prior && !["running", "queued"].includes(run.status) && run.stopStatus !== "unknown") throw new StewardError("conflict", "Run already ended");
  await db.run.update({ where: { id }, data: { cancelRequestedAt: prior ?? now() } });
  const queued = await db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const current = await tx.run.findFirst({ where: { id, workspaceId, status: "queued" } });
    return !!current && createRuns(ports, workspaceId).finishRunIn(tx, id, { outcome: "cancelled", sessionId: null, error: "Cancelled by owner" }, now(), "never_started");
  });
  if (queued) await ports.onRunFinished?.(workspaceId, id);
  else {
    await liveRuns.get(id)?.abort();
    await createRuns(ports, workspaceId).finish(id, { outcome: "failed", sessionId: null, error: "Cancelled by owner" });
  }
  return { ok: true };
}
