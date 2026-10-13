import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createTestDelivery } from "@chrona/integrations/steward";
import type { DeliveryAdapter, NotificationPolicy } from "@chrona/contracts/steward";
import { createStewardDelivery } from "./delivery";

let directory: string, url: string, db: PrismaClient, at: Date;
let sink: ReturnType<typeof createTestDelivery>;
const clients: PrismaClient[] = [];
function connect() { const client = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) }); clients.push(client); return client; }
function service(adapter: DeliveryAdapter & { idempotent?: boolean } = sink.adapter, client = db) { return createStewardDelivery({ db: client, adapters: { local_test: adapter }, now: () => at }); }
async function row(id = "n") { return db.stewardNotification.findUniqueOrThrow({ where: { id } }); }
async function queue(id = "n") { return db.stewardNotification.create({ data: { id, workspaceId: "ws", delegationId: "d", attentionItemId: "a", idempotencyKey: `key:${id}`, channel: "local_test", status: "queued", title: "Test notification", body: "Test data" } }); }
async function policy(notification: Partial<NotificationPolicy>) { await db.delegation.update({ where: { id: "d" }, data: { notification: { mode: "immediate", cooldownMinutes: 0, quietHours: null, channel: "local_test", ...notification } } }); }
beforeEach(async () => {
  directory = mkdtempSync(join(process.cwd(), ".steward-delivery-test-")); url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") }); db = connect();
  at = new Date("2026-10-13T12:00:00Z"); sink = createTestDelivery();
  await db.workspace.create({ data: { id: "ws", name: "Test", status: "Active" } });
  await db.delegation.create({ data: { id: "d", workspaceId: "ws", purpose: "Test", status: "active", allowedActions: ["notify_user"] } });
  await policy({});
  await db.attentionItem.create({ data: { id: "a", workspaceId: "ws", delegationId: "d", dedupeKey: "test", kind: "change", title: "Test", whatHappened: "Test", whyItMatters: "Test", nextStep: "Review" } });
  await queue();
});
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.$disconnect())); rmSync(directory, { recursive: true, force: true }); });

test("transient rejection retries after backoff with unchanged key; accepted != acknowledged", async () => {
  sink.script([{ outcome: "rejected", retryable: true, error: "offline" }, { outcome: "accepted", receiptRef: "receipt" }]);
  const keys: string[] = [];
  const delivery = service({ channel: "local_test", async send(message) { keys.push(message.idempotencyKey); return sink.adapter.send(message); } });
  await delivery.deliverDue({ limit: 10 }); expect(await row()).toMatchObject({ status: "queued", attempts: 1, nextAttemptAt: new Date(at.getTime() + 60_000) });
  await delivery.deliverDue({}); expect(keys).toHaveLength(1);
  at = new Date(at.getTime() + 60_000); await delivery.deliverDue({});
  expect(keys).toEqual(["key:n", "key:n"]); expect(sink.sent).toHaveLength(1);
  expect(await row()).toMatchObject({ status: "sent", acknowledgedAt: null, sentAt: at, receiptRef: "receipt" });
  await delivery.acknowledge("n"); expect((await row()).status).toBe("acknowledged");
  expect((await db.attentionItem.findUniqueOrThrow({ where: { id: "a" } })).status).toBe("open");
});

test("concurrent workers claim only once, including a second database connection", async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>((r) => { release = r; }); const started = new Promise<void>((r) => { entered = r; });
  let calls = 0;
  const adapter: DeliveryAdapter = { channel: "local_test", async send(message) { calls++; entered(); await gate; return sink.adapter.send(message); } };
  const sending = service(adapter).deliverDue({}); await started;
  expect(await row()).toMatchObject({ status: "uncertain", attempts: 1, nextAttemptAt: new Date(at.getTime() + 300_000) });
  await service(adapter, connect()).deliverDue({}); release(); await sending; expect(calls).toBe(1);
});

