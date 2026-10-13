import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { ToolTransitionError, type HandlingSignals } from "@chrona/domain/steward/handling";
import { createStewardTools, ToolConflictError, ToolNotFoundError } from "./tools";
const signals: HandlingSignals = { repeatsExpected: "recurring", rulesStable: true, needsOngoingObservation: false, needsUserInteraction: "none", ambiguity: "clear", existingToolFits: false, risk: "low", valueWorthKeeping: false };
const spec = { type: "event_rule", match: { anyKeywords: ["urgent"] }, then: { disposition: "digest", note: "Review locally" }, cases: [{ title: "URGENT", body: "", author: "A", expectMatch: true }, { title: "Hello", body: "", author: "A", expectMatch: false }] };
let dir: string, db: PrismaClient, tools: ReturnType<typeof createStewardTools>;
const at = new Date("2026-10-13T12:00:00Z");
beforeEach(async () => {
  dir = mkdtempSync(join(import.meta.dir, ".tools-test-")); const url = `file:${join(dir, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) }); tools = createStewardTools({ db, now: () => at });
  await db.workspace.createMany({ data: [{ id: "w", name: "Test", status: "Active" }, { id: "other", name: "Other", status: "Active" }] });
  await db.affair.create({ data: { id: "a", workspaceId: "w", title: "Test" } });
});
afterEach(async () => { await db?.$disconnect(); if (dir) rmSync(dir, { recursive: true, force: true }); });
async function generate(inputSpec: unknown = spec, inputSignals = signals) {
  const result = await tools.generate("w", { affairId: "a", name: "Rule", purpose: "Test declarative rule", signals: inputSignals, spec: inputSpec, dataScopes: ["affair_events"] });
  if (!result.created) throw new Error("Expected tool"); return result.tool;
}
async function enable(id: string) {
  await tools.transition("w", id, { action: "validate", expectedVersion: 1 });
  await tools.transition("w", id, { action: "authorize", expectedVersion: 1, actorKey: "user:test" });
  await tools.transition("w", id, { action: "enable", expectedVersion: 1 });
}
async function grant() { await db.delegation.create({ data: { id: "d", workspaceId: "w", affairId: "a", purpose: "Local tools", status: "active", allowedActions: ["run_tool"] } }); }
const events = [{ title: "urgent", body: "", author: "A" }, { title: "hello", body: "", author: "A" }];
test("one-off answer creates no tool; recurring stable need stores spec and rationale", async () => {
  const input = { signals: { ...signals, repeatsExpected: "once" as const }, name: "Answer", purpose: "Once", spec, dataScopes: [] };
  expect(tools.recommend("w", input).mode).toBe("direct_answer");
  expect(await tools.generate("w", input)).toMatchObject({ created: false, choice: { mode: "direct_answer" } });
  expect(await db.managedTool.count()).toBe(0);
  const tool = await generate(); expect(tool).toMatchObject({ kind: "script", state: "generated", version: 1 });
  expect(tool.selectionRationale).toBe(tools.recommend("w", { signals }).rationale);
  expect((await db.managedTool.findUniqueOrThrow({ where: { id: tool.id } })).spec).toEqual(spec);
});
test("generated != validated != authorized != enabled; execution still needs delegation", async () => {
  const { id } = await generate();
  for (const action of ["authorize", "enable"] as const) await expect(tools.transition("w", id, { action, expectedVersion: 1, actorKey: "user:test" })).rejects.toBeInstanceOf(ToolTransitionError);
  await expect(tools.run("w", id, { events })).rejects.toMatchObject({ code: "TOOL_NOT_ENABLED" });
  expect((await tools.transition("w", id, { action: "validate", expectedVersion: 1 })).state).toBe("validated");
  await expect(tools.transition("w", id, { action: "enable", expectedVersion: 1 })).rejects.toBeInstanceOf(ToolTransitionError);
  await expect(tools.transition("w", id, { action: "authorize", expectedVersion: 1 })).rejects.toThrow("actorKey");
  await tools.transition("w", id, { action: "authorize", expectedVersion: 1, actorKey: "user:test" });
  await expect(tools.run("w", id, { events })).rejects.toMatchObject({ code: "TOOL_NOT_ENABLED" });
  await tools.transition("w", id, { action: "enable", expectedVersion: 1 });
  await expect(tools.run("w", id, { events })).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED" });
  await grant(); expect((await tools.run("w", id, { events })).matches).toEqual([{ index: 0, matched: true, disposition: "digest", note: "Review locally" }]);
  expect((await tools.list("w"))[0]).toMatchObject({ lastSuccessAt: at.toISOString(), lastRunAt: at.toISOString() });
  expect(await db.stewardAudit.count({ where: { kind: "tool.run_refused" } })).toBe(3);
  expect(await db.stewardAudit.findFirst({ where: { kind: "tool.authorize" } })).toMatchObject({ actorKey: "user:test" });
  await db.delegation.update({ where: { id: "d" }, data: { askFirstActions: ["run_tool"] } });
  await expect(tools.run("w", id, { events })).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED" });
});
test("failed samples cannot authorize; edit clears authority and stale version conflicts", async () => {
  const bad = { ...spec, cases: spec.cases.map((c) => ({ ...c, expectMatch: !c.expectMatch })) };
  const { id } = await generate(bad);
  expect(await tools.transition("w", id, { action: "validate", expectedVersion: 1 })).toMatchObject({ state: "validation_failed", validatedVersion: null });
  await expect(tools.transition("w", id, { action: "authorize", expectedVersion: 1, actorKey: "user:test" })).rejects.toBeInstanceOf(ToolTransitionError);
  await tools.edit("w", id, { spec, expectedVersion: 1 });
  await expect(tools.transition("w", id, { action: "validate", expectedVersion: 1 })).rejects.toBeInstanceOf(ToolConflictError);
  const second = await generate(); await enable(second.id);
  expect(await tools.edit("w", second.id, { spec, expectedVersion: 1 })).toMatchObject({ version: 2, state: "generated", validatedVersion: null, validationSummary: null, authorizedAt: null, enabledAt: null });
  await expect(tools.edit("w", second.id, { spec, expectedVersion: 1 })).rejects.toBeInstanceOf(ToolConflictError);
});
test("disable then retire records timestamps; every ID method hides other workspace", async () => {
  const { id } = await generate(); await enable(id);
  await tools.transition("w", id, { action: "disable", expectedVersion: 1 });
  await tools.transition("w", id, { action: "retire", expectedVersion: 1 });
  expect(await db.managedTool.findUnique({ where: { id } })).toMatchObject({ state: "retired", disabledAt: at, retiredAt: at });
  await expect(tools.run("other", id, { events })).rejects.toBeInstanceOf(ToolNotFoundError);
  await expect(tools.edit("other", id, { spec, expectedVersion: 1 })).rejects.toBeInstanceOf(ToolNotFoundError);
  await expect(tools.transition("other", id, { action: "validate", expectedVersion: 1 })).rejects.toBeInstanceOf(ToolNotFoundError);
  expect(await tools.list("other")).toEqual([]);
});
test("bounded rule execution records failure without exposing payload; panel resolves data only", async () => {
  const { id } = await generate(); await enable(id); await grant();
  expect((await tools.run("w", id, { events: Array.from({ length: 501 }, () => events[0]) })).matches).toHaveLength(500);
  await expect(tools.run("w", id, { events: [{ title: "x".repeat(501), body: "", author: "" }] })).rejects.toMatchObject({ code: "TOOL_RUN_FAILED" });
  expect(await db.managedTool.findUnique({ where: { id } })).toMatchObject({ lastFailureAt: at });
  await db.attentionItem.create({ data: { workspaceId: "w", affairId: "a", dedupeKey: "test", kind: "change", title: "Local", whatHappened: "Data", whyItMatters: "Test", nextStep: "Review" } });
  const panel = await generate({ type: "table_panel", source: "affair_attention", columns: [{ key: "title", label: "Title" }, { key: "note", label: "Note" }] }, { ...signals, needsUserInteraction: "compare_or_fill" });
  await enable(panel.id); expect((await tools.run("w", panel.id, { events: [] })).rows).toEqual([{ title: "Local", note: "Data" }]);
});
