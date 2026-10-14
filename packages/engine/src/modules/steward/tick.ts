import { syncConnection } from "./ingest";
import { processPendingEvents, type Serialize } from "./process";
import { createStewardDelivery } from "./delivery";
import { createStewardFollowUps } from "./follow-ups";
import { delegationView, type Context } from "./mappers";
import { decidePermission } from "@chrona/domain/steward/permission";
import { raiseDigests } from "./digest";
import { raiseSuggestions } from "./suggest";

function nextCadenceCheck(covering: ReturnType<typeof delegationView>[]) {
  const cadence = covering.filter(d => d.cadenceSeconds !== null)
    .sort((a, b) => a.cadenceSeconds! - b.cadenceSeconds!).at(0);
  return cadence?.lastCheckAt
    ? new Date(cadence.lastCheckAt).getTime() + cadence.cadenceSeconds! * 1000
    : 0;
}

/**
 * Chrona owns polling, assessment retries, follow-ups and delivery retries.
 * Each database phase runs through `serialize`; model calls run between them.
 */
export async function tick(ctx: Context, serialize: Serialize = step => step()) {
  const { synced, syncFailed, limits } = await serialize(() => syncDueConnections(ctx));
  const { assessed } = await processPendingEvents(ctx, { serialize, ...(limits.length ? { limit: Math.min(...limits) } : {}) });
  return serialize(() => afterAssessment(ctx, { synced, syncFailed, assessed }));
}

async function syncDueConnections(ctx: Context) {
  const workspaceId = ctx.actor.workspaceId;
  const now = ctx.now();
  const delegations = (await ctx.db.delegation.findMany({ where: { workspaceId, status: "active" } })).map(delegationView)
    .filter(delegation => decidePermission({ action: "read_source", delegation, now }).outcome === "allowed");
  const connections = await ctx.db.sourceConnection.findMany({ where: {
    workspaceId, status: { in: ["active", "failing"] }, mode: "poll",
  }, orderBy: { id: "asc" } });
  let synced = 0, syncFailed = 0;
  const limits: number[] = [];
  for (const connection of connections) {
    const covering = delegations.filter(d => d.connectionId === null || d.connectionId === connection.id);
    const coverageNote = ctx.sources[connection.kind as keyof typeof ctx.sources].coverageNote;
    if (!covering.length) {
      await ctx.db.sourceConnection.update({ where: { id: connection.id }, data: {
        nextCheckAt: null, coverageNote: `${coverageNote} Automatic polling idle: no active delegation allows read_source.`.slice(0, 500),
      } });
      continue;
    }
    limits.push(...covering.map(d => d.limits.maxEventsPerCheck));
    const cadenceDue = nextCadenceCheck(covering);
    const dueAt = Math.max(connection.nextCheckAt?.getTime() ?? 0, cadenceDue);
    await ctx.db.sourceConnection.update({ where: { id: connection.id }, data: { coverageNote, ...(dueAt > now.getTime() ? { nextCheckAt: new Date(dueAt) } : {}) } });
    if (dueAt > now.getTime()) continue;
    const delegationIds = covering.map(d => d.id);
    await ctx.db.delegation.updateMany({ where: { workspaceId, id: { in: delegationIds } }, data: { lastCheckAt: now } });
    try {
      await syncConnection(ctx, connection.id); synced++;
      await ctx.db.delegation.updateMany({ where: { workspaceId, id: { in: delegationIds } }, data: { lastSuccessAt: now, lastError: null } });
    }
    catch {
      syncFailed++;
      await ctx.db.delegation.updateMany({ where: { workspaceId, id: { in: delegationIds } }, data: { lastFailureAt: now, lastError: "Source sync failed" } });
      // Never store adapter exception text. Refusals caused by pause/revoke do
      // not resurrect the connection; other failures are visible and backed off.
      await ctx.db.sourceConnection.updateMany({ where: { id: connection.id, workspaceId, status: { in: ["active", "failing"] } }, data: {
        status: "failing", lastFailureAt: ctx.now(), lastError: "Source sync failed",
        nextCheckAt: new Date(ctx.now().getTime() + (connection.pollIntervalSeconds ?? 60) * 1000),
      } });
    }
  }
  return { synced, syncFailed, limits };
}

async function afterAssessment(ctx: Context, done: { synced: number; syncFailed: number; assessed: number }) {
  const workspaceId = ctx.actor.workspaceId;
  const { raised } = await createStewardFollowUps({ db: ctx.db, workspaceId, now: ctx.now }).raiseDueFollowUps();
  let suggested = 0, suggestionFailed = 0;
  try { suggested = (await raiseSuggestions(ctx)).raised; }
  catch { suggestionFailed++; }
  await raiseDigests(ctx);
  const { attempted } = await createStewardDelivery({ db: ctx.db, workspaceId, adapters: ctx.deliveryAdapters ?? {}, now: ctx.now }).deliverDue();
  const lastTickAt = ctx.now();
  await ctx.db.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, lastTickAt, assessorName: ctx.assessor.name, assessorAvailable: true }, update: { lastTickAt } });
  return { ...done, raised, suggested, suggestionFailed, attempted, lastTickAt: lastTickAt.toISOString() };
}
