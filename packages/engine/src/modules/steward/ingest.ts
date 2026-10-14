import type { ConnectionKind, SourceItem, SyncResult } from "@chrona/contracts/steward";
import { connection } from "./connections";
import { StewardError, type Context } from "./mappers";
function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : null;
}

/** A baseline sync records history without processing it; a still-current condition is processed. */
function initialStatus(baseline: boolean, item: SourceItem) {
  return baseline && !item.current ? "baseline" : "pending";
}

export async function syncConnection(ctx: Context, id: string, retry = 0): Promise<SyncResult> {
  const row = await connection(ctx, id);
  if (!["active", "failing"].includes(row.status)) throw new StewardError("SYNC_REFUSED", `Connection is ${row.status}`);
  let polled;
  try { polled = await ctx.sources[row.kind as ConnectionKind].poll({ id, config: row.config }, row.cursor); }
  catch {
    // Adapter error text may contain credentials; never persist raw transport errors.
    await ctx.db.sourceConnection.updateMany({ where: { id, status: { in: ["active", "failing"] } }, data: { status: "failing", lastFailureAt: ctx.now(), lastError: "Source poll failed" } });
    throw new StewardError("SYNC_REFUSED", "Source poll failed");
  }
  return ctx.db.$transaction(async tx => {
    const fresh = await connection(ctx, id, tx);
    if (!["active", "failing"].includes(fresh.status)) throw new StewardError("SYNC_REFUSED", `Connection is ${fresh.status}`);
    // A different process advanced the cursor while polling: do not overwrite it.
    if (fresh.cursor !== row.cursor || fresh.baselineAt?.getTime() !== row.baselineAt?.getTime()) throw new StewardError("REVISION_CONFLICT", "Connection changed during poll; retry sync");
    const baseline = fresh.baselineAt === null, now = ctx.now(); let received = 0, duplicates = 0;
    for (const item of polled.items) {
      try {
        await tx.inboundEvent.create({ data: { externalId: item.externalId, title: item.title, body: item.body, author: item.author, url: item.url, threadId: item.threadId, workspaceId: ctx.actor.workspaceId, connectionId: id, occurredAt: new Date(item.occurredAt), receivedAt: now, status: initialStatus(baseline, item) } }); received++;
      } catch (error) {
        if (errorCode(error) === "P2002") duplicates++; else throw error;
      }
    }
    await tx.sourceConnection.update({ where: { id }, data: { cursor: polled.nextCursor, baselineAt: fresh.baselineAt ?? now, lastSuccessAt: now, lastError: null, status: "active", nextCheckAt: fresh.pollIntervalSeconds ? new Date(now.getTime() + fresh.pollIntervalSeconds * 1000) : null } });
    return { received, duplicates, baseline };
  }).catch(async (error: unknown) => {
    const code = errorCode(error);
    // SQLite snapshot upgrades can lose a concurrent write race. The transaction
    // has rolled back; poll again from the committed cursor, never reuse stale data.
    if (["REVISION_CONFLICT", "P1008", "P2034"].includes(String(code)) && retry < 3) {
      await new Promise(resolve => setTimeout(resolve, 10 * (retry + 1)));
      return syncConnection(ctx, id, retry + 1);
    }
    throw error;
  });
}