test("simultaneous due scans use a compare-and-set claim", async () => {
  await Promise.all([service().deliverDue({}), service().deliverDue({})]);
  expect(sink.sent).toHaveLength(1); expect((await row()).attempts).toBe(1);
});

test("restart after committed claim never blindly resends; timeout is durable and visible", async () => {
  // Simulate process exit immediately after the claim commit, before adapter.send.
  await db.stewardNotification.update({ where: { id: "n" }, data: { status: "uncertain", attempts: 1, lastError: "Delivery in progress; outcome unknown until receipt or 5-minute claim timeout.", nextAttemptAt: new Date(at.getTime() + 300_000) } });
  const restarted = service(sink.adapter, connect()); await restarted.deliverDue({}); expect(sink.sent).toHaveLength(0);
  at = new Date(at.getTime() + 300_000); await restarted.deliverDue({});
  expect(await row()).toMatchObject({ status: "uncertain", nextAttemptAt: null }); expect((await row()).lastError).toContain("timed out");
  await restarted.deliverDue({}); expect(sink.sent).toHaveLength(0);
  expect(await db.stewardAudit.count({ where: { kind: "notification.claim_timeout" } })).toBe(1);
});

test("idempotent restart retries same key without duplicating already accepted effect", async () => {
  await sink.adapter.send({ idempotencyKey: "key:n", title: "Test", body: "Test", link: null });
  await db.stewardNotification.update({ where: { id: "n" }, data: { status: "uncertain", attempts: 1, lastError: "Delivery in progress; outcome unknown until receipt or 5-minute claim timeout.", nextAttemptAt: at } });
  await service({ ...sink.adapter, idempotent: true }, connect()).deliverDue({});
  expect((await row()).status).toBe("sent"); expect(sink.sent).toHaveLength(1); expect((await row()).idempotencyKey).toBe("key:n");
});

test.each(["uncertain", "throw"] as const)("%s outcome is not blindly resent", async (outcome) => {
  sink.script([outcome === "throw" ? { outcome, error: new Error("private transport details") } : { outcome, error: "private transport details" }]);
  const delivery = service(); await delivery.deliverDue({}); at = new Date(at.getTime() + 86_400_000); await delivery.deliverDue({});
  expect(await row()).toMatchObject({ status: "uncertain", attempts: 1, nextAttemptAt: null }); expect((await row()).lastError).not.toContain("private");
});

test("declared idempotent adapter retries uncertain with same key", async () => {
  sink.script([{ outcome: "uncertain", error: "timeout" }, { outcome: "accepted" }]);
  const delivery = service({ ...sink.adapter, idempotent: true }); await delivery.deliverDue({});
  at = new Date(at.getTime() + 60_000); await delivery.deliverDue({}); expect((await row()).status).toBe("sent"); expect(sink.sent[0].idempotencyKey).toBe("key:n");
});

test.each(["paused", "revoked"])("%s delegation suppresses queued send with audit", async (status) => {
  await db.delegation.update({ where: { id: "d" }, data: { status } }); await service().deliverDue({});
  expect((await row()).status).toBe("suppressed"); expect(sink.sent).toHaveLength(0); expect(await db.stewardAudit.count({ where: { kind: "notification.suppressed" } })).toBe(1);
});

test("ask-first, silent, and expired policy fail closed", async () => {
  await db.delegation.update({ where: { id: "d" }, data: { askFirstActions: ["notify_user"] } }); await service().deliverDue({}); expect((await row()).status).toBe("suppressed");
  await db.delegation.update({ where: { id: "d" }, data: { askFirstActions: [] } }); await policy({ mode: "silent" }); await queue("silent"); await service().deliverDue({}); expect((await row("silent")).status).toBe("suppressed");
  await policy({}); await db.delegation.update({ where: { id: "d" }, data: { expiresAt: at } }); await queue("expired"); await service().deliverDue({}); expect((await row("expired")).status).toBe("suppressed"); expect(sink.sent).toHaveLength(0);
});

