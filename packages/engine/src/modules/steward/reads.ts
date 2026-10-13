import { attentionDecisionSchema, type AttentionStatus, type TodayView, type StewardHealth } from "@chrona/contracts/steward";
import { attentionView, audit, StewardError, type Context } from "./mappers";
export async function health(ctx: Context): Promise<StewardHealth> {
  const workspaceId = ctx.actor.workspaceId, state = await ctx.db.stewardState.findUnique({ where: { workspaceId } });
  const oldest = await ctx.db.inboundEvent.findFirst({ where: { workspaceId, status: "pending" }, orderBy: { receivedAt: "asc" } });
  return { assessor: { available: state?.assessorAvailable ?? false, name: state?.assessorName ?? ctx.assessor.name, lastError: state?.assessorLastError ?? null }, pendingEvents: await ctx.db.inboundEvent.count({ where: { workspaceId, status: "pending" } }), failedEvents: await ctx.db.inboundEvent.count({ where: { workspaceId, status: "failed" } }), oldestPendingAt: oldest?.receivedAt.toISOString() ?? null, queuedNotifications: await ctx.db.stewardNotification.count({ where: { workspaceId, status: "queued" } }), failedNotifications: await ctx.db.stewardNotification.count({ where: { workspaceId, status: { in: ["failed", "uncertain"] } } }), failingConnections: await ctx.db.sourceConnection.count({ where: { workspaceId, status: "failing" } }), lastTickAt: state?.lastTickAt?.toISOString() ?? null };
}
export async function listAttention(ctx: Context, status?: AttentionStatus) {
  const rows = await ctx.db.attentionItem.findMany({ where: { workspaceId: ctx.actor.workspaceId, ...(status === "open" ? { OR: [{ status: "open" }, { status: "snoozed", snoozedUntil: { lte: ctx.now() } }] } : status ? { status } : {}) }, include: { affair: true }, orderBy: { createdAt: "desc" } });
  return rows.map(row => attentionView(row.status === "snoozed" && row.snoozedUntil && row.snoozedUntil <= ctx.now() ? { ...row, status: "open" } : row));
}
export async function decideAttention(ctx: Context, id: string, raw: unknown) {
  const input = attentionDecisionSchema.parse(raw), now = ctx.now();
  if (input.decision === "snooze" && (!input.snoozeUntil || new Date(input.snoozeUntil) <= now)) throw new RangeError("Future snoozeUntil required");
  return ctx.db.$transaction(async tx => {
    const row = await tx.attentionItem.findFirst({ where: { id, workspaceId: ctx.actor.workspaceId } });
    if (!row) throw new StewardError("NOT_FOUND", "Attention item not found");
    const status = input.decision === "snooze" ? "snoozed" : ["dismiss", "less_often"].includes(input.decision) ? "dismissed" : "resolved";
    const updated = await tx.attentionItem.update({ where: { id }, data: { status, decision: input.decision, decidedAt: now, snoozedUntil: input.decision === "snooze" ? new Date(input.snoozeUntil!) : null, ...(input.decision === "less_often" ? { cooldownUntil: new Date(now.getTime() + 7 * 86400_000) } : {}) }, include: { affair: true } });
    if (input.decision === "less_often") {
      const family = row.dedupeKey.slice(0, row.dedupeKey.lastIndexOf(":") + 1);
      await tx.attentionItem.updateMany({ where: { workspaceId: ctx.actor.workspaceId, dedupeKey: { startsWith: family || row.dedupeKey } }, data: { cooldownUntil: new Date(now.getTime() + 7 * 86400_000) } });
    }
    await audit(tx, ctx, "attention_decision", id, input); return attentionView(updated);
  });
}
export async function today(ctx: Context): Promise<TodayView> {
  const items = await listAttention(ctx, "open");
  const follows = await ctx.db.followUp.findMany({ where: { workspaceId: ctx.actor.workspaceId, status: "pending" }, orderBy: { dueAt: "asc" }, take: 50 });
  return { generatedAt: ctx.now().toISOString(), decisions: items.filter(i => i.kind === "decision"), changes: items.filter(i => i.kind === "change" || i.kind === "failure"), commitments: items.filter(i => i.kind === "commitment"), suggestions: items.filter(i => i.kind === "suggestion"), results: items.filter(i => i.kind === "result"), upcoming: follows.map(f => ({ id: f.id, kind: "follow_up", title: f.note.slice(0, 200), startsAt: f.dueAt.toISOString(), endsAt: null, affairId: f.affairId, sourceRef: f.id, confirmed: true })), health: await health(ctx) };
}
