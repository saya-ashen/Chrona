import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createLocalTestSource, createRedditInboxSource, createRuleAssessor, createTestDelivery } from "@chrona/integrations/steward";
import { DEFAULT_MAX_PER_RUN, DISMISS_COOLDOWN_MS } from "@chrona/domain/steward/suggestions";
import { createStewardService } from "./index";
import type { Context } from "./mappers";
import { raiseSuggestions } from "./suggest";
import { tick } from "./tick";

let db: PrismaClient, directory: string, at: Date, ctx: Context;
let service: ReturnType<typeof createStewardService>;
beforeEach(async () => {
  const root = resolve("packages/engine/src/modules/steward/.tmp"); mkdirSync(root, { recursive: true });
  directory = mkdtempSync(join(root, "suggest-")); const url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) });
  await db.workspace.createMany({ data: ["ws", "other"].map(id => ({ id, name: id, status: "Active" })) });
  at = new Date("2031-01-20T00:00:00Z");
  const actor = { workspaceId: "ws", actorKey: "test:owner", canWrite: true };
  ctx = { db, actor, authorize: async () => actor, now: () => at,
    sources: { local_test: createLocalTestSource().adapter, reddit_inbox: createRedditInboxSource({}) },
    assessor: createRuleAssessor({ available: () => true }), deliveryAdapters: { local_test: createTestDelivery().adapter } };
  service = createStewardService(ctx);
});
afterEach(async () => { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
async function affair(id = "affair", updatedAt = at) {
  return db.affair.create({ data: { id, workspaceId: "ws", title: id, goal: "Keep track", keywords: ["Review"], createdAt: updatedAt, updatedAt } });
}
async function repeated(disposition = "digest") {
  await affair();
  const connection = await db.sourceConnection.create({ data: { workspaceId: "ws", kind: "local_test", label: "Test", mode: "manual" } });
  for (let i = 0; i < 3; i++) {
    const event = await db.inboundEvent.create({ data: { workspaceId: "ws", connectionId: connection.id, externalId: `${i}`, affairId: "affair", linkStatus: "confirmed", status: "assessed", title: `Review ${i}`, body: "Review evidence", author: `author-${i}`, occurredAt: at } });
    await db.eventAssessment.create({ data: { workspaceId: "ws", eventId: event.id, assessor: "test", disposition, whatHappened: "Review arrived", whyItMatters: "Recurring review", nextStep: "Review", createdAt: at } });
  }
}
const suggestion = () => db.attentionItem.findFirstOrThrow({ where: { workspaceId: "ws", kind: "suggestion" } });

test("repeated pattern raises one evidenced proposal with rationale; ticks and approval are idempotent and never grant authority", async () => {
  await repeated();
  expect(await service.tick()).toMatchObject({ suggested: 1, suggestionFailed: 0 });
  const row = await suggestion();
  expect(row.dedupeKey).toContain("suggest:repeated_manual:");
  expect(row.whyItMatters.length).toBeGreaterThan(20);
  const audit = await db.stewardAudit.findFirstOrThrow({ where: { subjectId: row.id, kind: "suggestion_raised" } });
  const details = audit.details as { handling: { rationale: string }; proposes: string };
  expect(details.proposes).toBe("propose_delegation");
  expect(row.whyItMatters).toContain(details.handling.rationale);
  expect(row.evidence).toHaveLength(3);
  expect(row.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Review 0", excerpt: "Review evidence" })]));
  expect(row.nextStep).toContain("separate explicit step");
  expect(await db.delegation.count()).toBe(0);
  expect(await service.tick()).toMatchObject({ suggested: 0 });
  expect(await db.attentionItem.count({ where: { kind: "suggestion" } })).toBe(1);
  await service.attention.decide(row.id, { decision: "approve" });
  await service.attention.decide(row.id, { decision: "approve" });
  const delegation = await db.delegation.findFirstOrThrow();
  expect(delegation).toMatchObject({ status: "proposed", affairId: "affair", grantedAt: null, allowedActions: ["read_source", "summarize"], askFirstActions: ["notify_user"], notification: { mode: "digest", channel: "in_app" } });
  expect((await suggestion()).delegationId).toBe(delegation.id);
  expect(await db.delegation.count()).toBe(1);
  expect(await db.stewardNotification.count()).toBe(0);
  expect(await db.followUp.count()).toBe(0);
  expect(await db.managedTool.count()).toBe(0);
  expect(await service.tick()).toMatchObject({ suggested: 0 });
});

test("dismissal restrains changed fact buckets for the family cooldown and never reopens the original", async () => {
  await repeated(); await service.tick(); const row = await suggestion();
  await service.attention.decide(row.id, { decision: "dismiss" });
  expect((await suggestion()).cooldownUntil?.getTime()).toBe(at.getTime() + DISMISS_COOLDOWN_MS);
  expect(await service.tick()).toMatchObject({ suggested: 0 });
  // A new normalized pattern has a new key but the same detector/affair family.
  await db.affair.update({ where: { id: "affair" }, data: { keywords: ["evidence"] } });
  at = new Date(at.getTime() + 86400_000);
  expect(await service.tick()).toMatchObject({ suggested: 0 });
  expect(await db.attentionItem.count({ where: { kind: "suggestion" } })).toBe(1);
  expect((await suggestion()).status).toBe("dismissed");
});

test("approving a tool choice records the drafting step, never generates or enables a tool", async () => {
  await repeated("await_decision"); await service.tick(); const row = await suggestion();
  await service.attention.decide(row.id, { decision: "approve" });
  expect((await suggestion()).nextStep).toStartWith("Draft the tool from the affair page");
  expect(await db.managedTool.count()).toBe(0); expect(await db.delegation.count()).toBe(0);
  expect(await db.stewardNotification.count()).toBe(0);
});

test("stalled goals get check-ins, scoped to workspace and capped per run", async () => {
  for (let i = 0; i < DEFAULT_MAX_PER_RUN + 2; i++) await affair(`stalled-${i}`, new Date("2031-01-01T00:00:00Z"));
  await db.affair.create({ data: { workspaceId: "other", title: "Private", goal: "Private", updatedAt: new Date("2031-01-01T00:00:00Z") } });
  expect((await raiseSuggestions(ctx)).raised).toBe(DEFAULT_MAX_PER_RUN);
  const rows = await db.attentionItem.findMany(); expect(rows).toHaveLength(DEFAULT_MAX_PER_RUN);
  for (const row of rows) {
    expect(row.workspaceId).toBe("ws"); expect(row.dedupeKey).toContain("suggest:stalled_goal:");
    expect(row.nextStep).toContain("Check in on progress");
  }
});

test("suggestion failures are counted without aborting delivery or tick completion", async () => {
  const failingDb = new Proxy(db, { get(target, property) {
    if (property === "managedTool") return { findMany: async () => { throw new Error("Detection unavailable"); } };
    return Reflect.get(target, property);
  } });
  expect(await tick({ ...ctx, db: failingDb })).toMatchObject({ suggested: 0, suggestionFailed: 1, attempted: 0, lastTickAt: at.toISOString() });
  expect((await db.stewardState.findUniqueOrThrow({ where: { workspaceId: "ws" } })).lastTickAt).toEqual(at);
});

test("schedule projects appointments, deadlines, checks, follow-ups and unconfirmed dates read-only with exclusive end", async () => {
  await affair();
  const calendar = await db.calendarSource.create({ data: { workspaceId: "ws", name: "Test", sourceUrl: "https://example.invalid/calendar", redactedUrlLabel: "Test", color: "blue" } });
  await db.importedCalendarEvent.create({ data: { workspaceId: "ws", calendarSourceId: calendar.id, externalUid: "appointment", dedupeKey: "appointment", title: "Appointment", startsAt: at, endsAt: new Date(at.getTime() + 3600_000) } });
  for (const kind of ["commitment", "suggestion"]) await db.attentionItem.create({ data: { workspaceId: "ws", affairId: "affair", kind, dedupeKey: kind, title: kind, whatHappened: "Date", whyItMatters: "Check", nextStep: "Review", dueAt: at } });
  await db.followUp.create({ data: { workspaceId: "ws", affairId: "affair", note: "Follow up", dueAt: at } });
  await db.delegation.create({ data: { workspaceId: "ws", affairId: "affair", purpose: "Check", status: "active", cadenceSeconds: 60 } });
  const rows = await service.schedule(at.toISOString(), new Date(at.getTime() + 86400_000).toISOString());
  expect(rows.map(r => r.kind).sort()).toEqual(["appointment", "deadline", "follow_up", "steward_check", "unconfirmed_suggestion"]);
  expect(rows.find(r => r.kind === "unconfirmed_suggestion")?.confirmed).toBe(false);
  expect(rows.find(r => r.kind === "deadline")?.confirmed).toBe(true);
  expect(await service.schedule(new Date(at.getTime() - 86400_000).toISOString(), at.toISOString())).toEqual([]);
  expect(await db.importedCalendarEvent.count()).toBe(1);
});
