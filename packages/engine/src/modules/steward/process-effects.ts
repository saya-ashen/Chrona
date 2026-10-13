import type { AssessmentProposal, AttentionKind, PermissionDecision } from "@chrona/contracts/steward";
import type { Prisma, InboundEvent, Delegation, AttentionItem } from "@chrona/db/generated/prisma/client";
import { decidePermission } from "@chrona/domain/steward/permission";
import { delegationView, json } from "./mappers";

type Tx = Prisma.TransactionClient;
export function eventEvidence(event: InboundEvent) {
  return [{
    eventId: event.id, label: event.title.slice(0, 200) || "Source event",
    excerpt: event.body.slice(0, 1000), ...(event.url ? { url: event.url } : {}),
    observedAt: event.receivedAt.toISOString(),
  }];
}
export function confirmedAffair(event: InboundEvent, confirmed: InboundEvent | null) {
  if (event.linkStatus === "confirmed") return event.affairId;
  return event.linkStatus === "rejected" ? null : confirmed?.affairId ?? null;
}
export async function threadAffair(tx: Pick<Tx, "inboundEvent">, event: InboundEvent, workspaceId: string) {
  const confirmed = event.threadId ? await tx.inboundEvent.findFirst({
    where: { workspaceId, connectionId: event.connectionId, threadId: event.threadId, linkStatus: "confirmed", affairId: { not: null } },
    orderBy: { receivedAt: "asc" },
  }) : null;
  return confirmedAffair(event, confirmed);
}
export function assessmentLink(event: InboundEvent, affairId: string | null, guessed: string | null) {
  const linked = affairId ?? (event.linkStatus === "rejected" ? null : guessed);
  const linkStatus = event.linkStatus === "rejected" ? "rejected" : affairId ? "confirmed" : linked ? "suggested" : "unlinked";
  return { affairId: linked, linkStatus };
}
export async function assessmentAuthority(tx: Tx, event: InboundEvent, affairId: string | null, now: Date) {
  // Suggested links never grant affair-scoped authority.
  const candidates = await tx.delegation.findMany({
    where: { workspaceId: event.workspaceId, status: "active", AND: [
      { OR: [{ connectionId: null }, { connectionId: event.connectionId }] },
      { OR: [{ affairId: null }, ...(affairId ? [{ affairId }] : [])] },
    ] }, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return candidates.find(d => !d.expiresAt || d.expiresAt > now);
}
function assessmentPermissions(proposal: AssessmentProposal, delegation: Delegation | undefined, now: Date) {
  const action = proposal.proposedAction ?? (proposal.disposition === "notify_now" ? "notify_user" : null);
  const authority = delegation ? delegationView(delegation) : null;
  return {
    action,
    permission: action ? decidePermission({ action, delegation: authority, now }) : null,
    notificationPermission: proposal.disposition === "notify_now" ? decidePermission({ action: "notify_user", delegation: authority, now }) : null,
  };
}
type Permissions = ReturnType<typeof assessmentPermissions>;
function attentionKind(proposal: AssessmentProposal, permission: PermissionDecision | null): AttentionKind | null {
  if (proposal.disposition === "digest" || proposal.disposition === "notify_now") return "change";
  if (proposal.disposition === "await_decision") return "decision";
  if (proposal.disposition === "act") {
    if (permission?.outcome === "ask_first") return "decision";
    if (permission?.outcome !== "allowed") return "change";
  }
  return null;
}
function attentionNextStep(proposal: AssessmentProposal, kind: AttentionKind, { permission, action }: Permissions) {
  if (permission?.outcome === "denied") return `Not permitted: ${permission.reason}`;
  if (kind === "decision" && action === "create_follow_up" && proposal.followUp) return `Confirm follow-up: ${proposal.followUp.note}`.slice(0, 2000);
  return proposal.nextStep;
}
type Effects = {
  workspaceId: string; actorKey: string; now: Date; event: InboundEvent;
  proposal: AssessmentProposal; assessorName: string; linked: string | null; delegation: Delegation | undefined;
};
function canNotify(proposal: AssessmentProposal, permissions: Permissions, item: AttentionItem, now: Date) {
  return proposal.disposition === "notify_now" && permissions.permission?.outcome === "allowed" &&
    permissions.notificationPermission?.outcome === "allowed" && item.status === "open" &&
    (!item.cooldownUntil || item.cooldownUntil <= now);
}
async function createAttention(tx: Tx, context: Effects, permissions: Permissions, kind: AttentionKind) {
  const { workspaceId, event, now, linked, delegation, proposal } = context;
  const dedupeKey = `event:${event.id}:${kind}`;
  const cooling = await tx.attentionItem.findFirst({
    where: { workspaceId, dedupeKey: { startsWith: `event:${event.id}:` }, cooldownUntil: { gt: now } },
    orderBy: { cooldownUntil: "desc" },
  });
  const item = await tx.attentionItem.upsert({
    where: { workspaceId_dedupeKey: { workspaceId, dedupeKey } }, update: {}, create: {
      workspaceId, dedupeKey, kind, status: cooling ? "dismissed" : "open", cooldownUntil: cooling?.cooldownUntil,
      affairId: linked, eventId: event.id, delegationId: delegation?.id,
      title: event.title.slice(0, 200) || "Source event", whatHappened: proposal.whatHappened,
      whyItMatters: proposal.whyItMatters, nextStep: attentionNextStep(proposal, kind, permissions),
      evidence: eventEvidence(event), dueAt: proposal.followUp && kind === "decision" ? new Date(proposal.followUp.dueAt) : null,
    },
  });
  if (canNotify(proposal, permissions, item, now)) {
    const notification = delegationView(delegation!).notification;
    await tx.stewardNotification.upsert({
      where: { idempotencyKey: `attention:${item.id}:v1` }, update: {}, create: {
        workspaceId, attentionItemId: item.id, delegationId: delegation!.id,
        idempotencyKey: `attention:${item.id}:v1`, channel: notification.channel, status: "queued",
        title: item.title, body: proposal.whatHappened.slice(0, 2000), link: event.url, generatedAt: now,
      },
    });
  }
  return item.id;
}
async function createAssessedFollowUp(tx: Tx, context: Effects, permissions: Permissions, attentionId: string | null) {
  const { proposal, workspaceId, linked } = context;
  if (proposal.disposition === "act" && permissions.permission?.outcome === "allowed") {
    if (permissions.action === "create_follow_up" && proposal.followUp) await tx.followUp.create({ data: {
      workspaceId, affairId: linked, attentionItemId: attentionId,
      note: proposal.followUp.note, dueAt: new Date(proposal.followUp.dueAt),
    } });
    // link_affair remains suggested until a human confirms; summarize is persisted.
  }
}
export async function recordAssessmentEffects(tx: Tx, context: Effects) {
  const { workspaceId, actorKey, now, event, proposal, assessorName, delegation } = context;
  const permissions = assessmentPermissions(proposal, delegation, now);
  const { action, permission, notificationPermission } = permissions;
  const audit = async (details: PermissionDecision) => tx.stewardAudit.create({ data: {
    workspaceId, actorKey, kind: "permission_decision", subjectId: event.id, details: json(details), createdAt: now,
  } });
  await tx.eventAssessment.create({ data: {
    workspaceId, eventId: event.id, assessor: assessorName, createdAt: now, disposition: proposal.disposition,
    whatHappened: proposal.whatHappened, whyItMatters: proposal.whyItMatters, nextStep: proposal.nextStep,
    proposedAction: action, ...(permission ? { permission: json(permission) } : {}),
  } });
  if (permission) await audit(permission);
  if (notificationPermission && action !== "notify_user") await audit(notificationPermission);
  const kind = attentionKind(proposal, permission);
  const attentionId = kind ? await createAttention(tx, context, permissions, kind) : null;
  await createAssessedFollowUp(tx, context, permissions, attentionId);
}
