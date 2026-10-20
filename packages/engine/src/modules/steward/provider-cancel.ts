import { z } from "zod";
import type { StewardPorts } from "./ports";
import { StewardError } from "./errors";
import { createRuns, liveRuns } from "./runs";
import { providerCancelKey } from "./provider-journal";
const continuation = z.object({ runId: z.string().min(1).max(128) }).strict();

/** Cancel only this attempt's automatic continuations, never unrelated work or future schedules. */
export function cancelProviderRun(ports: StewardPorts, workspaceId: string, id: string) {
  return cancelAttempt(ports, workspaceId, id, false, new Set<string>());
}
async function cancelAttempt(ports: StewardPorts, workspaceId: string, id: string, allowEnded: boolean, seen: Set<string>): Promise<{ ok: true }> {
  if (seen.has(id)) return { ok: true };
  if (seen.size >= 32) throw new StewardError("conflict", "Too many automatic continuations to cancel safely");
  seen.add(id);
  const { db, now } = ports, run = await db.run.findFirst({ where: { workspaceId, id } });
  if (!run) throw new StewardError("not_found", "Run not found");
  const prior = await db.audit.findUnique({ where: { id: providerCancelKey(id) } });
  if (!allowEnded && !prior && !["running", "queued"].includes(run.status)) throw new StewardError("conflict", "Run already ended");
  await db.audit.upsert({ where: { id: providerCancelKey(id) }, update: {}, create: { id: providerCancelKey(id), workspaceId, kind: "provider_cancel", actorKey: "user", subjectId: id, details: {} } });
  const queued = await db.run.updateMany({ where: { id, workspaceId, status: "queued" }, data: { status: "cancelled", endedAt: now(), leaseUntil: null } });
  if (queued.count) await ports.onRunFinished?.(workspaceId, id);
  else {
    await liveRuns.get(id)?.abort();
    await createRuns(ports, workspaceId).finish(id, { outcome: "failed", sessionId: null, error: "Cancelled by owner" });
  }
  // If finalization committed first, its unique child edge is now visible. If the cancel
  // marker committed first, finalization observes it and creates no automatic retry.
  const edges = await db.audit.findMany({ where: { workspaceId, kind: "run_continuation", subjectId: id }, take: 4 });
  for (const edge of edges) {
    const next = continuation.safeParse(edge.details);
    if (next.success) await cancelAttempt(ports, workspaceId, next.data.runId, true, seen);
  }
  return { ok: true };
}
