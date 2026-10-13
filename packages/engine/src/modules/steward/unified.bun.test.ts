import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createLocalTestSource, createRedditInboxSource, createRuleAssessor, createTestDelivery } from "@chrona/integrations/steward";
import { notificationSchema, followUpSchema, scheduleItemSchema } from "@chrona/contracts/steward";
import { createStewardService, type StewardPorts } from "./index";

let db: PrismaClient, directory: string, at: Date, available: boolean;
let source: ReturnType<typeof createLocalTestSource>, sink: ReturnType<typeof createTestDelivery>, ports: StewardPorts;
const service = (workspaceId = "ws", canWrite = true) => createStewardService({ ...ports, authorize: async () => ({ workspaceId, canWrite, actorKey: "test:owner" }) });
const item = (externalId: string, body = "Can you review this?") => ({ externalId, title: externalId, body, author: "test", url: "https://example.invalid/message", occurredAt: at.toISOString() });
beforeEach(async () => {
  const root = resolve("packages/engine/src/modules/steward/.tmp"); mkdirSync(root, { recursive: true });
  directory = mkdtempSync(join(root, "unified-")); const url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) });
  await db.workspace.createMany({ data: ["ws", "other"].map(id => ({ id, name: id, status: "Active" })) });
  at = new Date("2031-01-01T00:00:00Z"); available = true; source = createLocalTestSource(); sink = createTestDelivery();
  ports = { db, now: () => at, sources: { local_test: source.adapter, reddit_inbox: createRedditInboxSource({}) }, assessor: createRuleAssessor({ available: () => available }), deliveryAdapters: { local_test: sink.adapter }, authorize: async () => ({ workspaceId: "ws", actorKey: "test:owner", canWrite: true }) };
});
afterEach(async () => { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
async function setup() {
  const s = service(); source.push([item("baseline")]);
  const connection = await s.connections.create({ kind: "local_test", label: "Local test", pollIntervalSeconds: 60 });
  expect(await s.tick()).toMatchObject({ synced: 1, assessed: 0, attempted: 0 });
  const delegation = await s.delegations.propose({ connectionId: connection.id, purpose: "Watch test messages", cadenceSeconds: 60, allowedActions: ["notify_user"], notification: { mode: "immediate", cooldownMinutes: 0, channel: "local_test", quietHours: null } });
  await s.delegations.transition(delegation.id, { action: "grant", expectedRevision: 1 });
  return { s, connection, delegation };
}

test("tick owns poll/assessment/delivery retries; success does not resolve attention", async () => {
  const { s, connection } = await setup();
  source.push([item("notify")]);
  expect(await s.tick()).toMatchObject({ synced: 0, assessed: 0 });
  sink.script([{ outcome: "rejected", retryable: true, error: "offline" }, { outcome: "accepted" }]);
  at = new Date(at.getTime() + 60_000);
  expect(await s.tick()).toMatchObject({ synced: 1, assessed: 1, attempted: 1 });
  const queued = (await s.notifications.list())[0]; expect(notificationSchema.parse(queued).status).toBe("queued");
  const stored = await db.stewardNotification.findUniqueOrThrow({ where: { id: queued.id } });
  expect(await s.tick()).toMatchObject({ synced: 0, assessed: 0, attempted: 0 });
  at = new Date(at.getTime() + 60_000); await s.tick();
  expect(sink.sent).toHaveLength(1); expect(sink.sent[0].idempotencyKey).toBe(stored.idempotencyKey);
  expect((await s.notifications.list())[0]).toMatchObject({ status: "sent", acknowledgedAt: null });
  expect(await s.attention.list("open")).toHaveLength(1);
  await s.notifications.acknowledge(queued.id); expect(await s.attention.list("open")).toHaveLength(1);
  await s.attention.decide(queued.attentionItemId!, { decision: "done" }); expect(await s.attention.list("open")).toHaveLength(0);
  expect(await s.events.list({ status: "assessed", connectionId: connection.id })).toHaveLength(1);
  expect(await s.events.list({ status: "baseline" })).toHaveLength(1);
  expect(await s.health()).toMatchObject({ lastTickAt: at.toISOString(), assessor: { name: "rule-assessor-v1", available: true } });
});

test("all added reads, writes and tick are workspace scoped and authorize writes", async () => {
  const { s } = await setup(); source.push([item("notify")]);
  at = new Date(at.getTime() + 60_000); await s.tick();
  const notification = (await s.notifications.list())[0];
  await db.followUp.create({ data: { id: "follow", workspaceId: "ws", note: "Check again", dueAt: at } });
  await db.managedTool.create({ data: { workspaceId: "ws", kind: "script", name: "Test script", purpose: "Test", handlingMode: "script", selectionRationale: "Stable rule" } });
  const other = service("other");
  expect(await other.notifications.list()).toEqual([]); expect(await other.events.list()).toEqual([]); expect(await other.tools.list()).toEqual([]);
  expect(await other.schedule("2030-01-01T00:00:00Z", "2032-01-01T00:00:00Z")).toEqual([]);
  for (const operation of [() => other.notifications.acknowledge(notification.id), () => other.notifications.retry(notification.id), () => other.followUps.complete("follow"), () => other.followUps.cancel("follow")]) {
    await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  expect(await other.tick()).toMatchObject({ synced: 0, assessed: 0, raised: 0, attempted: 0 });
  expect((await db.followUp.findUniqueOrThrow({ where: { id: "follow" } })).status).toBe("pending");
  const readonly = service("ws", false);
  for (const operation of [() => readonly.tick(), () => readonly.notifications.acknowledge(notification.id), () => readonly.notifications.retry(notification.id), () => readonly.followUps.complete("follow"), () => readonly.followUps.cancel("follow")]) {
    await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  expect(await readonly.notifications.list()).toHaveLength(1);
  expect(await s.tick()).toMatchObject({ raised: 1 }); expect(await s.tick()).toMatchObject({ raised: 0 });
  const schedule = await s.schedule("2030-01-01T00:00:00Z", "2032-01-01T00:00:00Z");
  expect(schedule.map(row => scheduleItemSchema.parse(row).kind).sort()).toEqual(["deadline", "follow_up", "steward_check"]);
  expect(followUpSchema.parse(await s.followUps.complete("follow")).status).toBe("done");
  expect((await s.today()).commitments).toEqual([]);
  expect(await s.tools.list()).toHaveLength(1);
  await expect(s.schedule("bad", "bad")).rejects.toBeInstanceOf(RangeError);
});

test("tick contains poll failures, respects modes and backoff, recovers pending assessor backlog once", async () => {
  const { s, connection } = await setup();
  await s.connections.create({ kind: "reddit_inbox", label: "Not authorized" });
  const manual = await s.connections.create({ kind: "local_test", label: "Manual" });
  await db.sourceConnection.update({ where: { id: manual.id }, data: { mode: "manual" } });
  source.push([item("pending")]); source.failNext(new Error("private error"));
  at = new Date(at.getTime() + 60_000);
  expect(await s.tick()).toMatchObject({ synced: 0, syncFailed: 1 });
  expect((await s.connections.list()).find(row => row.id === connection.id)).toMatchObject({ status: "failing", lastError: "Source sync failed" });
  expect(await s.tick()).toMatchObject({ synced: 0, syncFailed: 0 });
  at = new Date(at.getTime() + 60_000); available = false;
  expect(await s.tick()).toMatchObject({ synced: 1, assessed: 0 });
  expect(await s.health()).toMatchObject({ pendingEvents: 1, assessor: { available: false } });
  available = true; at = new Date(at.getTime() + 30_000);
  expect(await s.tick()).toMatchObject({ synced: 0, assessed: 1 });
  expect(await s.tick()).toMatchObject({ assessed: 0 }); expect(sink.sent).toHaveLength(1);
  await s.connections.transition(connection.id, { action: "pause" });
  at = new Date(at.getTime() + 60_000); expect(await s.tick()).toMatchObject({ synced: 0 });
  await expect(s.syncConnection(connection.id)).rejects.toMatchObject({ code: "SYNC_REFUSED" });
});

test("absent delivery adapter fails visibly; scoped explicit retry preserves its key", async () => {
  const { s } = await setup(); source.push([item("notify")]);
  at = new Date(at.getTime() + 60_000);
  const unavailable = createStewardService({ ...ports, deliveryAdapters: {} }); await unavailable.tick();
  const notification = (await unavailable.notifications.list())[0]; expect(notification.status).toBe("failed");
  expect((await unavailable.health()).failedNotifications).toBe(1); expect(sink.sent).toHaveLength(0);
  await s.notifications.retry(notification.id); await s.tick(); expect(sink.sent).toHaveLength(1);
});

test.each(["pause", "revoke"] as const)("connection %s suppresses queued deliveries", async action => {
  const { s, connection } = await setup(); source.push([item("notify")]);
  await s.syncConnection(connection.id); await s.processPendingEvents();
  expect((await s.notifications.list())[0].status).toBe("queued");
  await s.connections.transition(connection.id, { action }); await s.tick();
  expect((await s.notifications.list())[0].status).toBe("suppressed"); expect(sink.sent).toHaveLength(0);
});
