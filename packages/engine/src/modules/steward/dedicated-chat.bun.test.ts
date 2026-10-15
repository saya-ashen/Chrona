import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { chatIdentitySchema, type DeliveryAdapter, type DeliveryMessage, type StewardChatIdentity } from "@chrona/contracts/steward";
import { managementStewardChatRequestSchema } from "@chrona/contracts/api";
import { createStewardChat, moveChatDestination } from "./chat";
import { createStewardDelivery } from "./delivery";

let directory: string, db: PrismaClient, at: Date;
const OLD = "qqbot:LEGACYOPENID", NEW = "chrona_qq:NEWOPENID", OTHER = "chrona_qq:STRANGER";
const dm = (recipient: string, userText: string, messageId = "m1"): StewardChatIdentity => {
  const [platform, id] = recipient.split(":") as ["qqbot" | "chrona_qq", string];
  return { platform, chatType: "dm", userId: id, chatId: id, messageId, userText, route: platform === "qqbot" ? "chrona_command" : "dedicated_bot" } as StewardChatIdentity;
};
const chat = (allowed: string[]) => createStewardChat({ db, workspaceId: "ws", actorKey: "test", allowedRecipients: new Set(allowed), now: () => at });
const recorder = (channel: string) => { const sent: DeliveryMessage[] = []; return { sent, adapter: { channel, async send(message) { sent.push(message); return { outcome: "accepted", receiptRef: `${channel}:r${sent.length}` }; } } satisfies DeliveryAdapter }; };

