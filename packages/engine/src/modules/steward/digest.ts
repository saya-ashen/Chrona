import { decidePermission } from "@chrona/domain/steward/permission";
import { delegationView, type Context } from "./mappers";

/** One durable outbox entry per delegation/local day; delivery retains authority. */
export async function raiseDigests(ctx: Context) {
  const workspaceId = ctx.actor.workspaceId, now = ctx.now();
  const rows = await ctx.db.delegation.findMany({ where: { workspaceId, status: "active" } });
  for (const row of rows) {
    const delegation = delegationView(row);
    if (delegation.notification.mode !== "digest" || decidePermission({ action: "notify_user", delegation, now }).outcome !== "allowed") continue;
    let day: string;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: delegation.notification.quietHours?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
      day = ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
    } catch { continue; } // Invalid timezone cannot authorize a digest.
    const prefix = `digest:${row.id}:`, idempotencyKey = `${prefix}${day}`;
    await ctx.db.$transaction(async tx => {
      if (await tx.stewardNotification.findUnique({ where: { idempotencyKey } })) return;
      const last = await tx.stewardNotification.findFirst({ where: { workspaceId, delegationId: row.id, idempotencyKey: { startsWith: prefix } }, orderBy: { generatedAt: "desc" } });
      const where = { workspaceId, delegationId: row.id, kind: "change", status: "open", createdAt: { ...(last ? { gt: last.generatedAt } : {}), lte: now } };
      const count = await tx.attentionItem.count({ where });
      if (!count) return;
      const items = await tx.attentionItem.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10, select: { title: true } });
      await tx.stewardNotification.upsert({ where: { idempotencyKey }, update: {}, create: {
        workspaceId, delegationId: row.id, attentionItemId: null, idempotencyKey,
        status: "queued", channel: delegation.notification.channel, title: `${count} updates`,
        body: items.map(item => item.title).join("\n").slice(0, 2000), link: null, generatedAt: now,
      } });
    });
  }
}
