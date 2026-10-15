import { createHash } from "node:crypto";
import { CHAT_ACTIONS, CHAT_CHANNEL_BY_PLATFORM, CHAT_PLATFORMS, WORK_LIMITS, notificationPolicySchema, type StewardChatIdentity as ChatIdentity, type DelegationStatus } from "@chrona/contracts/steward";
import type { ManagementStewardChatPropose, ManagementStewardChatRespond, ManagementStewardChatRequest } from "@chrona/contracts/api";
import type { PrismaClient, Prisma } from "@chrona/db/generated/prisma/client";
import { refInText, actionMatchesText } from "@chrona/domain/steward/chat";
import { nextDelegationStatus } from "@chrona/domain/steward/permission";
import { DISMISS_COOLDOWN_MS, LESS_OFTEN_COOLDOWN_MS } from "@chrona/domain/steward/suggestions";
import { json, StewardError } from "./mappers";
import { createStewardWork } from "./work";
import { createDelegationProposal } from "./refs";
export { ensureRef } from "./refs";
type Tx = Prisma.TransactionClient;
/** Management inputs carry a Hermes identity; the in-process bot supplies its own. */
type WithChat<T> = Omit<T, "chat"> & { chat: ChatIdentity };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** The channel a "<platform>:<chat id>" recipient belongs to; null for anything else. */
export function chatChannelOf(recipient: string) {
  const platform = recipient.slice(0, recipient.indexOf(":"));
  return (CHAT_PLATFORMS as readonly string[]).includes(platform) ? CHAT_CHANNEL_BY_PLATFORM[platform as keyof typeof CHAT_CHANNEL_BY_PLATFORM] : null;
}
export function createStewardChat({ db, workspaceId, actorKey, allowedRecipients, now = () => new Date() }: { db: PrismaClient; workspaceId: string; actorKey: string; allowedRecipients: ReadonlySet<string>; now?: () => Date }) {
  async function identity(chat: ChatIdentity) {
    const recipient = `${chat.platform}:${chat.chatId}`;
    if (chat.userId !== chat.chatId || !allowedRecipients.has(recipient)) {
      await db.stewardAudit.create({ data: { workspaceId, actorKey, kind: "chat.denied", subjectId: workspaceId, details: { platform: chat.platform, recipientHash: hash(recipient), managementClientId: actorKey, messageId: chat.messageId, userTextSha256: hash(chat.userText) }, createdAt: now() } });
      throw new StewardError("FORBIDDEN", "Chat identity is not authorized for this workspace");
    }
    return recipient;
  }
  async function audit(tx: Tx, chat: ChatIdentity, kind: string, subjectId: string, details: unknown) {
    await tx.stewardAudit.create({ data: { workspaceId, actorKey: `chat:${chat.platform}:${chat.chatId}`, kind, subjectId, details: json({ managementClientId: actorKey, messageId: chat.messageId, userTextSha256: hash(chat.userText), ...details as object }), createdAt: now() } });
  }
  function bound(notification: unknown, recipient: string) { const p = notificationPolicySchema.safeParse(notification); return p.success && p.data.channel === chatChannelOf(recipient) && p.data.recipient === recipient; }
  async function pendingIn(tx: Tx, recipient: string) {
    const all = await tx.delegation.findMany({ where: { workspaceId }, include: { work: { select: { id: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const bindings = all.filter(d => bound(d.notification, recipient));
    // Proposal decisions are answered through the delegation's own ref, listed below.
    const rows = await tx.attentionItem.findMany({ where: { workspaceId, delegationId: { in: bindings.map(d => d.id) }, NOT: { dedupeKey: { startsWith: "delegation-proposal:" } }, OR: [{ status: "open" }, { status: "snoozed", snoozedUntil: { lte: now() } }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 });
    const items = rows.map(row => ({ ref: row.replyRef, kind: row.kind, title: row.title, nextStep: row.nextStep, createdAt: row.createdAt.toISOString() }));
    const delegations = bindings.filter(d => !d.work && ["proposed", "active", "paused"].includes(d.status)).slice(0, 10).map(d => ({ ref: d.replyRef, status: d.status, purpose: d.purpose.slice(0, 200), lastSuccessAt: d.lastSuccessAt?.toISOString() ?? null }));
    const works = (await tx.stewardWork.findMany({ where: { workspaceId, delegationId: { in: bindings.map(d => d.id) }, status: { notIn: ["accepted", "cancelled", "failed"] } }, orderBy: { updatedAt: "desc" }, take: 10 })).map(w => ({ ref: bindings.find(d => d.id === w.delegationId)?.replyRef ?? null, status: w.status, request: w.request.slice(0, 80) }));
    return { items, delegations, works };
  }
  return {
    authorize: identity,
    async request(input: WithChat<ManagementStewardChatRequest>) {
      const recipient = await identity(input.chat);
      const result = await createStewardWork({ db, now, allowedRecipients, workspaceId }).create({ workspaceId, text: input.text, chat: { identity: input.chat, recipient } });
      return { status: "received" as const, ref: result.ref, affairId: result.affairId, nextStep: "处理中；需要你补充或有成果时会在这里告诉你。" };
    },
    async pending({ chat }: { chat: ChatIdentity }) { const recipient = await identity(chat); return db.$transaction(tx => pendingIn(tx, recipient)); },
    async propose(input: WithChat<ManagementStewardChatPropose>) {
      const recipient = await identity(input.chat);
      return db.$transaction(async tx => {
        const connections = await tx.sourceConnection.findMany({ where: { workspaceId, kind: input.connectionKind, status: { in: ["active", "failing"] } }, take: 2 });
        if (connections.length !== 1) return { status: "needs_clarification", reason: connections.length ? "multiple_sources" : "source_not_connected", message: "请在 Chrona 中确认唯一的已连接来源。" };
        const connection = connections[0]!;
        let affairId = input.affairId;
        if (affairId && !await tx.affair.findFirst({ where: { id: affairId, workspaceId } })) throw new StewardError("NOT_FOUND", "Affair not found");
        if (input.newAffairTitle) affairId = (await tx.affair.create({ data: { workspaceId, title: input.newAffairTitle } })).id;
        const { maxNotificationsPerDay, ...notification } = input.notification;
        const { delegation, ref, nextStep } = await createDelegationProposal(tx, { workspaceId, affairId, connectionId: connection.id, purpose: input.purpose, originalWording: input.chat.userText.trim(), cadenceSeconds: input.cadenceSeconds ?? 900, allowedActions: input.allowedActions, notification: { ...notification, channel: CHAT_CHANNEL_BY_PLATFORM[input.chat.platform], recipient }, limits: { maxEventsPerCheck: 50, maxNotificationsPerDay } }, "来自聊天的新长期委托，确认前不会检查或通知。", [{ label: "聊天原话", excerpt: input.chat.userText.slice(0, 1000) }], now());
        await audit(tx, input.chat, "chat.delegation_proposed", delegation.id, { ref });
        return { status: "proposed", ref, delegationId: delegation.id, summary: { purpose: input.purpose, source: connection.label, cadenceMinutes: delegation.cadenceSeconds! / 60, notify: notification.mode, quietHours: notification.quietHours, maxNotificationsPerDay, allowedActions: input.allowedActions }, permissionsGranted: false, nextStep };
      });
    },
    async respond(input: WithChat<ManagementStewardChatRespond>) {
      const recipient = await identity(input.chat), { ref, action, chat } = input;
      return db.$transaction(async tx => {
        // Acquire the writer lock before reading state for a revision transition.
        await tx.delegation.updateMany({ where: { workspaceId, replyRef: ref }, data: { replyRef: ref } });
        const item = await tx.attentionItem.findFirst({ where: { workspaceId, replyRef: ref } });
        const delegation = await tx.delegation.findFirst({ where: { workspaceId, ...(item ? { id: item.delegationId ?? "" } : { replyRef: ref }) } });
        if (!item && !delegation) return { status: "needs_clarification", reason: "unknown_ref", candidates: (await pendingIn(tx, recipient)).items.slice(0, 5) };
        if (!delegation || !bound(delegation.notification, recipient)) { await audit(tx, chat, "chat.denied", item?.id ?? delegation!.id, { ref, reason: "not_bound_to_this_chat" }); return { status: "not_permitted", reason: "not_bound_to_this_chat" }; }
        if (!refInText(chat.userText, ref)) return { status: "needs_clarification", reason: "ref_not_in_message", validActions: CHAT_ACTIONS };
        if (!actionMatchesText(action, chat.userText)) return { status: "needs_clarification", reason: "action_not_in_message", validActions: CHAT_ACTIONS };
        const work = await tx.stewardWork.findFirst({ where: { workspaceId, delegationId: delegation.id } });
        if (work && item?.kind !== "suggestion" && !["pause", "resume", "revoke", "ack"].includes(action)) {
          if (["revoked", "expired"].includes(delegation.status) || (delegation.expiresAt && delegation.expiresAt <= now()) || work.status === "cancelled") return { status: "conflict", current: work.status };
          if (item && (!["open", "snoozed"].includes(item.status) || (item.delegationRevision !== null && item.delegationRevision !== delegation.revision))) return { status: "conflict", current: item.status };
          const authorization = item?.kind === "decision" && item.dedupeKey.startsWith(`work:${work.id}:authorization:`);
          const resultItem = item?.kind === "result" && item.dedupeKey.startsWith(`work:${work.id}:result:`);
          const at = now();
          if (action === "feedback" || (action === "confirm" && authorization)) {
            if (action === "feedback" && !input.note) return { status: "needs_clarification", reason: "note_required", validActions: CHAT_ACTIONS };
            const text = action === "feedback" ? input.note! : `用户已同意：${item!.title}`.slice(0, 1000);
            if (["accepted", "result_ready", "waiting_input", "waiting_authorization"].includes(work.status)) await tx.stewardAudit.create({ data: { workspaceId, subjectId: work.id, actorKey, kind: "work.resting", details: { status: work.status }, createdAt: at } });
            await tx.stewardWork.update({ where: { id: work.id, workspaceId }, data: { inputs: json([...(Array.isArray(work.inputs) ? work.inputs : []), { at: at.toISOString(), kind: action === "confirm" ? "decision" : work.status === "waiting_input" ? "answer" : "feedback", text }].slice(-WORK_LIMITS.maxInputs)), revision: { increment: 1 }, status: "received", nextRunAt: at, wakeReason: "user_input" } });
            await tx.attentionItem.updateMany({ where: { workspaceId, delegationId: delegation.id, status: { in: ["open", "snoozed"] }, dedupeKey: { startsWith: `work:${work.id}:ask:` } }, data: { status: "resolved", decidedAt: at } });
            if (authorization) await tx.attentionItem.update({ where: { id: item!.id }, data: { status: "resolved", decision: "approve", decidedAt: at } });
          } else if (action === "decline" && authorization) {
            await tx.attentionItem.update({ where: { id: item!.id }, data: { status: "dismissed", decision: "decline", decidedAt: at } });
            await tx.stewardWork.update({ where: { id: work.id }, data: { status: "waiting_authorization", nextRunAt: null } });
          } else if (action === "done" && resultItem) {
            await tx.attentionItem.update({ where: { id: item!.id }, data: { status: "resolved", decision: "done", decidedAt: at } });
            await tx.stewardWork.update({ where: { id: work.id }, data: { status: "accepted", nextRunAt: null } });
          } else return { status: "conflict", current: work.status };
          const state = action === "decline" ? "waiting_authorization" : action === "done" ? "accepted" : "received";
          await audit(tx, chat, "chat.respond", work.id, { ref, action, before: work.status, after: state });
          return { status: "applied", ref, action, subject: { type: "work", id: work.id, title: delegation.purpose }, state };
        }
        const proposalItem = item?.kind === "decision" && item.dedupeKey.startsWith(`delegation-proposal:${delegation.id}:`);
        const delegationAction = !item || ["pause", "resume", "revoke"].includes(action) || (proposalItem && ["confirm", "decline"].includes(action));
        const subject = { type: delegationAction ? "delegation" : "attention", id: delegationAction ? delegation.id : item!.id, title: delegationAction ? delegation.purpose : item!.title };
        const before = delegationAction ? delegation.status : item!.status;
        let state: string;
        if (delegationAction) {
          const transition = action === "confirm" ? "grant" : action === "decline" ? "revoke" : action;
          if ((action === "confirm" && delegation.status === "active") || (action === "pause" && delegation.status === "paused") || (action === "resume" && delegation.status === "active") || (["revoke", "decline"].includes(action) && delegation.status === "revoked")) return { status: "unchanged", current: delegation.status };
          if (!["grant", "pause", "resume", "revoke"].includes(transition) || (action === "decline" && delegation.status !== "proposed")) return { status: "conflict", current: delegation.status };
          const decision = await tx.attentionItem.findFirst({ where: { workspaceId, delegationId: delegation.id, dedupeKey: `delegation-proposal:${delegation.id}:r${delegation.revision}`, kind: "decision", status: "open" } });
          if (action === "confirm" && (!decision || decision.delegationRevision !== delegation.revision || (proposalItem && item!.delegationRevision !== delegation.revision))) return { status: "conflict", current: delegation.status };
          try { state = nextDelegationStatus(delegation.status as DelegationStatus, transition as "grant" | "pause" | "resume" | "revoke"); } catch { return { status: "conflict", current: delegation.status }; }
          const changed = await tx.delegation.updateMany({ where: { id: delegation.id, revision: delegation.revision }, data: { status: state, revision: { increment: 1 }, ...(transition === "grant" ? { grantedAt: now() } : {}) } });
          if (!changed.count) throw new StewardError("REVISION_CONFLICT", "Delegation revision changed");
          if (work && transition === "revoke") await tx.stewardWork.update({ where: { id: work.id, workspaceId }, data: { status: "cancelled", nextRunAt: null, leaseUntil: null } });
          if (delegation.status === "proposed" && decision) await tx.attentionItem.update({ where: { id: decision.id }, data: { status: transition === "grant" ? "resolved" : "dismissed", decision: transition === "grant" ? "approve" : "decline", decidedAt: now() } });
          await audit(tx, chat, "delegation_transition", delegation.id, { action: transition, status: state, revision: delegation.revision + 1 });
        } else {
          const row = item!, at = now();
          state = row.status;
          if (action === "feedback") {
            if (!input.note) return { status: "needs_clarification", reason: "note_required", validActions: CHAT_ACTIONS };
            if (row.userNote === input.note) return { status: "unchanged", current: row.status };
            await tx.attentionItem.update({ where: { id: row.id }, data: { userNote: input.note } });
            await audit(tx, chat, "chat.feedback", row.id, { note: input.note });
          } else if (action === "ack") {
            const notification = await tx.stewardNotification.findFirst({ where: { workspaceId, attentionItemId: row.id, status: { in: ["sent", "uncertain"] } }, orderBy: [{ generatedAt: "desc" }, { id: "desc" }] });
            if (!notification) return { status: "unchanged", current: row.status };
            await tx.stewardNotification.update({ where: { id: notification.id }, data: { status: "acknowledged", acknowledgedAt: at, nextAttemptAt: null } });
            await audit(tx, chat, "notification.acknowledged", notification.id, { attentionItemId: row.id });
          } else {
            if (["confirm", "decline"].includes(action) && row.kind !== "decision") return { status: "conflict", current: row.status };
            const decision = action === "confirm" ? "approve" : action;
            state = decision === "snooze" ? "snoozed" : ["dismiss", "less_often"].includes(decision) ? "dismissed" : "resolved";
            if (row.decision === decision && row.status === state) return { status: "unchanged", current: state };
            const cooldownMs = decision === "less_often" ? (row.kind === "suggestion" ? LESS_OFTEN_COOLDOWN_MS : 7 * 86400_000) : row.kind === "suggestion" && ["dismiss", "decline"].includes(decision) ? DISMISS_COOLDOWN_MS : null;
            await tx.attentionItem.update({ where: { id: row.id }, data: { status: state, decision, decidedAt: at, snoozedUntil: decision === "snooze" ? new Date(at.getTime() + (input.snoozeHours ?? 4) * 3600_000) : null, ...(cooldownMs !== null ? { cooldownUntil: new Date(at.getTime() + cooldownMs) } : {}) } });
            if (decision === "approve" && row.dueAt && !await tx.followUp.findFirst({ where: { workspaceId, attentionItemId: row.id } })) await tx.followUp.upsert({ where: { id: `attention:${row.id}` }, update: {}, create: { id: `attention:${row.id}`, workspaceId, affairId: row.affairId, attentionItemId: row.id, note: row.nextStep || row.title, dueAt: row.dueAt, createdAt: at } });
            if (decision === "less_often") { const family = row.dedupeKey.slice(0, row.dedupeKey.lastIndexOf(":") + 1); await tx.attentionItem.updateMany({ where: { workspaceId, dedupeKey: { startsWith: family || row.dedupeKey } }, data: { cooldownUntil: new Date(at.getTime() + cooldownMs!) } }); }
            await audit(tx, chat, "attention_decision", row.id, { decision });
          }
        }
        await audit(tx, chat, "chat.respond", subject.id, { ref, action, before, after: state });
        return { status: "applied", ref, action, subject, state };
      });
    },
  };
}

/**
 * Move every chat-bound delegation of one recipient to another chat destination (e.g. the
 * legacy Hermes QQ identity → the owner's binding on Chrona's own bot). One transaction,
 * so a notification is claimed either under the old destination or the new one, never
 * both: queued rows follow their delegation, rows already claimed/sent/uncertain keep their
 * historical channel and are never re-sent. Revisions are not bumped (no new authority is
 * granted, and open reply refs stay valid). Idempotent: a second run finds nothing to move.
 */
export async function moveChatDestination({ db, workspaceId, from, to, actorKey, now = () => new Date() }: { db: PrismaClient; workspaceId: string; from: string; to: string; actorKey: string; now?: () => Date }) {
  const fromChannel = chatChannelOf(from), toChannel = chatChannelOf(to);
  if (!fromChannel || !toChannel || from === to) throw new StewardError("INVALID_TRANSITION", "Both destinations must be chat recipients");
  return db.$transaction(async tx => {
    const at = now();
    const all = await tx.delegation.findMany({ where: { workspaceId } });
    const moved: string[] = [];
    for (const d of all) {
      const p = notificationPolicySchema.safeParse(d.notification);
      if (!p.success || p.data.channel !== fromChannel || p.data.recipient !== from) continue;
      await tx.delegation.update({ where: { id: d.id }, data: { notification: json({ ...p.data, channel: toChannel, recipient: to }) } });
      moved.push(d.id);
    }
    const queued = moved.length ? await tx.stewardNotification.updateMany({ where: { workspaceId, delegationId: { in: moved }, channel: fromChannel, status: { in: ["generated", "queued"] } }, data: { channel: toChannel, recipient: null } }) : { count: 0 };
    if (moved.length) await tx.stewardAudit.create({ data: { workspaceId, actorKey, kind: "chat.destination_moved", subjectId: workspaceId, details: { fromChannel, toChannel, fromHash: hash(from), toHash: hash(to), delegations: moved.length, queuedNotifications: queued.count }, createdAt: at } });
    return { delegations: moved.length, queuedNotifications: queued.count };
  });
}
