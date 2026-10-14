import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createChinoServiceHealthSource, createLocalTestSource, createRedditInboxSource, createRuleAssessor, createInAppDelivery } from "@chrona/integrations/steward";
import { createStewardService } from "./index";
import type { Context } from "./mappers";
import { raiseDigests } from "./digest";

let db: PrismaClient, directory: string, at: Date, ctx: Context;
let service: ReturnType<typeof createStewardService>, polls: number, fail: boolean;
beforeEach(async () => {
  const root = resolve("packages/engine/src/modules/steward/.tmp"); mkdirSync(root, { recursive: true });
  directory = mkdtempSync(join(root, "standing-")); const url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) });
  await db.workspace.create({ data: { id: "ws", name: "Test", status: "Active" } });
  at = new Date("2031-01-20T12:00:00Z"); polls = 0; fail = false;
  const actor = { workspaceId: "ws", actorKey: "test:owner", canWrite: true };
  const source = createLocalTestSource().adapter;
  ctx = { db, actor, authorize: async () => actor, now: () => at,
    sources: { local_test: { ...source, poll: async (...args) => { polls++; if (fail) throw new Error("secret raw adapter text"); return source.poll(...args); } }, reddit_inbox: createRedditInboxSource({}), chino_service_health: createChinoServiceHealthSource() },
    assessor: createRuleAssessor({ available: () => true }), deliveryAdapters: { in_app: createInAppDelivery() } };
  service = createStewardService(ctx);
});
afterEach(async () => { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
async function grant(connectionId?: string, cadenceSeconds?: number) {
  const d = await service.delegations.propose({ connectionId, cadenceSeconds, purpose: "Watch updates", allowedActions: ["read_source", "notify_user", "summarize"] });
  return service.delegations.transition(d.id, { action: "grant", expectedRevision: d.revision });
}
async function change(delegationId: string, title = "New update") {
  return db.attentionItem.create({ data: { workspaceId: "ws", delegationId, dedupeKey: crypto.randomUUID(), kind: "change", title, whatHappened: title, whyItMatters: "Update", nextStep: "Review", createdAt: at } });
}

test("no standing grant means idle, explicit sync works; granting polls, cadence waits, pause does not fail", async () => {
  const c = await service.connections.create({ kind: "local_test", label: "Test", pollIntervalSeconds: 60 });
  expect((await service.tick()).synced).toBe(0); expect(polls).toBe(0);
  expect((await service.connections.list())[0]).toMatchObject({ status: "active", nextCheckAt: null, lastError: null, coverageNote: expect.stringContaining("idle") });
  await service.syncConnection(c.id); expect(polls).toBe(1);
  at = new Date(at.getTime() + 60_000);
  const d = await grant(c.id, 300);
  expect((await service.tick()).synced).toBe(1);
  expect(await db.delegation.findUnique({ where: { id: d.id } })).toMatchObject({ lastCheckAt: at, lastSuccessAt: at, lastFailureAt: null, lastError: null });
  at = new Date(at.getTime() + 60_000);
  expect((await service.tick()).synced).toBe(0); expect(polls).toBe(2);
  await service.delegations.transition(d.id, { action: "pause", expectedRevision: d.revision });
  at = new Date(at.getTime() + 600_000);
  expect(await service.tick()).toMatchObject({ synced: 0, syncFailed: 0 });
  expect((await service.connections.list())[0]).toMatchObject({ status: "active", nextCheckAt: null, lastFailureAt: null, lastError: null });
  expect(polls).toBe(2);
});

test("workspace-wide grants cover connections; failures record sanitized delegation telemetry", async () => {
  await service.connections.create({ kind: "local_test", label: "Test" });
  const d = await grant(); fail = true;
  expect((await service.tick()).syncFailed).toBe(1);
  expect(await db.delegation.findUnique({ where: { id: d.id } })).toMatchObject({ lastCheckAt: at, lastSuccessAt: null, lastFailureAt: at, lastError: "Source sync failed" });
  const failedAt = at;
  at = new Date(at.getTime() + 60_000); fail = false;
  expect((await service.tick()).synced).toBe(1);
  expect(await db.delegation.findUnique({ where: { id: d.id } })).toMatchObject({ lastCheckAt: at, lastSuccessAt: at, lastFailureAt: failedAt, lastError: null });
});

test.each(["expired", "ask_first", "revoked"])("%s delegation does not authorize polling", async kind => {
  const c = await service.connections.create({ kind: "local_test", label: "Test" });
  const d = await grant(c.id);
  await db.delegation.update({ where: { id: d.id }, data: kind === "expired" ? { expiresAt: at } : kind === "ask_first" ? { askFirstActions: ["read_source"] } : { status: "revoked" } });
  await service.tick(); expect(polls).toBe(0);
});

test("smallest covering batch limit bounds pending assessment and all covering delegations record checks", async () => {
  const c = await service.connections.create({ kind: "local_test", label: "Test" });
  const first = await grant(c.id, 600), second = await grant(undefined, 60);
  await db.delegation.update({ where: { id: second.id }, data: { limits: { maxEventsPerCheck: 1, maxNotificationsPerDay: 10 } } });
  for (let i = 0; i < 3; i++) await db.inboundEvent.create({ data: { workspaceId: "ws", connectionId: c.id, externalId: String(i), title: "FYI", body: "FYI update", author: "Test", occurredAt: at } });
  expect((await service.tick()).assessed).toBe(1);
  for (const id of [first.id, second.id]) expect(await db.delegation.findUnique({ where: { id } })).toMatchObject({ lastCheckAt: at, lastSuccessAt: at });
  at = new Date(at.getTime() + 60_000);
  expect((await service.tick()).synced).toBe(1);
});

test("omitting policy persists digest/in_app and delivers once per local day, never empty", async () => {
  const d = await grant();
  expect(d.notification).toMatchObject({ mode: "digest", channel: "in_app" });
  await service.tick(); expect(await db.stewardNotification.count()).toBe(0);
  await change(d.id); await service.tick(); await service.tick();
  expect(await db.stewardNotification.findFirst()).toMatchObject({ status: "sent", channel: "in_app", title: "1 updates", body: "New update", attentionItemId: null, link: null, idempotencyKey: `digest:${d.id}:2031-01-20` });
  expect(await db.stewardNotification.count()).toBe(1);
  at = new Date("2031-01-21T12:00:00Z");
  await service.tick(); expect(await db.stewardNotification.count()).toBe(1);
  await change(d.id, "Next day"); await service.tick();
  expect(await db.stewardNotification.count()).toBe(2);
});

test("digest respects timezone and permissions, and lists only ten open change titles", async () => {
  const d = await grant();
  await db.delegation.update({ where: { id: d.id }, data: { notification: { ...d.notification, quietHours: { start: "00:00", end: "00:00", timezone: "Pacific/Kiritimati" } } } });
  for (let i = 0; i < 12; i++) await change(d.id, `Item ${i}`);
  const closed = await change(d.id, "Closed"); await db.attentionItem.update({ where: { id: closed.id }, data: { status: "resolved" } });
  await raiseDigests(ctx); await raiseDigests(ctx);
  const row = await db.stewardNotification.findFirstOrThrow();
  expect(row.idempotencyKey).toBe(`digest:${d.id}:2031-01-21`); expect(row.title).toBe("12 updates"); expect(row.body.split("\n")).toHaveLength(10); expect(row.body).not.toContain("Closed");
  at = new Date(at.getTime() + 86400_000); await change(d.id);
  await db.delegation.update({ where: { id: d.id }, data: { askFirstActions: ["notify_user"] } });
  await raiseDigests(ctx); expect(await db.stewardNotification.count()).toBe(1);
});

test("only explicit approval of a dated decision creates one follow-up; repeat approval is idempotent", async () => {
  const d = await grant(); const item = await change(d.id);
  const dueAt = new Date(at.getTime() + 86400_000);
  await db.attentionItem.update({ where: { id: item.id }, data: { kind: "decision", dueAt, nextStep: "Confirm appointment" } });
  await service.attention.decide(item.id, { decision: "approve" }); await service.attention.decide(item.id, { decision: "approve" });
  expect(await db.followUp.count()).toBe(1);
  expect(await db.followUp.findFirst()).toMatchObject({ attentionItemId: item.id, note: "Confirm appointment", dueAt });
  const declined = await change(d.id);
  await db.attentionItem.update({ where: { id: declined.id }, data: { kind: "decision", dueAt } });
  await service.attention.decide(declined.id, { decision: "decline" });
  expect(await db.followUp.count()).toBe(1);
});
