import { createAffairSchema, updateAffairSchema, eventLinkSchema } from "@chrona/contracts/steward";
import { affairView, attentionView, eventView, delegationView, followUpView, toolView, requireAffair, audit, StewardError, type Context } from "./mappers";
export async function createAffair(ctx: Context, raw: unknown) {
  const input = createAffairSchema.parse(raw);
  if (input.taskId && !await ctx.db.task.findFirst({ where: { id: input.taskId, workspaceId: ctx.actor.workspaceId } })) throw new StewardError("NOT_FOUND", "Task not found");
  return affairView(await ctx.db.affair.create({ data: { ...input, workspaceId: ctx.actor.workspaceId } }));
}
export async function updateAffair(ctx: Context, id: string, raw: unknown) {
  const input = updateAffairSchema.parse(raw); await requireAffair(ctx, id);
  if (input.taskId && !await ctx.db.task.findFirst({ where: { id: input.taskId, workspaceId: ctx.actor.workspaceId } })) throw new StewardError("NOT_FOUND", "Task not found");
  return affairView(await ctx.db.affair.update({ where: { id }, data: input }), await ctx.db.attentionItem.count({ where: { affairId: id, status: "open" } }));
}
export async function affairDetail(ctx: Context, id: string) {
  const affair = await requireAffair(ctx, id), where = { workspaceId: ctx.actor.workspaceId, affairId: id };
  const attention = await ctx.db.attentionItem.findMany({ where, include: { affair: true } });
  const events = await ctx.db.inboundEvent.findMany({ where, orderBy: { receivedAt: "desc" } });
  return { affair: affairView(affair, attention.filter(a => a.status === "open").length), attention: attention.map(attentionView), events: events.filter(e => e.linkStatus === "confirmed").map(eventView), suggestedEvents: events.filter(e => e.linkStatus === "suggested").map(eventView), delegations: (await ctx.db.delegation.findMany({ where })).map(delegationView), followUps: (await ctx.db.followUp.findMany({ where })).map(followUpView), tools: (await ctx.db.managedTool.findMany({ where })).map(toolView) };
}
export async function linkEvent(ctx: Context, id: string, raw: unknown) {
  const input = eventLinkSchema.parse(raw);
  return ctx.db.$transaction(async tx => {
    const row = await tx.inboundEvent.findFirst({ where: { id, workspaceId: ctx.actor.workspaceId } });
    if (!row) throw new StewardError("NOT_FOUND", "Event not found");
    const affairId = input.affairId ?? row.affairId;
    if (input.decision === "confirm") { if (!affairId) throw new StewardError("NOT_FOUND", "Affair required"); await requireAffair(ctx, affairId, tx); }
    const updated = await tx.inboundEvent.update({ where: { id }, data: { affairId: input.decision === "confirm" ? affairId : null, linkStatus: input.decision === "confirm" ? "confirmed" : "rejected" } });
    await audit(tx, ctx, "event_link", id, input); return eventView(updated);
  });
}
