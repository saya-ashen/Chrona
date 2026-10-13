import { createConnectionSchema, connectionTransitionSchema, type ConnectionKind } from "@chrona/contracts/steward";
import { audit, connectionView, StewardError, type Context, type Tx } from "./mappers";
export async function connection(ctx: Context, id: string, tx: Tx = ctx.db) {
  const row = await tx.sourceConnection.findFirst({ where: { id, workspaceId: ctx.actor.workspaceId } });
  if (!row) throw new StewardError("NOT_FOUND", "Connection not found"); return row;
}
export async function mappedConnection(ctx: Context, id: string) {
  const row = await connection(ctx, id), where = { workspaceId: ctx.actor.workspaceId, connectionId: id };
  return connectionView(row, await ctx.db.inboundEvent.count({ where: { ...where, status: "pending" } }), await ctx.db.inboundEvent.count({ where: { ...where, status: "failed" } }), row.coverageNote || ctx.sources[row.kind as ConnectionKind].coverageNote);
}
export async function createConnection(ctx: Context, raw: unknown) {
  const input = createConnectionSchema.parse(raw), adapter = ctx.sources[input.kind], id = crypto.randomUUID();
  const readiness = await adapter.readiness({ id, config: {} });
  if (readiness.state === "unsupported") throw new StewardError("SYNC_REFUSED", "Source is unsupported");
  await ctx.db.sourceConnection.create({ data: { ...input, id, workspaceId: ctx.actor.workspaceId, mode: adapter.mode, status: readiness.state === "ready" ? "active" : "needs_authorization", readScopes: ["read_source"], coverageNote: adapter.coverageNote } });
  return mappedConnection(ctx, id);
}
export async function transitionConnection(ctx: Context, id: string, raw: unknown) {
  const { action } = connectionTransitionSchema.parse(raw);
  await ctx.db.$transaction(async tx => {
    const row = await connection(ctx, id, tx);
    let status: string;
    if (action === "revoke" && row.status !== "revoked") status = "revoked";
    else if (action === "pause" && ["active", "failing"].includes(row.status)) status = "paused";
    else if (action === "resume" && row.status === "paused") {
      const ready = await ctx.sources[row.kind as ConnectionKind].readiness({ id, config: row.config });
      status = ready.state === "ready" ? "active" : "needs_authorization";
    } else throw new StewardError("INVALID_TRANSITION", "Invalid connection transition");
    await tx.sourceConnection.update({ where: { id }, data: { status } });
    await audit(tx, ctx, "connection_transition", id, { action, status });
  });
  return mappedConnection(ctx, id);
}
