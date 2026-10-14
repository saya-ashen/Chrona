import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { AssessorUnavailableError, type AssessmentProposal, type SourceAdapter, type SourceItem } from "@chrona/contracts/steward";
import { createStewardService, type StewardPorts } from "./index";
let db: PrismaClient, ports: StewardPorts, service: ReturnType<typeof createStewardService>, items: SourceItem[], unavailable: boolean, pollFailed: boolean, polls: number, clock: Date, proposal: AssessmentProposal, databaseUrl: string;
const item = (externalId: string): SourceItem => ({ externalId, title: `Message ${externalId}`, body: "evidence", author: "test", url: "https://example.invalid/message", occurredAt: "2031-01-01T00:00:00Z", threadId: "thread" });
function client() { return new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) }); }
beforeEach(async () => {
  const root = resolve("packages/engine/src/modules/steward/.tmp"); mkdirSync(root, { recursive: true });
  databaseUrl = `file:${mkdtempSync(`${root}/test-`)}/test.db`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve("prisma/migrations") });
  db = client(); await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  const workspace = await db.workspace.create({ data: { name: "Steward test", status: "Active" } });
  clock = new Date("2031-01-01T00:00:00Z"); items = [item("old")]; unavailable = false; pollFailed = false; polls = 0;
  proposal = { disposition: "digest", whatHappened: "New message", whyItMatters: "Needs attention", nextStep: "Review", proposedAction: null, affairId: null, followUp: null };
  const source: SourceAdapter = { kind: "local_test", mode: "poll", supportedActions: ["read_source"], coverageNote: "Test only", readiness: async () => ({ state: "ready" }), poll: async () => { polls++; if (pollFailed) throw new Error("secret must not be stored"); return { items, nextCursor: `cursor:${items.length}` }; } };
  ports = { db, sources: { local_test: source, reddit_inbox: { ...source, kind: "reddit_inbox", readiness: async () => ({ state: "needs_authorization", reason: "No account" }) }, chino_service_health: { ...source, kind: "chino_service_health" } }, assessor: { name: "fake", assess: async () => { if (unavailable) throw new AssessorUnavailableError(); return proposal; } }, now: () => clock, authorize: async () => ({ workspaceId: workspace.id, actorKey: "owner:test", canWrite: true }) };
  service = createStewardService(ports);
});
afterEach(async () => { await db.$disconnect(); });
async function baseline() { const connection = await service.connections.create({ kind: "local_test", label: "Test" }); expect(await service.syncConnection(connection.id)).toEqual({ received: 1, duplicates: 0, baseline: true }); return connection; }
async function incoming() { const connection = await baseline(); items = [...items, item("new")]; await service.syncConnection(connection.id); return connection; }
test("baseline never produces attention; concurrent sync and assessed replay are idempotent", async () => {
  const connection = await baseline(); expect(await service.processPendingEvents()).toEqual({ assessed: 0 }); expect(await service.attention.list()).toHaveLength(0);
  items = [...items, item("new")];
  const results = await Promise.all([service.syncConnection(connection.id), createStewardService(ports).syncConnection(connection.id)]);
  expect(results.map(r => r.received).sort()).toEqual([0, 1]); expect(await db.inboundEvent.count()).toBe(2);
  expect(await service.processPendingEvents()).toEqual({ assessed: 1 }); expect(await service.processPendingEvents()).toEqual({ assessed: 0 });
  expect(await service.attention.list()).toHaveLength(1); expect(await db.eventAssessment.count()).toBe(1);
  expect((await service.attention.list())[0].evidence[0]).toMatchObject({ label: "Message new", excerpt: "evidence" });
});
test("first sync stores a current condition as pending while ordinary history remains baseline", async () => {
  items = [item("history"), { ...item("live-condition"), current: true }];
  const connection = await service.connections.create({ kind: "local_test", label: "Test current condition" });
  expect(await service.syncConnection(connection.id)).toEqual({ received: 2, duplicates: 0, baseline: true });
  expect(await db.inboundEvent.findFirstOrThrow({ where: { externalId: "history" } })).toMatchObject({ status: "baseline" });
  expect(await db.inboundEvent.findFirstOrThrow({ where: { externalId: "live-condition" } })).toMatchObject({ status: "pending" });
  expect(await service.syncConnection(connection.id)).toEqual({ received: 0, duplicates: 2, baseline: false });
  expect(await service.processPendingEvents()).toEqual({ assessed: 1 });
  expect(await db.inboundEvent.findFirstOrThrow({ where: { externalId: "history" } })).toMatchObject({ status: "baseline" });
});
test("separate clients sharing a file cannot duplicate an inbound event", async () => {
  const connection = await baseline(); items.push(item("concurrent")); const second = client();
  try {
    const other = createStewardService({ ...ports, db: second });
    await Promise.all([service.syncConnection(connection.id), other.syncConnection(connection.id)]);
    expect(await db.inboundEvent.count()).toBe(2);
  } finally { await second.$disconnect(); }
});
test("unavailable backlog survives a new client and service over the same file, then recovers", async () => {
  const connection = await incoming(); unavailable = true; await service.processPendingEvents();
  expect(await service.health()).toMatchObject({ pendingEvents: 1, assessor: { available: false, lastError: "Assessor unavailable" } });
  expect(await db.eventAssessment.count()).toBe(0); expect(await db.attentionItem.count()).toBe(0);
  await db.$disconnect(); db = client(); ports = { ...ports, db }; service = createStewardService(ports);
  expect((await db.sourceConnection.findUniqueOrThrow({ where: { id: connection.id } })).cursor).toBe("cursor:2");
  expect(await service.syncConnection(connection.id)).toMatchObject({ received: 0, duplicates: 2 });
  expect(await service.processPendingEvents()).toEqual({ assessed: 0 });
  unavailable = false; clock = new Date(clock.getTime() + 60_000); expect(await service.processPendingEvents()).toEqual({ assessed: 1 });
  expect(await service.health()).toMatchObject({ pendingEvents: 0, assessor: { available: true } }); expect(await service.attention.list()).toHaveLength(1);
});
test("paused, revoked and unauthorized connections never poll; poll failure is visible and preserves cursor", async () => {
  const connection = await baseline(); pollFailed = true;
  await expect(service.syncConnection(connection.id)).rejects.toMatchObject({ code: "SYNC_REFUSED" });
  expect(await db.sourceConnection.findUniqueOrThrow({ where: { id: connection.id } })).toMatchObject({ cursor: "cursor:1", status: "failing", lastError: "Source poll failed" });
  pollFailed = false; await service.syncConnection(connection.id); expect((await service.connections.list())[0].status).toBe("active");
  await service.connections.transition(connection.id, { action: "pause" }); const before = polls;
  await expect(service.syncConnection(connection.id)).rejects.toMatchObject({ code: "SYNC_REFUSED" });
  await service.connections.transition(connection.id, { action: "revoke" }); await expect(service.syncConnection(connection.id)).rejects.toMatchObject({ code: "SYNC_REFUSED" });
  const auth = await service.connections.create({ kind: "reddit_inbox", label: "Not authorized" }); await expect(service.syncConnection(auth.id)).rejects.toMatchObject({ code: "SYNC_REFUSED" }); expect(polls).toBe(before);
});
test("revoked delegation denies notification and revisions conflict", async () => {
  const connection = await incoming(); const delegation = await service.delegations.propose({ connectionId: connection.id, purpose: "Read messages", allowedActions: ["notify_user"] });
  await service.delegations.transition(delegation.id, { action: "grant", expectedRevision: 1 });
  await expect(service.delegations.transition(delegation.id, { action: "revoke", expectedRevision: 1 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await service.delegations.transition(delegation.id, { action: "revoke", expectedRevision: 2 });
  proposal = { ...proposal, disposition: "notify_now", proposedAction: "notify_user" }; await service.processPendingEvents();
  expect(await db.stewardNotification.count()).toBe(0); expect((await db.eventAssessment.findFirstOrThrow()).permission).toMatchObject({ outcome: "denied" });
  expect(await db.stewardAudit.count({ where: { kind: "permission_decision" } })).toBe(1);
});
test("pilot-denied assessor action is audited and has no external effects", async () => {
  const connection = await incoming(); const delegation = await service.delegations.propose({ connectionId: connection.id, purpose: "Read", allowedActions: ["reply_external"] });
  await service.delegations.transition(delegation.id, { action: "grant", expectedRevision: 1 });
  proposal = { ...proposal, disposition: "act", proposedAction: "reply_external" }; await service.processPendingEvents();
  expect((await db.eventAssessment.findFirstOrThrow()).permission).toMatchObject({ outcome: "denied", reason: "Action prohibited by the read-only pilot." });
  expect(await db.stewardNotification.count()).toBe(0); expect(await db.followUp.count()).toBe(0); expect(await db.stewardAudit.count({ where: { kind: "permission_decision" } })).toBe(1);
});
test("allowed notification is queued once and internal follow-up is persisted", async () => {
  const connection = await incoming(); const delegation = await service.delegations.propose({ connectionId: connection.id, purpose: "Watch", allowedActions: ["notify_user", "create_follow_up"] });
  await service.delegations.transition(delegation.id, { action: "grant", expectedRevision: 1 });
  proposal = { ...proposal, disposition: "notify_now", proposedAction: "notify_user" }; await service.processPendingEvents();
  const notification = await db.stewardNotification.findFirstOrThrow(); expect(notification.status).toBe("queued"); expect(notification.idempotencyKey).toBe(`attention:${notification.attentionItemId}:v1`);
  await service.processPendingEvents(); expect(await db.stewardNotification.count()).toBe(1);
  items.push(item("follow")); await service.syncConnection(connection.id); proposal = { ...proposal, disposition: "act", proposedAction: "create_follow_up", followUp: { note: "Check again", dueAt: "2031-02-01T00:00:00Z" } }; await service.processPendingEvents();
  expect(await db.followUp.count()).toBe(1);
});
test("ordinary assessor failures back off and create one failure item at five attempts", async () => {
  await incoming(); ports.assessor.assess = async () => { throw new Error("private provider detail"); };
  for (let attempt = 1; attempt <= 5; attempt++) {
    await service.processPendingEvents(); const event = await db.inboundEvent.findFirstOrThrow({ where: { externalId: "new" } });
    expect(event.attempts).toBe(attempt); expect(event.status).toBe(attempt === 5 ? "failed" : "pending"); expect(event.lastError).toBe("Assessment failed");
    clock = new Date(clock.getTime() + 31 * 60_000);
  }
  await service.processPendingEvents(); expect(await db.attentionItem.count({ where: { kind: "failure" } })).toBe(1); expect((await service.health()).failedEvents).toBe(1);
});
test("workspace authorization prevents cross-workspace and read-only writes", async () => {
  const connection = await baseline(); const other = await db.workspace.create({ data: { name: "Other", status: "Active" } });
  const scoped = createStewardService({ ...ports, authorize: async () => ({ workspaceId: other.id, actorKey: "other", canWrite: true }) });
  await expect(scoped.syncConnection(connection.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(await scoped.connections.list()).toHaveLength(0);
  const readOnly = createStewardService({ ...ports, authorize: async () => ({ ...await ports.authorize(false), canWrite: false }) });
  await expect(readOnly.connections.create({ kind: "local_test", label: "Denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
test("guessed affairs stay suggested; confirmed thread links are deterministic; snooze returns", async () => {
  const connection = await incoming(); const affair = await service.affairs.create({ title: "Matter" }); proposal = { ...proposal, affairId: affair.id };
  await service.processPendingEvents(); let event = await db.inboundEvent.findFirstOrThrow({ where: { externalId: "new" } }); expect(event.linkStatus).toBe("suggested");
  await service.linkEvent(event.id, { decision: "confirm", affairId: affair.id }); items.push(item("third")); await service.syncConnection(connection.id); proposal = { ...proposal, affairId: null }; await service.processPendingEvents();
  event = await db.inboundEvent.findFirstOrThrow({ where: { externalId: "third" } }); expect(event.linkStatus).toBe("confirmed");
  const attention = (await service.attention.list())[0]; await service.attention.decide(attention.id, { decision: "snooze", snoozeUntil: "2031-01-02T00:00:00Z" }); expect((await service.today()).changes).toHaveLength(1);
  clock = new Date("2031-01-03T00:00:00Z"); expect((await service.today()).changes).toHaveLength(2);
});
test("a slow assessor does not block other steward requests, and a concurrent pass applies once", async () => {
  await incoming();
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = createStewardService({ ...ports, assessor: { name: "slow", assess: async () => { calls++; await gate; return proposal; } } });
  const ticking = slow.processPendingEvents();
  while (calls === 0) await new Promise(resolve => setTimeout(resolve, 5));
  // The model call is in flight; reads and writes through the same database queue still complete.
  expect((await service.health()).pendingEvents).toBe(1);
  expect(await service.processPendingEvents()).toEqual({ assessed: 1 });
  release();
  expect(await ticking).toEqual({ assessed: 0 });
  expect(await db.eventAssessment.count()).toBe(1); expect(await service.attention.list()).toHaveLength(1);
});
