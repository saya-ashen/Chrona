import { afterEach, beforeEach, expect, test } from "bun:test";
import { db, resetTestDb, seedTask, seedWorkspace } from "@chrona/db";
import { todayViewSchema, type SourceAdapter } from "@chrona/contracts/steward";
import { today } from "./reads";
import type { Context } from "./mappers";

beforeEach(resetTestDb);
afterEach(resetTestDb);
const now = new Date("2031-01-01T00:00:00.000Z");
function context(workspaceId: string): Context {
  const actor = { workspaceId, actorKey: "owner:test", canWrite: false };
  const source: SourceAdapter = { kind: "local_test", mode: "manual", supportedActions: [], coverageNote: "Test only", readiness: async () => ({ state: "unsupported", reason: "Read-only test" }), poll: async () => { throw new Error("Must not poll"); } };
  return { db, actor, authorize: async () => actor, now: () => now,
    sources: { local_test: source, reddit_inbox: { ...source, kind: "reddit_inbox" }, chino_service_health: { ...source, kind: "chino_service_health" } },
    assessor: { name: "test-only", assess: async () => { throw new Error("Must not assess"); } },
  };
}
async function result(workspaceId: string) {
  const { taskId } = await seedTask(workspaceId);
  await db.task.update({ where: { id: taskId }, data: { title: "Existing task" } });
  return db.taskResult.create({ data: { workspaceId, taskId, scopeKey: "task" } });
}
async function version(resultId: string, number: number, publishedAt: Date) {
  const parent = await db.taskResult.findUniqueOrThrow({ where: { id: resultId } });
  const row = await db.taskResultVersion.create({ data: { resultId, version: number, parentVersionId: parent.headVersionId, publishedAt, contentHash: "a".repeat(64), sourceKind: "external", actorKey: "external:test",
    content: { schemaVersion: 1, outcome: { title: `Report ${number}`, summary: "Existing published result" }, readiness: { status: "ready", summary: "Source-reported readiness" } },
  } });
  await db.taskResult.update({ where: { id: resultId }, data: { headVersionId: row.id, editRevision: { increment: 1 } } });
  return row;
}
test("empty workspace has no recent results", async () => {
  const { workspaceId } = await seedWorkspace();
  expect(todayViewSchema.parse(await today(context(workspaceId))).recentResults).toEqual([]);
});
test("recent results are workspace-scoped, newest first and capped at 20 without execution records", async () => {
  const { workspaceId } = await seedWorkspace();
  const own = await result(workspaceId), otherWorkspace = await seedWorkspace(), other = await result(otherWorkspace.workspaceId);
  const rows = [];
  // Publication time, not version number or insertion order, controls recency.
  for (let n = 1; n <= 22; n++) rows.push(await version(own.id, n, new Date(now.getTime() - n * 1000)));
  await version(other.id, 1, new Date(now.getTime() + 1000));
  const view = todayViewSchema.parse(await today(context(workspaceId)));
  expect(view.recentResults.map(row => row.id)).toEqual(rows.slice(0, 20).map(row => row.id));
  expect(view.recentResults[0]).toEqual({ id: rows[0]!.id, taskId: own.taskId, taskTitle: "Existing task", title: "Report 1", version: 1, reviewState: "unreviewed", publishedAt: rows[0]!.publishedAt.toISOString(), href: `/tasks/${own.taskId}/results` });
  expect(await db.run.count()).toBe(0); expect(await db.taskPlan.count()).toBe(0);
});
test("review state is the latest recorded decision, not publication or source readiness", async () => {
  const { workspaceId } = await seedWorkspace(), own = await result(workspaceId), row = await version(own.id, 1, now);
  for (const [index, decision] of ["accept", "request_changes", "reject"].entries()) {
    const command = await db.resultCommand.create({ data: { workspaceId, actorKey: "owner:test", operation: "review", requestId: `review-${index}`, payloadHash: "test", resultId: own.id, versionId: row.id, receipt: {} } });
    await db.taskResultReview.create({ data: { resultId: own.id, versionId: row.id, commandId: command.id, revision: index + 2, decision, actorKey: "owner:test" } });
    await db.taskResult.update({ where: { id: own.id }, data: { editRevision: { increment: 1 }, ...(decision === "accept" ? { acceptedVersionId: row.id } : {}) } });
    expect((await today(context(workspaceId))).recentResults[0]?.reviewState).toBe(decision);
  }
});
