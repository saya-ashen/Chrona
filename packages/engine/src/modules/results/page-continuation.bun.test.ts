import { afterEach, beforeEach, expect, test } from "bun:test";
import { db, resetTestDb, seedTask, seedWorkspace } from "@chrona/db";
import { exampleWorkPage } from "@chrona/ui-protocol/work-pages/example";
import { createLocalTaskResultsService } from "./local-owner";
import { createTaskResultsService } from "./service";
import type { ResultPrincipal } from "./access";
const keys = ["CHRONA_WORK_PAGES_WRITES_ENABLED", "CHRONA_RESULT_WRITES_ENABLED"] as const;
const old = keys.map((k) => process.env[k]);
beforeEach(async () => { await resetTestDb(); keys.forEach((k) => process.env[k] = "true"); });
afterEach(async () => { await resetTestDb(); keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); });
async function fixture() {
  const { workspaceId } = await seedWorkspace(), { taskId } = await seedTask(workspaceId);
  await db.task.update({ where: { id: taskId }, data: { taskExecutionMode: "manual", autoPlanGeneration: false, autoExecute: false } });
  const principal: ResultPrincipal = { workspaceId, actorKind: "external", actorId: "author", permissions: ["results:read", "results:write", "pages:read", "pages:write"] };
  const agent = createTaskResultsService({ authorize: async () => principal }), owner = createLocalTaskResultsService(async () => true);
  const content = { schemaVersion: 1, outcome: { title: "Computer", summary: "Discuss first" }, readiness: { status: "partial", summary: "Not purchased" }, page: exampleWorkPage };
  const published = await agent.publish({ taskId, requestId: crypto.randomUUID(), expectedRevision: null, content });
  async function save(action: unknown) { const input = await owner.pageRead({ taskId }); return owner.pageWrite({ taskId, requestId: crypto.randomUUID(), expectedRevision: input.revision, action }); }
  return { taskId, workspaceId, agent, owner, principal, content, published, save };
}
test("fresh Agent reads frozen feedback with original form identity; reports do not swallow later edits, accept or execute", async () => {
  const f = await fixture(), before = await db.task.findUniqueOrThrow({ where: { id: f.taskId } }), noteId = crypto.randomUUID();
  await f.save({ type: "note", noteId, text: "Obsolete first draft" });
  await f.save({ type: "note", noteId, text: "Parents prefer a quiet computer" });
  await f.save({ type: "respond", versionId: f.published.receipt.versionId, formKey: "decision", answers: { timing: "wait", budget: 8000 } });
  await f.save({ type: "handoff", versionId: f.published.receipt.versionId, text: "Adjust to 8000. Do not buy." });
  const snapshot = await f.agent.pageRead({ taskId: f.taskId, view: "handoff", limit: 1 });
  expect(snapshot.total).toBe(2); expect(snapshot.nextOffset).toBe(1); expect(snapshot.handoff?.unaddressedCount).toBe(2);
  expect(snapshot.entries[0].content.text).toBe("Parents prefer a quiet computer");
  const request = snapshot.handoff!.request;
  await f.save({ type: "note", noteId, text: "Changed later: must be small too" });
  const page2 = await f.agent.pageRead({ taskId: f.taskId, view: "handoff", requestId: request.id, offset: 1 });
  expect(page2.entries[0]).toMatchObject({ versionId: f.published.receipt.versionId, formKey: "decision", content: { answers: { budget: 8000 } } });
  expect(page2.handoff?.newInputCount).toBe(1);
  const base = await f.agent.read({ taskId: f.taskId, selection: "version", versionId: page2.handoff!.baseVersionId });
  expect("version" in base && base.version?.content.page?.forms.decision.fields.length).toBeGreaterThan(0);
  const plain = await f.agent.publish({ taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: f.published.receipt.editRevision, content: f.content });
  expect((await f.agent.pageRead({ taskId: f.taskId, view: "handoff" })).handoff?.latestReport).toBeNull();
  const continuation = { requestId: request.id, baseVersionId: request.versionId, summary: "Quieter parts within budget", changes: ["Changed the cooler"], feedback: [{ entryId: snapshot.entries[0].id, disposition: "incorporated", explanation: "Selected a quieter cooler" }, { entryId: page2.entries[0].id, disposition: "needs_clarification", explanation: "Does budget include the monitor?" }] };
  const publication = { taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: plain.receipt.editRevision, content: { ...f.content, continuation } };
  const updated = await f.agent.publish(publication);
  expect(await f.agent.publish(publication)).toEqual({ ...updated, replayed: true });
  const after = await f.agent.pageRead({ taskId: f.taskId, view: "handoff" });
  expect(after.handoff).toMatchObject({ newInputCount: 1, unaddressedCount: 1, latestReport: { version: 3, versionId: updated.receipt.versionId } });
  expect(after.entries[0].content.text).toBe("Parents prefer a quiet computer");
  expect((await f.owner.pageRead({ taskId: f.taskId, kind: "note" })).entries[0].content.text).toContain("Changed later");
  await f.save({ type: "handoff", versionId: updated.receipt.versionId, text: "Now consider the size" });
  expect((await f.agent.pageRead({ taskId: f.taskId, view: "handoff" })).handoff?.latestReport).toBeNull();
  expect((await f.agent.pageRead({ taskId: f.taskId, view: "handoff", requestId: request.id })).handoff?.latestReport?.version).toBe(3);
  expect(await db.task.findUniqueOrThrow({ where: { id: f.taskId } })).toEqual(before);
  expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.executionSession.count(), db.workBlock.count(), db.taskResultReview.count()])).toEqual([0, 0, 0, 0, 0]);
  expect((await db.taskResult.findFirstOrThrow()).acceptedVersionId).toBeNull();
});

