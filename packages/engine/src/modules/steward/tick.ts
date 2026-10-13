import { syncConnection } from "./ingest";
import { processPendingEvents } from "./process";
import { createStewardDelivery } from "./delivery";
import { createStewardFollowUps } from "./follow-ups";
import type { Context } from "./mappers";

/** Chrona owns polling, assessment retries, follow-ups and delivery retries. */
export async function tick(ctx: Context) {
  const workspaceId = ctx.actor.workspaceId;
  const due = await ctx.db.sourceConnection.findMany({ where: {
    workspaceId, status: { in: ["active", "failing"] }, mode: "poll",
    OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: ctx.now() } }],
  }, orderBy: { id: "asc" } });
  let synced = 0, syncFailed = 0;
  for (const connection of due) {
    try { await syncConnection(ctx, connection.id); synced++; }
    catch {
      syncFailed++;
      // Never store adapter exception text. Refusals caused by pause/revoke do
      // not resurrect the connection; other failures are visible and backed off.
      await ctx.db.sourceConnection.updateMany({ where: { id: connection.id, workspaceId, status: { in: ["active", "failing"] } }, data: {
        status: "failing", lastFailureAt: ctx.now(), lastError: "Source sync failed",
        nextCheckAt: new Date(ctx.now().getTime() + (connection.pollIntervalSeconds ?? 60) * 1000),
      } });
    }
  }
  const { assessed } = await processPendingEvents(ctx);
  const { raised } = await createStewardFollowUps({ db: ctx.db, workspaceId, now: ctx.now }).raiseDueFollowUps();
  const { attempted } = await createStewardDelivery({ db: ctx.db, workspaceId, adapters: ctx.deliveryAdapters ?? {}, now: ctx.now }).deliverDue();
  const lastTickAt = ctx.now();
  await ctx.db.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, lastTickAt, assessorName: ctx.assessor.name }, update: { lastTickAt } });
  return { synced, syncFailed, assessed, raised, attempted, lastTickAt: lastTickAt.toISOString() };
}
