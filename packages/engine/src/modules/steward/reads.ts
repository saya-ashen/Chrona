import { attentionDecisionSchema, type AttentionStatus, type TodayView, type StewardHealth } from "@chrona/contracts/steward";
import { attentionView, audit, StewardError, type Context } from "./mappers";
import { DISMISS_COOLDOWN_MS, LESS_OFTEN_COOLDOWN_MS } from "@chrona/domain/steward/suggestions";

// Repeated-work fact buckets persist the normalized disposition:pattern. The
// domain chooses observation -> delegation, act/await_decision -> tool.
function suggestionProposal(key: string) {
  if (key.split(":")[1] !== "repeated_manual") return null;
  try {
    const pattern: unknown = JSON.parse(decodeURIComponent(key.slice(key.lastIndexOf(":") + 1)));
    if (typeof pattern !== "string") return null;
    const disposition = pattern.split(":")[0];
    if (["retain", "digest", "notify_now"].includes(disposition!)) return "propose_delegation";
    if (["act", "await_decision"].includes(disposition!)) return "propose_tool";
  } catch { /* Unknown keys confer no proposal authority. */ }
  return null;
}
export async function health(ctx: Context): Promise<StewardHealth> {
  const workspaceId = ctx.actor.workspaceId, state = await ctx.db.stewardState.findUnique({ where: { workspaceId } });
  const oldest = await ctx.db.inboundEvent.findFirst({ where: { workspaceId, status: "pending" }, orderBy: { receivedAt: "asc" } });
  return { assessor: { available: state?.assessorAvailable ?? true, name: ctx.assessor.name, lastError: state?.assessorLastError ?? null }, pendingEvents: await ctx.db.inboundEvent.count({ where: { workspaceId, status: "pending" } }), failedEvents: await ctx.db.inboundEvent.count({ where: { workspaceId, status: "failed" } }), oldestPendingAt: oldest?.receivedAt.toISOString() ?? null, queuedNotifications: await ctx.db.stewardNotification.count({ where: { workspaceId, status: "queued" } }), failedNotifications: await ctx.db.stewardNotification.count({ where: { workspaceId, status: { in: ["failed", "uncertain"] } } }), failingConnections: await ctx.db.sourceConnection.count({ where: { workspaceId, status: "failing" } }), lastTickAt: state?.lastTickAt?.toISOString() ?? null };
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
    let delegationId = row.delegationId, nextStep = row.nextStep;
    if (row.kind === "suggestion" && input.decision === "approve") {
      const proposal = suggestionProposal(row.dedupeKey);
      if (proposal === "propose_delegation" && row.affairId && !delegationId) {
        const affair = await tx.affair.findFirst({ where: { id: row.affairId, workspaceId: ctx.actor.workspaceId } });
        if (!affair) throw new StewardError("NOT_FOUND", "Affair not found");
        const delegation = await tx.delegation.create({ data: {
          workspaceId: ctx.actor.workspaceId, affairId: row.affairId, status: "proposed",
          purpose: `${row.title}: ${row.whatHappened}`.slice(0, 4000), originalWording: row.nextStep,
          allowedActions: ["read_source", "summarize"], askFirstActions: ["notify_user"],
        } });
        delegationId = delegation.id;
        nextStep = "Review the proposed delegation. Granting it is a separate explicit step.";
        await audit(tx, ctx, "suggestion_delegation_proposed", delegation.id, { attentionItemId: id });
      } else if (proposal === "propose_tool") {
        nextStep = "Draft the tool from the affair page. Enabling it is a separate explicit step.";
      }
    }
    const cooldownMs = input.decision === "less_often" ? (row.kind === "suggestion" ? LESS_OFTEN_COOLDOWN_MS : 7 * 86400_000)
      : row.kind === "suggestion" && ["dismiss", "decline"].includes(input.decision) ? DISMISS_COOLDOWN_MS : null;
    const updated = await tx.attentionItem.update({ where: { id }, data: { status, delegationId, nextStep, decision: input.decision, decidedAt: now, snoozedUntil: input.decision === "snooze" ? new Date(input.snoozeUntil!) : null, ...(cooldownMs !== null ? { cooldownUntil: new Date(now.getTime() + cooldownMs) } : {}) }, include: { affair: true } });
    if (input.decision === "less_often") {
      const family = row.dedupeKey.slice(0, row.dedupeKey.lastIndexOf(":") + 1);
      await tx.attentionItem.updateMany({ where: { workspaceId: ctx.actor.workspaceId, dedupeKey: { startsWith: family || row.dedupeKey } }, data: { cooldownUntil: new Date(now.getTime() + cooldownMs!) } });
    }
    await audit(tx, ctx, "attention_decision", id, input); return attentionView(updated);
  });
}
export async function today(ctx: Context): Promise<TodayView> {
  const items = await listAttention(ctx, "open");
  const follows = await ctx.db.followUp.findMany({ where: { workspaceId: ctx.actor.workspaceId, status: "pending" }, orderBy: { dueAt: "asc" }, take: 50 });
  return { generatedAt: ctx.now().toISOString(), decisions: items.filter(i => i.kind === "decision"), changes: items.filter(i => i.kind === "change" || i.kind === "failure"), commitments: items.filter(i => i.kind === "commitment"), suggestions: items.filter(i => i.kind === "suggestion"), results: items.filter(i => i.kind === "result"), upcoming: follows.map(f => ({ id: f.id, kind: "follow_up", title: f.note.slice(0, 200), startsAt: f.dueAt.toISOString(), endsAt: null, affairId: f.affairId, sourceRef: f.id, confirmed: true })), health: await health(ctx) };
}
