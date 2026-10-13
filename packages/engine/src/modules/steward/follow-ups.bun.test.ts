import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createStewardFollowUps } from "./follow-ups";

let directory: string, db: PrismaClient;
const at = new Date("2026-10-13T12:00:00Z");
beforeEach(async () => {
  directory = mkdtempSync(join(process.cwd(), ".steward-followup-test-")); const url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) });
  await db.workspace.create({ data: { id: "ws", name: "Test", status: "Active" } });
  await db.followUp.create({ data: { id: "f", workspaceId: "ws", note: "Check the commitment", dueAt: at } });
});
afterEach(async () => { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("due follow-ups raise once across repeated ticks/restarts and remain pending", async () => {
  const service = createStewardFollowUps({ db, workspaceId: "ws", now: () => at });
  expect(await service.raiseDueFollowUps({ now: new Date(at.getTime() - 1) })).toEqual({ raised: 0 });
  expect(await service.raiseDueFollowUps({ now: at })).toEqual({ raised: 1 });
  expect(await createStewardFollowUps({ db, workspaceId: "ws" }).raiseDueFollowUps({ now: at })).toEqual({ raised: 0 });
  expect(await db.attentionItem.findFirstOrThrow()).toMatchObject({ kind: "commitment", dedupeKey: "followup:f", dueAt: at });
  expect((await db.followUp.findUniqueOrThrow({ where: { id: "f" } })).status).toBe("pending");
  expect(await db.stewardAudit.count({ where: { kind: "followup.raised" } })).toBe(1);
  await service.completeFollowUp("f"); await service.completeFollowUp("f");
  expect((await db.attentionItem.findFirstOrThrow()).status).toBe("resolved");
  expect((await db.followUp.findUniqueOrThrow({ where: { id: "f" } })).status).toBe("done");
  expect(await service.raiseDueFollowUps({ now: at })).toEqual({ raised: 0 });
  expect(await db.stewardAudit.count({ where: { kind: "followup.done" } })).toBe(1);
});

test("concurrent ticks raise only one commitment", async () => {
  const first = createStewardFollowUps({ db, workspaceId: "ws", now: () => at });
  const second = createStewardFollowUps({ db, workspaceId: "ws", now: () => at });
  const results = await Promise.all([first.raiseDueFollowUps({}), second.raiseDueFollowUps({})]);
  expect(results.reduce((sum, result) => sum + result.raised, 0)).toBe(1);
  expect(await db.attentionItem.count()).toBe(1);
});

test("cancelled follow-ups never raise and cannot become done", async () => {
  const service = createStewardFollowUps({ db, workspaceId: "ws", now: () => at }); await service.cancelFollowUp("f"); await service.completeFollowUp("f");
  expect(await service.raiseDueFollowUps({ now: at })).toEqual({ raised: 0 }); expect(await db.attentionItem.count()).toBe(0);
  expect((await db.followUp.findUniqueOrThrow({ where: { id: "f" } })).status).toBe("cancelled");
});

test("cancellation dismisses only the generated commitment, not original attention", async () => {
  const original = await db.attentionItem.create({ data: { workspaceId: "ws", dedupeKey: "original", kind: "change", title: "Original", whatHappened: "Test", whyItMatters: "Test", nextStep: "Review" } });
  await db.followUp.update({ where: { id: "f" }, data: { attentionItemId: original.id } });
  const service = createStewardFollowUps({ db, workspaceId: "ws", now: () => at }); await service.raiseDueFollowUps({}); await service.cancelFollowUp("f");
  expect((await db.attentionItem.findUniqueOrThrow({ where: { id: original.id } })).status).toBe("open");
  expect((await db.attentionItem.findUniqueOrThrow({ where: { workspaceId_dedupeKey: { workspaceId: "ws", dedupeKey: "followup:f" } } })).status).toBe("dismissed");
});
