import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { managementStewardChatProposeSchema, managementStewardChatRespondSchema } from "@chrona/contracts/api";
import { createStewardChat, ensureRef } from "./chat";
import { transitionDelegation } from "./delegations";
import { applyAssessment } from "./process";
import { createStewardDelivery } from "./delivery";
import type { Context } from "./mappers";
let directory: string, db: PrismaClient;
const at = new Date("2026-10-13T12:00:00Z"), allowedRecipients = new Set(["qqbot:TEST"]);
const chat = { route: "chrona_command" as const, platform: "qqbot" as const, chatType: "dm" as const, userId: "TEST", chatId: "TEST", messageId: "m", userText: "请持续检查" };
const service = () => createStewardChat({ db, workspaceId: "ws", actorKey: "client", allowedRecipients, now: () => at });
const propose = () => service().propose(managementStewardChatProposeSchema.parse({ requestId: crypto.randomUUID(), chat, purpose: "Watch changes", connectionKind: "local_test" }));
const respond = (ref: string, action: string, text = `${action} ${ref}`, extra = {}) => service().respond(managementStewardChatRespondSchema.parse({ requestId: crypto.randomUUID(), chat: { ...chat, userText: text }, ref, action, ...extra }));
async function proposed() { const p = await propose(); if (p.status !== "proposed" || !p.ref || !p.delegationId) throw new Error("Proposal failed"); return { ref: p.ref, id: p.delegationId }; }
const delegation = (id: string) => db.delegation.findUniqueOrThrow({ where: { id } });
async function attention(id: string) { const item = await db.attentionItem.create({ data: { workspaceId: "ws", delegationId: id, dedupeKey: crypto.randomUUID(), kind: "change", title: "Change", whatHappened: "Changed", whyItMatters: "Important", nextStep: "Review" } }); const ref = await db.$transaction(tx => ensureRef(tx, "attentionItem", item.id)); return { ...item, ref }; }
beforeEach(async () => {
  directory = mkdtempSync(join(process.cwd(), ".steward-chat-test-")); const url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") }); db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) });
  await db.workspace.create({ data: { id: "ws", name: "Test", status: "Active" } });
  await db.sourceConnection.create({ data: { workspaceId: "ws", kind: "local_test", label: "Test source", status: "active" } });
});
afterEach(async () => { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
test("proposal has ref and revision-bound decision, but no permission or notification", async () => {
  const result = await propose(); expect(result.nextStep).toBe(`回复「/chrona ${result.ref} 确认」生效，或「/chrona ${result.ref} 取消」。`);
  const p = { id: result.delegationId!, ref: result.ref! }; expect(await delegation(p.id)).toMatchObject({ status: "proposed", revision: 1, grantedAt: null, replyRef: p.ref, originalWording: chat.userText });
  expect(await db.attentionItem.findFirst()).toMatchObject({ delegationRevision: 1, kind: "decision", dedupeKey: `delegation-proposal:${p.id}:r1`, nextStep: result.nextStep }); expect(await db.stewardNotification.count()).toBe(0);
  const missing = await service().propose(managementStewardChatProposeSchema.parse({ requestId: crypto.randomUUID(), chat, purpose: "Watch", connectionKind: "reddit_inbox" })); expect(missing).toMatchObject({ status: "needs_clarification", reason: "source_not_connected" });
});
test("pending preserves null refs and all attention/delegation values without an audit", async () => {
  const d = await db.delegation.create({ data: { workspaceId: "ws", purpose: "Watch", status: "active", notification: { channel: "hermes_qqbot", recipient: "qqbot:TEST" } } });
  await db.attentionItem.create({ data: { workspaceId: "ws", delegationId: d.id, dedupeKey: "unclaimed", kind: "change", title: "Change", whatHappened: "Changed", whyItMatters: "Important", nextStep: "Review" } });
  const snapshot = async () => JSON.stringify({ items: await db.attentionItem.findMany({ orderBy: { id: "asc" } }), delegations: await db.delegation.findMany({ orderBy: { id: "asc" } }) });
  const before = await snapshot(), audits = await db.stewardAudit.count(), pending = await service().pending({ chat });
  expect(pending.items).toHaveLength(1); expect(pending.items[0]!.ref).toBeNull(); expect(pending.delegations).toHaveLength(1); expect(pending.delegations[0]!.ref).toBeNull();
  expect(await snapshot()).toBe(before); expect(await db.stewardAudit.count()).toBe(audits);
});
test("explicit slash command pauses without a domain and ambiguous assent needs clarification", async () => {
  const p = await proposed(); await respond(p.ref, "confirm"); await db.delegation.update({ where: { id: p.id }, data: { replyRef: "K7QM" } });
  expect(await respond("K7QM", "pause", "/chrona K7QM 好")).toMatchObject({ status: "needs_clarification", reason: "action_not_in_message" }); expect((await delegation(p.id)).status).toBe("active");
  expect(await respond("K7QM", "pause", "/chrona K7QM 暂停")).toMatchObject({ status: "applied", state: "paused" }); expect((await delegation(p.id)).status).toBe("paused");
});
test("unauthorized identity fails all methods with privacy-safe audit", async () => {
  const unknown = { ...chat, chatId: "UNKNOWN_ID", userId: "UNKNOWN_ID" };
  await expect(service().pending({ chat: unknown })).rejects.toThrow("not authorized");
  await expect(service().pending({ chat: { ...chat, userId: "OTHER" } })).rejects.toThrow("not authorized");
  const audits = await db.stewardAudit.findMany(); expect(audits).toHaveLength(2); expect(JSON.stringify(audits)).not.toContain("UNKNOWN_ID"); expect(audits[0]!.details).toHaveProperty("recipientHash");
});
test("confirm requires own ref and action; repeats do not bump revision", async () => {
  const p = await proposed();
  expect(await respond(p.ref, "confirm", "确认")).toMatchObject({ reason: "ref_not_in_message" });
  expect(await respond(p.ref, "confirm", `暂停 ${p.ref}`)).toMatchObject({ reason: "action_not_in_message" });
  expect(await respond("2222", "confirm")).toMatchObject({ status: "needs_clarification", reason: "unknown_ref" });
  expect(await respond(p.ref, "confirm", `确认${p.ref}`)).toMatchObject({ status: "applied", state: "active" });
  expect(await delegation(p.id)).toMatchObject({ status: "active", revision: 2, grantedAt: at });
  expect(await db.attentionItem.findFirst()).toMatchObject({ status: "resolved", decision: "approve" });
  expect(await respond(p.ref, "confirm")).toMatchObject({ status: "unchanged", current: "active" }); expect((await delegation(p.id)).revision).toBe(2);
});
test("decision refs grant only their matching proposal revision", async () => {
  const p = await proposed(), decision = await db.attentionItem.findFirstOrThrow({ where: { delegationId: p.id } }), ref = await db.$transaction(tx => ensureRef(tx, "attentionItem", decision.id));
  expect(await respond(ref, "confirm")).toMatchObject({ status: "applied", state: "active" }); expect((await delegation(p.id)).revision).toBe(2);
  expect(await respond(ref, "confirm")).toMatchObject({ status: "unchanged" });
});
test("less_often applies cooldown to its family; generic decision approval creates one follow-up", async () => {
  const p = await proposed(); await respond(p.ref, "confirm"); const first = await attention(p.id), second = await attention(p.id);
  await db.attentionItem.update({ where: { id: first.id }, data: { dedupeKey: "family:1" } }); await db.attentionItem.update({ where: { id: second.id }, data: { dedupeKey: "family:2", kind: "decision", dueAt: new Date(at.getTime() + 86400_000) } });
  expect(await respond(first.ref, "less_often")).toMatchObject({ state: "dismissed" }); expect((await db.attentionItem.findUniqueOrThrow({ where: { id: second.id } })).cooldownUntil).toEqual(new Date(at.getTime() + 7 * 86400_000));
  expect(await respond(second.ref, "confirm")).toMatchObject({ state: "resolved" }); expect(await respond(second.ref, "confirm")).toMatchObject({ status: "unchanged" }); expect(await db.followUp.count()).toBe(1);
});

test("web revoke and stale proposal revision cannot be granted", async () => {
  const p = await proposed();
  await transitionDelegation({ db, actor: { workspaceId: "ws", actorKey: "owner", canWrite: true }, now: () => at } as Context, p.id, { action: "revoke", expectedRevision: 1 });
  expect(await respond(p.ref, "confirm")).toMatchObject({ status: "conflict", current: "revoked" });
  const second = await proposed(); await db.delegation.update({ where: { id: second.id }, data: { revision: 2 } });
  expect(await respond(second.ref, "confirm")).toMatchObject({ status: "conflict" }); expect((await delegation(second.id)).status).toBe("proposed");
});
test("in-app binding denies chat; proposed revoke declines; pending lists a proposal once, by its delegation ref", async () => {
  const p = await proposed(); const pending = await service().pending({ chat }); expect(pending.items).toHaveLength(0); expect(pending.delegations.map(d => d.ref)).toEqual([p.ref]);
  expect(await respond(p.ref, "revoke", `取消 ${p.ref}`)).toMatchObject({ status: "applied", state: "revoked" }); expect((await db.attentionItem.findFirst())!.status).toBe("dismissed");
  await db.delegation.update({ where: { id: p.id }, data: { notification: { channel: "in_app" } } }); expect(await respond(p.ref, "pause")).toMatchObject({ status: "not_permitted", reason: "not_bound_to_this_chat" });
});
test("attention snooze, feedback, ack retain intended independent semantics", async () => {
  const p = await proposed(); await respond(p.ref, "confirm"); const item = await attention(p.id);
  expect(await respond(item.ref, "snooze")).toMatchObject({ status: "applied", state: "snoozed" }); expect((await db.attentionItem.findUniqueOrThrow({ where: { id: item.id } })).snoozedUntil).toEqual(new Date(at.getTime() + 4 * 3600_000));
  expect(await respond(item.ref, "feedback", `说明 ${item.ref}`, { note: "请更简短" })).toMatchObject({ status: "applied" }); expect((await db.attentionItem.findUniqueOrThrow({ where: { id: item.id } })).userNote).toBe("请更简短"); expect(await db.stewardAudit.count({ where: { kind: "chat.feedback" } })).toBe(1);
  await db.attentionItem.update({ where: { id: item.id }, data: { status: "open" } });
  for (const n of [1, 2]) await db.stewardNotification.create({ data: { id: `n${n}`, workspaceId: "ws", delegationId: p.id, attentionItemId: item.id, channel: "hermes_qqbot", idempotencyKey: `n${n}`, title: "Test", body: "Test", status: "sent", generatedAt: new Date(at.getTime() + n) } });
  await respond(item.ref, "ack"); expect((await db.stewardNotification.findUniqueOrThrow({ where: { id: "n2" } })).status).toBe("acknowledged"); expect((await db.stewardNotification.findUniqueOrThrow({ where: { id: "n1" } })).status).toBe("sent"); expect((await db.attentionItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("open");
});
test("assessed notify_now queues chat delivery and enriches the item ref", async () => {
  const p = await proposed(); await respond(p.ref, "confirm");
  const affair = await db.affair.create({ data: { workspaceId: "ws", title: "Test affair" } });
  await db.delegation.update({ where: { id: p.id }, data: { affairId: affair.id } });
  const event = await db.inboundEvent.create({ data: { workspaceId: "ws", connectionId: (await delegation(p.id)).connectionId!, externalId: "test-event", affairId: affair.id, linkStatus: "confirmed", title: "Test change", body: "Test data", author: "Test", occurredAt: at } });
  expect(await applyAssessment({ db, actor: { workspaceId: "ws", actorKey: "test-only", canWrite: true }, now: () => at }, event, { disposition: "notify_now", whatHappened: "Changed", whyItMatters: "Important", nextStep: "Review", proposedAction: "notify_user", affairId: affair.id, followUp: null }, "test-only-assessor")).toBe(true);
  const notification = await db.stewardNotification.findFirstOrThrow(); expect(notification).toMatchObject({ status: "queued", channel: "hermes_qqbot" });
  let sent = false;
  await createStewardDelivery({ db, workspaceId: "ws", allowedRecipients, now: () => at, adapters: { hermes_qqbot: { channel: "hermes_qqbot", async send(message) { sent = true; expect(message).toMatchObject({ recipient: "qqbot:TEST", whyItMatters: "Important", nextStep: "Review", appPath: `/affairs/${affair.id}` }); expect(message.replyRef).toMatch(/^[2-9A-HJKMNP-Z]{4}$/); return { outcome: "accepted", receiptRef: "test-only" }; } } } }).deliverDue();
  expect(sent).toBe(true); expect((await db.stewardNotification.findUniqueOrThrow({ where: { id: notification.id } })).recipient).toBe("qqbot:TEST");
});

test("chat pause suppresses queued send; resume permits a new notification", async () => {
  const p = await proposed(); await respond(p.ref, "confirm"); const item = await attention(p.id);
  const queue = (id: string) => db.stewardNotification.create({ data: { id, workspaceId: "ws", delegationId: p.id, attentionItemId: item.id, channel: "hermes_qqbot", idempotencyKey: id, title: "Test", body: "Test", status: "queued" } });
  let calls = 0; const delivery = createStewardDelivery({ db, workspaceId: "ws", allowedRecipients, now: () => at, adapters: { hermes_qqbot: { channel: "hermes_qqbot", async send(message) { calls++; expect(message).toMatchObject({ recipient: "qqbot:TEST", replyRef: item.ref, whyItMatters: "Important", appPath: "/today" }); return { outcome: "accepted", receiptRef: "test-only" }; } } } });
  await queue("paused"); await respond(p.ref, "pause"); await delivery.deliverDue(); expect(calls).toBe(0); expect((await db.stewardNotification.findUniqueOrThrow({ where: { id: "paused" } })).status).toBe("suppressed");
  await respond(p.ref, "resume"); await queue("resumed"); await delivery.deliverDue(); expect(calls).toBe(1); expect((await db.stewardNotification.findUniqueOrThrow({ where: { id: "resumed" } })).recipient).toBe("qqbot:TEST");
});
