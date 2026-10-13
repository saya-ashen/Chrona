import { AssessorUnavailableError, assessmentSchema, type AssessmentProposal, type ConnectionKind, type AttentionKind } from "@chrona/contracts/steward";
import { z } from "zod";
const proposalSchema = assessmentSchema.pick({ disposition: true, whatHappened: true, whyItMatters: true, nextStep: true, proposedAction: true }).extend({ affairId: z.string().min(1).max(128).nullable(), followUp: z.object({ note: z.string().min(1).max(4000), dueAt: z.string().datetime({ offset: true }) }).strict().nullable() }).strict();
import { decidePermission } from "@chrona/domain/steward/permission";
import { audit, delegationView, json, type Context } from "./mappers";
export async function processPendingEvents(ctx: Context, { limit = 50 }: { limit?: number } = {}) {
  const workspaceId = ctx.actor.workspaceId, now = ctx.now();
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("limit must be 1..500");
  const events = await ctx.db.inboundEvent.findMany({ where: { workspaceId, status: "pending", connection: { status: { in: ["active", "failing"] } }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: limit, include: { connection: true } });
  let assessed = 0;
  for (const event of events) {
    const confirmed = event.threadId ? await ctx.db.inboundEvent.findFirst({ where: { workspaceId, connectionId: event.connectionId, threadId: event.threadId, linkStatus: "confirmed", affairId: { not: null } }, orderBy: { receivedAt: "asc" } }) : null;
    const affairId = event.linkStatus === "confirmed" ? event.affairId : event.linkStatus === "rejected" ? null : confirmed?.affairId ?? null;
    const affairs = await ctx.db.affair.findMany({ where: { workspaceId } });
    let proposal: AssessmentProposal;
    try {
      proposal = proposalSchema.parse(await ctx.assessor.assess({ event: { id: event.id, externalId: event.externalId, title: event.title, body: event.body, author: event.author, url: event.url, occurredAt: event.occurredAt.toISOString(), threadId: event.threadId ?? undefined, connectionKind: event.connection.kind as ConnectionKind }, affair: affairs.find(a => a.id === affairId) ?? null, candidateAffairs: affairs.map(a => ({ id: a.id, title: a.title, keywords: a.keywords as string[] })) }));
    } catch (error) {
      const unavailable = error instanceof AssessorUnavailableError, attempts = event.attempts + 1;
      await ctx.db.$transaction(async tx => {
        const changed = await tx.inboundEvent.updateMany({ where: { id: event.id, status: "pending", attempts: event.attempts }, data: { attempts, nextAttemptAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 10))), lastError: unavailable ? "Assessor unavailable" : "Assessment failed", status: !unavailable && attempts >= 5 ? "failed" : "pending" } });
        if (!changed.count) return;
        await tx.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, assessorName: ctx.assessor.name, assessorAvailable: !unavailable, assessorLastError: unavailable ? "Assessor unavailable" : "Assessment failed", lastTickAt: now }, update: { assessorName: ctx.assessor.name, assessorAvailable: !unavailable, assessorLastError: unavailable ? "Assessor unavailable" : "Assessment failed", lastTickAt: now } });
        if (!unavailable && attempts >= 5) await tx.attentionItem.upsert({ where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: `event:${event.id}:failure` } }, update: {}, create: { workspaceId, dedupeKey: `event:${event.id}:failure`, eventId: event.id, kind: "failure", title: "Event assessment failed", whatHappened: "Assessment failed after five attempts", whyItMatters: "This event has not been assessed", nextStep: "Review the source event", evidence: [{ eventId: event.id, label: event.title.slice(0, 200) || "Source event", excerpt: event.body.slice(0, 1000), ...(event.url ? { url: event.url } : {}), observedAt: event.receivedAt.toISOString() }] } });
      });
      if (unavailable) break; else continue;
    }
    await ctx.db.$transaction(async tx => {
      // Pause/revoke also wins when it happens while the assessor is running.
      const source = await tx.sourceConnection.findUniqueOrThrow({ where: { id: event.connectionId } });
      if (!["active", "failing"].includes(source.status)) return;
      // Claim and all resulting writes commit together; crash rollback leaves pending.
      const claim = await tx.inboundEvent.updateMany({ where: { id: event.id, status: "pending", attempts: event.attempts }, data: { status: "assessed", nextAttemptAt: null, lastError: null } });
      if (!claim.count) return;
      const guessed = affairs.some(a => a.id === proposal.affairId) ? proposal.affairId : null;
      const linked = affairId ?? (event.linkStatus === "rejected" ? null : guessed);
      await tx.inboundEvent.update({ where: { id: event.id }, data: { affairId: linked, linkStatus: event.linkStatus === "rejected" ? "rejected" : affairId ? "confirmed" : linked ? "suggested" : "unlinked" } });
      // Suggested links never grant affair-scoped authority.
      const candidates = await tx.delegation.findMany({ where: { workspaceId, status: "active", AND: [{ OR: [{ connectionId: null }, { connectionId: event.connectionId }] }, { OR: [{ affairId: null }, ...(affairId ? [{ affairId }] : [])] }] }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
      const delegation = candidates.find(d => !d.expiresAt || d.expiresAt > now);
      const action = proposal.proposedAction ?? (proposal.disposition === "notify_now" ? "notify_user" : null);
      const authority = delegation ? delegationView(delegation) : null;
      const permission = action ? decidePermission({ action, delegation: authority, now }) : null;
      const notificationPermission = proposal.disposition === "notify_now" ? decidePermission({ action: "notify_user", delegation: authority, now }) : null;
      await tx.eventAssessment.create({ data: { workspaceId, eventId: event.id, assessor: ctx.assessor.name, disposition: proposal.disposition, whatHappened: proposal.whatHappened, whyItMatters: proposal.whyItMatters, nextStep: proposal.nextStep, proposedAction: action, ...(permission ? { permission: json(permission) } : {}) } });
      if (permission) await audit(tx, ctx, "permission_decision", event.id, permission);
      if (notificationPermission && action !== "notify_user") await audit(tx, ctx, "permission_decision", event.id, notificationPermission);
      let kind: AttentionKind | null = proposal.disposition === "digest" || proposal.disposition === "notify_now" ? "change" : proposal.disposition === "await_decision" ? "decision" : null;
      if (proposal.disposition === "act") {
        if (permission?.outcome === "ask_first") kind = "decision";
        else if (permission?.outcome !== "allowed") kind = "change";
      }
      let attentionId: string | null = null;
      if (kind) {
        // Dedupe family is event:<id>: (all attention kinds for that event).
        const dedupeKey = `event:${event.id}:${kind}`;
        const cooling = await tx.attentionItem.findFirst({ where: { workspaceId, dedupeKey: { startsWith: `event:${event.id}:` }, cooldownUntil: { gt: now } }, orderBy: { cooldownUntil: "desc" } });
        const item = await tx.attentionItem.upsert({ where: { workspaceId_dedupeKey: { workspaceId, dedupeKey } }, update: {}, create: { workspaceId, dedupeKey, kind, status: cooling ? "dismissed" : "open", cooldownUntil: cooling?.cooldownUntil, affairId: linked, eventId: event.id, delegationId: delegation?.id, title: event.title.slice(0, 200) || "Source event", whatHappened: proposal.whatHappened, whyItMatters: proposal.whyItMatters, nextStep: permission?.outcome === "denied" ? `Not permitted: ${permission.reason}` : kind === "decision" && action === "create_follow_up" && proposal.followUp ? `Confirm follow-up: ${proposal.followUp.note}`.slice(0, 2000) : proposal.nextStep, evidence: [{ eventId: event.id, label: event.title.slice(0, 200) || "Source event", excerpt: event.body.slice(0, 1000), ...(event.url ? { url: event.url } : {}), observedAt: event.receivedAt.toISOString() }], dueAt: proposal.followUp && kind === "decision" ? new Date(proposal.followUp.dueAt) : null } });
        attentionId = item.id;
        if (proposal.disposition === "notify_now" && permission?.outcome === "allowed" && notificationPermission?.outcome === "allowed" && item.status === "open" && (!item.cooldownUntil || item.cooldownUntil <= now)) {
          const notification = delegationView(delegation!).notification;
          await tx.stewardNotification.upsert({ where: { idempotencyKey: `attention:${item.id}:v1` }, update: {}, create: { workspaceId, attentionItemId: item.id, delegationId: delegation!.id, idempotencyKey: `attention:${item.id}:v1`, channel: notification.channel, status: "queued", title: item.title, body: proposal.whatHappened.slice(0, 2000), link: event.url, generatedAt: now } });
        }
      }
      if (proposal.disposition === "act" && permission?.outcome === "allowed") {
        if (action === "create_follow_up" && proposal.followUp) await tx.followUp.create({ data: { workspaceId, affairId: linked, attentionItemId: attentionId, note: proposal.followUp.note, dueAt: new Date(proposal.followUp.dueAt) } });
        // link_affair remains suggested until a human confirms; summarize is the persisted assessment.
      }
      await tx.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, assessorName: ctx.assessor.name, assessorAvailable: true, assessorLastError: null, lastTickAt: now }, update: { assessorName: ctx.assessor.name, assessorAvailable: true, assessorLastError: null, lastTickAt: now } });
      assessed++;
    });
  }
  return { assessed };
}