test("snapshot references reject stale, future, duplicate, other-request and cross-task feedback atomically", async () => {
  const f = await fixture(), noteId = crypto.randomUUID();
  await f.save({ type: "note", noteId, text: "old" });
  const stale = (await f.owner.pageRead({ taskId: f.taskId })).entries[0];
  await f.save({ type: "note", noteId, text: "current" });
  await f.save({ type: "handoff", versionId: f.published.receipt.versionId, text: "revise" });
  const snapshot = await f.agent.pageRead({ taskId: f.taskId, view: "handoff" });
  await f.save({ type: "note", noteId, text: "future" });
  const future = (await f.owner.pageRead({ taskId: f.taskId, kind: "note" })).entries[0];
  for (const id of [stale.id, future.id, snapshot.handoff!.request.id, "foreign-input"]) {
    await expect(f.agent.publish({ taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: f.published.receipt.editRevision, content: { ...f.content, continuation: { requestId: snapshot.handoff!.request.id, baseVersionId: f.published.receipt.versionId, summary: "changed", changes: ["one"], feedback: [{ entryId: id, disposition: "incorporated", explanation: "claimed" }] } } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }
  const other = await seedTask(f.workspaceId);
  await expect(f.agent.pageRead({ taskId: other.taskId, view: "handoff", requestId: snapshot.handoff!.request.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(() => f.agent.pageRead({ taskId: f.taskId, view: "current", requestId: snapshot.handoff!.request.id })).toThrow("Invalid or oversized work-result request");
  expect(await db.taskResultVersion.count()).toBe(1);
});

test("handoff CAS, original replay, latest page guard, owner-only authority and write gates", async () => {
  const f = await fixture(), read = await f.owner.pageRead({ taskId: f.taskId });
  const input = { taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: read.revision, action: { type: "handoff", versionId: f.published.receipt.versionId, text: "Continue" } };
  await expect(f.agent.pageWrite(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const saved = await f.owner.pageWrite(input); expect(await f.owner.pageWrite(input)).toEqual({ ...saved, replayed: true });
  await expect(f.owner.pageWrite({ ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await expect(f.owner.pageWrite({ ...input, action: { ...input.action, text: "different" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await f.agent.publish({ taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: f.published.receipt.editRevision, content: f.content });
  await expect(f.save(input.action)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  process.env.CHRONA_WORK_PAGES_WRITES_ENABLED = "false";
  await expect(f.owner.pageWrite(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await f.owner.pageRead({ taskId: f.taskId, view: "handoff" })).canRespond).toBe(false);
  process.env.CHRONA_WORK_PAGES_WRITES_ENABLED = "true";
  await db.task.update({ where: { id: f.taskId }, data: { status: "Done" } });
  await expect(f.owner.pageWrite(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await f.owner.pageRead({ taskId: f.taskId, view: "handoff" })).handoff?.request.content.text).toBe("Continue");
});

test("private continuation without a page is hidden from legacy readers; authoring, removal and replay still require page permission", async () => {
  const f = await fixture(); await f.save({ type: "handoff", versionId: f.published.receipt.versionId, text: "Private request" });
  const snapshot = await f.owner.pageRead({ taskId: f.taskId, view: "handoff" });
  const continuation = { requestId: snapshot.handoff!.request.id, baseVersionId: f.published.receipt.versionId, summary: "Private report", changes: ["change"], feedback: [] };
  const input = { taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: f.published.receipt.editRevision, content: { ...f.content, page: undefined, continuation } };
  const report = await f.agent.publish(input);
  f.principal.permissions = ["results:read", "results:write"];
  const hidden = await f.agent.read({ taskId: f.taskId });
  expect(JSON.stringify(hidden)).not.toContain("Private report"); expect(JSON.stringify(hidden)).not.toContain(continuation.requestId);
  await expect(f.agent.publish(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const removal = { ...input, requestId: crypto.randomUUID(), expectedRevision: report.receipt.editRevision, content: { ...f.content, page: undefined } };
  await expect(f.agent.publish(removal)).rejects.toMatchObject({ code: "FORBIDDEN" });
  f.principal.permissions = [...f.principal.permissions, "pages:read", "pages:write"]; await f.agent.publish(removal);
  f.principal.permissions = ["results:read", "results:write"];
  await expect(f.agent.publish(removal)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("unicode handoff pagination is bounded, exact and makes progress", async () => {
  const f = await fixture();
  for (let i = 0; i < 6; i++) await f.save({ type: "note", noteId: crypto.randomUUID(), text: `${i}${"汉".repeat(7999)}` });
  await f.save({ type: "handoff", versionId: f.published.receipt.versionId, text: "Read all notes" });
  const ids: string[] = []; let offset = 0;
  for (;;) {
    const page = await f.agent.pageRead({ taskId: f.taskId, view: "handoff", offset, limit: 20 });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(128 * 1024); expect(page.entries.length).toBeGreaterThan(0);
    ids.push(...page.entries.map((e) => e.id)); if (page.nextOffset === null) break; expect(page.nextOffset).toBeGreaterThan(offset); offset = page.nextOffset;
  }
  expect(new Set(ids).size).toBe(6);
});