test("quiet hours defer across midnight in policy timezone", async () => {
  at = new Date("2026-10-13T15:00:00Z"); // 23:00 Shanghai
  await policy({ quietHours: { start: "22:00", end: "08:00", timezone: "Asia/Shanghai" } });
  await service().deliverDue({}); expect(await row()).toMatchObject({ status: "queued", attempts: 0, nextAttemptAt: new Date("2026-10-14T00:00:00Z") });
  at = new Date("2026-10-14T00:00:00Z"); await service().deliverDue({}); expect((await row()).status).toBe("sent");
});

test("daily cap defers rather than drops; next day resumes", async () => {
  await db.delegation.update({ where: { id: "d" }, data: { limits: { maxEventsPerCheck: 50, maxNotificationsPerDay: 1 } } });
  await service().deliverDue({}); await queue("second"); await service().deliverDue({});
  expect(await row("second")).toMatchObject({ status: "queued", attempts: 0, nextAttemptAt: new Date("2026-10-14T00:00:00Z") }); expect((await row("second")).lastError).toContain("cap");
  at = new Date("2026-10-14T00:00:00Z"); await service().deliverDue({}); expect(sink.sent).toHaveLength(2);
});

test("daily cap counts existing receipts and a reduced zero cap blocks retries", async () => {
  await queue("previous");
  await db.stewardNotification.update({ where: { id: "previous" }, data: { status: "acknowledged", sentAt: at, acknowledgedAt: at } });
  await db.delegation.update({ where: { id: "d" }, data: { limits: { maxEventsPerCheck: 50, maxNotificationsPerDay: 1 } } });
  await service().deliverDue({}); expect((await row()).status).toBe("queued"); expect(sink.sent).toHaveLength(0);
  at = new Date("2026-10-14T00:00:00Z");
  sink.script([{ outcome: "rejected", retryable: true, error: "offline" }]); await service().deliverDue({});
  await db.delegation.update({ where: { id: "d" }, data: { limits: { maxEventsPerCheck: 50, maxNotificationsPerDay: 0 } } });
  at = new Date(at.getTime() + 60_000); await service().deliverDue({}); expect((await row()).attempts).toBe(1); expect(sink.sent).toHaveLength(0);
});

test("cooldown defers another notification for same attention item", async () => {
  await policy({ cooldownMinutes: 60 }); await service().deliverDue({}); await queue("second"); await service().deliverDue({});
  expect(await row("second")).toMatchObject({ status: "queued", nextAttemptAt: new Date("2026-10-13T13:00:00Z") });
});

test("six retryable failures create exactly one failure attention; explicit retry preserves key", async () => {
  sink.script(Array.from({ length: 12 }, () => ({ outcome: "rejected" as const, retryable: true, error: "offline" })));
  const delivery = service();
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let i = 0; i < 6; i++) {
      await delivery.deliverDue({}); const next = (await row()).nextAttemptAt;
      if (next) { expect(next.getTime() - at.getTime()).toBe([60_000, 300_000, 900_000, 3_600_000, 3_600_000][i]); at = next; }
    }
    expect(await row()).toMatchObject({ status: "failed", attempts: 6, nextAttemptAt: null });
    expect(await db.attentionItem.count({ where: { dedupeKey: "notification:n:failed" } })).toBe(1);
    if (!cycle) { await delivery.retryFailed("n"); expect(await row()).toMatchObject({ status: "queued", idempotencyKey: "key:n" }); }
  }
});

test("permanent rejection fails immediately; queued cannot be acknowledged", async () => {
  await service().acknowledge("n"); expect((await row()).status).toBe("queued");
  sink.script([{ outcome: "rejected", retryable: false, error: "invalid" }]); await service().deliverDue({}); expect(await row()).toMatchObject({ status: "failed", attempts: 1 });
  expect(await db.attentionItem.count({ where: { kind: "failure" } })).toBe(1);
});