beforeEach(async () => {
  directory = mkdtempSync(join(process.cwd(), ".steward-dedicated-test-")); const url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) }); at = new Date("2026-10-15T08:00:00Z");
  await db.workspace.create({ data: { id: "ws", name: "Test", status: "Active" } });
});
afterEach(async () => { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("management MCP schemas never accept the dedicated bot's identity namespace", () => {
  expect(chatIdentitySchema.safeParse(dm(NEW, "x")).success).toBe(false);
  expect(managementStewardChatRequestSchema.safeParse({ requestId: crypto.randomUUID(), chat: dm(NEW, "x"), text: "x" }).success).toBe(false);
  expect(chatIdentitySchema.safeParse(dm(OLD, "x")).success).toBe(true);
});

test("a dedicated-bot request binds its work to chrona_qqbot; other namespaces and strangers are refused", async () => {
  const result = await chat([NEW]).request({ requestId: crypto.randomUUID(), chat: dm(NEW, "帮我准备答辩"), text: "帮我准备答辩" });
  const delegation = await db.delegation.findFirstOrThrow({ where: { replyRef: result.ref } });
  expect(delegation.notification).toMatchObject({ channel: "chrona_qqbot", recipient: NEW });
  // Same openid string under the legacy namespace is a different identity.
  await expect(chat([NEW]).request({ requestId: crypto.randomUUID(), chat: dm("qqbot:NEWOPENID", "x"), text: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(chat([NEW]).pending({ chat: dm(OTHER, "进度") })).rejects.toMatchObject({ code: "FORBIDDEN" });
  // A ref of the owner's work cannot be driven from another bound chat.
  const other = await chat([NEW, OTHER]).respond({ requestId: crypto.randomUUID(), chat: dm(OTHER, `${result.ref} 暂停`), ref: result.ref, action: "pause" });
  expect(other).toMatchObject({ status: "not_permitted", reason: "not_bound_to_this_chat" });
  expect((await chat([NEW]).pending({ chat: dm(NEW, "进度") })).works).toHaveLength(1);
});

test("cut-over moves legacy delegations and queued notifications once; sent history stays; no double or misdirected send", async () => {
  const legacy = await chat([OLD]).request({ requestId: crypto.randomUUID(), chat: dm(OLD, "/chrona 关注服务"), text: "关注服务" });
  const delegation = await db.delegation.findFirstOrThrow({ where: { replyRef: legacy.ref } });
  const unrelated = await db.delegation.create({ data: { workspaceId: "ws", purpose: "web", status: "active", allowedActions: ["notify_user"], notification: { mode: "immediate", cooldownMinutes: 0, quietHours: null, channel: "in_app", recipient: null } } });
  const base = { workspaceId: "ws", delegationId: delegation.id, title: "t", body: "b" };
  await db.stewardNotification.createMany({ data: [
    { ...base, id: "queued", idempotencyKey: "k1", channel: "hermes_qqbot", status: "queued" },
    { ...base, id: "sent", idempotencyKey: "k2", channel: "hermes_qqbot", status: "sent", recipient: OLD, receiptRef: "qqbot:x" },
    { ...base, id: "uncertain", idempotencyKey: "k3", channel: "hermes_qqbot", status: "uncertain", recipient: OLD },
  ] });

  expect(await moveChatDestination({ db, workspaceId: "ws", from: OLD, to: NEW, actorKey: "test", now: () => at })).toEqual({ delegations: 1, queuedNotifications: 1 });
  expect(await moveChatDestination({ db, workspaceId: "ws", from: OLD, to: NEW, actorKey: "test", now: () => at })).toEqual({ delegations: 0, queuedNotifications: 0 });
  const moved = await db.delegation.findUniqueOrThrow({ where: { id: delegation.id } });
  expect(moved).toMatchObject({ revision: delegation.revision, replyRef: legacy.ref, notification: expect.objectContaining({ channel: "chrona_qqbot", recipient: NEW }) });
  expect((await db.delegation.findUniqueOrThrow({ where: { id: unrelated.id } })).notification).toMatchObject({ channel: "in_app" });
  expect(await db.stewardNotification.findMany({ orderBy: { id: "asc" }, select: { id: true, channel: true, status: true, recipient: true } })).toEqual([
    { id: "queued", channel: "chrona_qqbot", status: "queued", recipient: null },
    { id: "sent", channel: "hermes_qqbot", status: "sent", recipient: OLD },
    { id: "uncertain", channel: "hermes_qqbot", status: "uncertain", recipient: OLD },
  ]);

  // Even with the legacy adapter and allowlist still present, only the new channel sends, once.
  const hermes = recorder("hermes_qqbot"), own = recorder("chrona_qqbot");
  const deliver = () => createStewardDelivery({ db, workspaceId: "ws", adapters: { hermes_qqbot: hermes.adapter, chrona_qqbot: own.adapter }, allowedRecipients: new Set([OLD, NEW]), now: () => at }).deliverDue();
  await deliver(); at = new Date(at.getTime() + 3600_000); await deliver();
  expect(hermes.sent).toHaveLength(0);
  expect(own.sent.map(m => m.recipient)).toEqual([NEW]);
  expect(await db.stewardNotification.findUniqueOrThrow({ where: { id: "queued" } })).toMatchObject({ status: "sent", recipient: NEW, receiptRef: "chrona_qqbot:r1" });

  // Old refs keep working, now from the new identity only.
  expect(await chat([NEW]).respond({ requestId: crypto.randomUUID(), chat: dm(NEW, `${legacy.ref} 暂停`), ref: legacy.ref, action: "pause" })).toMatchObject({ status: "applied", state: "paused" });
  expect(await chat([OLD, NEW]).respond({ requestId: crypto.randomUUID(), chat: dm(OLD, `/chrona ${legacy.ref} 恢复`), ref: legacy.ref, action: "resume" })).toMatchObject({ status: "not_permitted" });
});

test("a recipient whose namespace does not match the notification channel is never sent", async () => {
  const d = await db.delegation.create({ data: { workspaceId: "ws", purpose: "x", status: "active", allowedActions: ["notify_user"], notification: { mode: "immediate", cooldownMinutes: 0, quietHours: null, channel: "chrona_qqbot", recipient: OLD } } });
  await db.stewardNotification.create({ data: { id: "n", workspaceId: "ws", delegationId: d.id, idempotencyKey: "k", channel: "chrona_qqbot", status: "queued", title: "t", body: "b" } });
  const own = recorder("chrona_qqbot");
  await createStewardDelivery({ db, workspaceId: "ws", adapters: { chrona_qqbot: own.adapter }, allowedRecipients: new Set([OLD, NEW]), now: () => at }).deliverDue();
  expect(own.sent).toHaveLength(0);
  expect(await db.stewardNotification.findUniqueOrThrow({ where: { id: "n" } })).toMatchObject({ status: "suppressed", lastError: "Chat recipient is not authorized." });
});
