import { afterEach, beforeEach, expect, test } from "bun:test";
import { db, resetTestDb, seedTask, seedWorkspace } from "@chrona/db";
import { exampleWorkPage } from "@chrona/ui-protocol/work-pages/example";
import { createLocalTaskResultsService } from "./local-owner";
import { createTaskResultsService } from "./service";
import type { ResultPrincipal } from "./access";

const previous = { pages: process.env.CHRONA_WORK_PAGES_WRITES_ENABLED, results: process.env.CHRONA_RESULT_WRITES_ENABLED };
beforeEach(async () => { await resetTestDb(); process.env.CHRONA_WORK_PAGES_WRITES_ENABLED = "true"; process.env.CHRONA_RESULT_WRITES_ENABLED = "true"; });
afterEach(async () => { await resetTestDb(); for (const [key, value] of [["CHRONA_WORK_PAGES_WRITES_ENABLED", previous.pages], ["CHRONA_RESULT_WRITES_ENABLED", previous.results]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } });
async function fixture() {
  const { workspaceId } = await seedWorkspace(), { taskId } = await seedTask(workspaceId);
  await db.task.update({ where: { id: taskId }, data: { taskExecutionMode: "manual", autoExecute: false, autoPlanGeneration: false } });
  const principal: ResultPrincipal = { workspaceId, actorKind: "external", actorId: "page-author", permissions: ["results:read", "results:write", "pages:read", "pages:write"] };
  const agent = createTaskResultsService({ authorize: async () => principal });
  const owner = createLocalTaskResultsService(async () => true);
  const input = { taskId, requestId: crypto.randomUUID(), expectedRevision: null, content: { schemaVersion: 1, outcome: { title: "配电脑", summary: "等待商量" }, readiness: { status: "partial", summary: "还未购买" }, page: exampleWorkPage } };
  const published = await agent.publish(input);
  return { workspaceId, taskId, principal, agent, owner, input, published };
}

test("complete external-author / owner response / independent-reader / new-version loop preserves notes and historical answers", async () => {
  const f = await fixture(), before = await db.task.findUniqueOrThrow({ where: { id: f.taskId } });
  const read = await f.owner.pageRead({ taskId: f.taskId });
  const note = { taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: read.revision, action: { type: "note", noteId: crypto.randomUUID(), text: "先和家里商量" } };
  const saved = await f.owner.pageWrite(note);
  expect(await f.owner.pageWrite(note)).toEqual({ ...saved, replayed: true });
  const afterNote = await f.agent.pageRead({ taskId: f.taskId });
  expect(afterNote.entries[0].content.text).toBe("先和家里商量");
  expect(afterNote.canRespond).toBe(false);
  await f.owner.pageWrite({ taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: afterNote.revision, action: { type: "respond", versionId: f.published.receipt.versionId, formKey: "decision", answers: { timing: "wait", date: "2026-10-01", budget: 9000 } } });
  const second = await f.agent.publish({ ...f.input, requestId: crypto.randomUUID(), expectedRevision: f.published.receipt.editRevision });
  const current = await f.owner.pageRead({ taskId: f.taskId });
  expect(current.headVersionId).toBe(second.receipt.versionId);
  expect(current.entries).toHaveLength(1);
  expect(current.entries[0].content.text).toBe(note.action.text);
  const history = await f.agent.pageRead({ taskId: f.taskId, view: "history", limit: 1 });
  expect(history.total).toBe(2); expect(history.nextOffset).toBe(1);
  expect(history.entries[0]).toMatchObject({ versionId: f.published.receipt.versionId, content: { answers: { timing: "wait" } } });
  expect((await f.agent.pageRead({ taskId: f.taskId, view: "history", offset: 1 })).entries[0].content.text).toBe(note.action.text);
  await expect(f.owner.pageWrite({ taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: current.revision, action: { type: "respond", versionId: f.published.receipt.versionId, formKey: "decision", answers: { timing: "now" } } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect(await db.task.findUniqueOrThrow({ where: { id: f.taskId } })).toEqual(before);
  expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.executionSession.count(), db.taskResultReview.count(), db.workBlock.count()])).toEqual([0, 0, 0, 0, 0]);
  const events = await db.event.findMany({ where: { eventType: "work_page.input_recorded" } });
  expect(JSON.stringify(events)).not.toContain(note.action.text);
});

test("blank manual page accepts notes without a fabricated result version or provider", async () => {
  const { workspaceId } = await seedWorkspace(), { taskId } = await seedTask(workspaceId);
  const owner = createLocalTaskResultsService(async () => true);
  await owner.pageWrite({ taskId, requestId: crypto.randomUUID(), expectedRevision: null, action: { type: "note", noteId: crypto.randomUUID(), text: "Write here" } });
  expect(await db.taskResultVersion.count()).toBe(0);
  expect((await owner.pageRead({ taskId })).entries[0].content.text).toBe("Write here");
});

test("CAS, idempotency, immutable history, auth revocation and disabled writes are enforced", async () => {
  const f = await fixture(), read = await f.owner.pageRead({ taskId: f.taskId });
  const input = { taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: read.revision, action: { type: "note", noteId: crypto.randomUUID(), text: "draft" } };
  await f.owner.pageWrite(input);
  await expect(f.owner.pageWrite({ ...input, action: { ...input.action, text: "changed" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(f.owner.pageWrite({ ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await expect(Promise.resolve(db.workPageInput.updateMany({ data: { content: {} } }))).rejects.toThrow();
  await expect(Promise.resolve(db.workPageInput.deleteMany())).rejects.toThrow();
  await expect(createLocalTaskResultsService(async () => false).pageWrite(input)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  process.env.CHRONA_WORK_PAGES_WRITES_ENABLED = "false";
  await expect(f.owner.pageWrite(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await f.owner.pageRead({ taskId: f.taskId })).entries).toHaveLength(1);
  expect((await f.owner.pageRead({ taskId: f.taskId })).canRespond).toBe(false);
});

test("old result credentials cannot see, author or erase pages; external actors cannot forge owner answers", async () => {
  const f = await fixture();
  await expect(f.agent.pageWrite({ taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: null, action: { type: "note", noteId: crypto.randomUUID(), text: "forged" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  f.principal.permissions = ["results:read", "results:write"];
  const response = await f.agent.read({ taskId: f.taskId });
  expect("version" in response && response.version?.content.page).toBeUndefined();
  await expect(f.agent.pageRead({ taskId: f.taskId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(f.agent.publish(f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(f.agent.publish({ ...f.input, requestId: crypto.randomUUID(), expectedRevision: f.published.receipt.editRevision, content: { ...f.input.content, page: undefined } })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("response validation and cross-scope references fail atomically", async () => {
  const f = await fixture(), read = await f.owner.pageRead({ taskId: f.taskId });
  const input = { taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: read.revision, action: { type: "respond", versionId: f.published.receipt.versionId, formKey: "decision", answers: { timing: "bogus" } } };
  await expect(f.owner.pageWrite(input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(f.owner.pageRead({ taskId: f.taskId, versionId: "wrong" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const other = await seedTask(f.workspaceId);
  await expect(f.owner.pageWrite({ ...input, taskId: other.taskId, expectedRevision: null })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect(await db.workPageInput.count()).toBe(0); expect(await db.workPageCommand.count()).toBe(0);
});

test("concurrent owner drafts cannot overwrite each other; closed work preserves read history", async () => {
  const f = await fixture(), read = await f.owner.pageRead({ taskId: f.taskId });
  const write = (text: string) => f.owner.pageWrite({ taskId: f.taskId, expectedRevision: read.revision, requestId: crypto.randomUUID(), action: { type: "note", noteId: crypto.randomUUID(), text } });
  const outcomes = await Promise.allSettled([write("first"), write("second")]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
  expect(await db.workPageInput.count()).toBe(1);
  const saved = await f.owner.pageRead({ taskId: f.taskId });
  await db.task.update({ where: { id: f.taskId }, data: { status: "Done" } });
  expect((await f.owner.pageRead({ taskId: f.taskId })).canRespond).toBe(false);
  expect((await f.agent.pageRead({ taskId: f.taskId })).entries).toHaveLength(1);
  await expect(f.owner.pageWrite({ taskId: f.taskId, expectedRevision: saved.revision, requestId: crypto.randomUUID(), action: { type: "note", noteId: crypto.randomUUID(), text: "after close" } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

test("large Unicode notes paginate without dropping entries, and workspace scope cannot be crossed", async () => {
  const f = await fixture();
  let revision = (await f.owner.pageRead({ taskId: f.taskId })).revision;
  for (let i = 0; i < 7; i++) {
    await f.owner.pageWrite({ taskId: f.taskId, expectedRevision: revision, requestId: crypto.randomUUID(), action: { type: "note", noteId: crypto.randomUUID(), text: `${i}${"字".repeat(7999)}` } });
    revision = (await f.owner.pageRead({ taskId: f.taskId })).revision;
  }
  const ids: string[] = []; let offset: number | null = 0;
  while (offset !== null) {
    const page = await f.agent.pageRead({ taskId: f.taskId, offset, limit: 20 });
    expect(Buffer.byteLength(JSON.stringify(page.entries))).toBeLessThanOrEqual(80 * 1024);
    expect(page.entries.length).toBeGreaterThan(0);
    ids.push(...page.entries.map((e) => e.id)); offset = page.nextOffset;
  }
  expect(new Set(ids).size).toBe(7);
  const outsider = createTaskResultsService({ authorize: async () => ({ ...f.principal, workspaceId: "another-workspace" }) });
  await expect(outsider.pageRead({ taskId: f.taskId })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("removing a page is explicitly authorized and replay does not bypass revoked page authority", async () => {
  const f = await fixture();
  const removal = { ...f.input, requestId: crypto.randomUUID(), expectedRevision: f.published.receipt.editRevision, content: { ...f.input.content, page: undefined } };
  await f.agent.publish(removal);
  expect((await f.agent.read({ taskId: f.taskId })).version?.content.page).toBeUndefined();
  f.principal.permissions = ["results:read", "results:write"];
  await expect(f.agent.publish(removal)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
