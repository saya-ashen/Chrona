import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, resetTestDb, seedTask, seedWorkspace } from "@chrona/db";
import { withDatabaseTransaction } from "@chrona/db/db";
import { createTaskResultsService } from "./service";
import type { ResultPrincipal, TaskResultsPorts } from "./access";
import { aiArtifactRef } from "./artifact-ref";
import { deleteTask } from "../tasks/delete-task";

const baseContent = { schemaVersion: 1, outcome: { title: "A result", summary: "Work completed outside Chrona" }, readiness: { status: "ready", summary: "Source reports ready" } };
async function fixture() {
  const { workspaceId } = await seedWorkspace();
  const { taskId } = await seedTask(workspaceId);
  const principal: ResultPrincipal = { workspaceId, actorKind: "external", actorId: "external-author", permissions: ["results:read", "results:write", "results:review", "artifacts:read"] };
  let current: ResultPrincipal | null = principal;
  let available = true;
  const ports: TaskResultsPorts = { authorize: async () => current, artifactAvailable: async () => available };
  return { workspaceId, taskId, principal, ports, service: createTaskResultsService(ports), revoke: () => { current = null; }, missingFiles: () => { available = false; } };
}
const publishInput = (taskId: string, expectedRevision: string | null = null) => ({ taskId, expectedRevision, requestId: crypto.randomUUID(), content: baseContent });
const reviewInput = (taskId: string, versionId: string, expectedRevision: string, decision = "accept") => ({ taskId, versionId, expectedRevision, decision, requestId: crypto.randomUUID() });
async function rejected(call: () => unknown, code: string) { await expect(Promise.resolve().then(call)).rejects.toMatchObject({ code }); }
async function versionOf(service: ReturnType<typeof createTaskResultsService>, input: unknown) {
  const response = await service.read(input);
  if (!("version" in response) || !response.version) throw new Error("Expected a result version");
  return response.version;
}
async function occurrence(workspaceId: string, taskId: string) {
  return db.taskOccurrence.create({ data: { workspaceId, taskId, occurrenceKey: crypto.randomUUID(), source: {}, status: "Ready", eligibleAt: new Date() } });
}
async function artifact(workspaceId: string, taskId: string, occurrenceId: string | null = null) {
  const run = await db.run.create({ data: { taskId, occurrenceId, runtimeName: "debug", status: "Completed", triggeredBy: "manual" } });
  return db.artifact.create({ data: { workspaceId, taskId, occurrenceId, runId: run.id, title: "Existing artifact", type: "file", uri: "generated://fixture/report.txt" } });
}
function withFile(ref: string, required = true) { return { ...baseContent, deliverables: [{ key: "report", title: "Report", kind: "document", artifactRef: ref, required }] }; }
beforeEach(resetTestDb);
afterEach(resetTestDb);

describe("executor-independent work-result application API", () => {
  it("publishes, reads and reviews without a Plan/Run/provider or lifecycle side effects", async () => {
    const f = await fixture();
    const goal = await db.goal.create({ data: { workspaceId: f.workspaceId, title: "Closed goal", successCriteria: [], status: "Stopped" } });
    await db.task.update({ where: { id: f.taskId }, data: { goalId: goal.id, autoPlanGeneration: true, autoExecute: true } });
    const taskBefore = await db.task.findUniqueOrThrow({ where: { id: f.taskId } });
    const published = await f.service.publish({ ...publishInput(f.taskId), source: { label: "External editor", workId: "external-work-17", reportedAt: "2026-01-01T00:00:00Z" } });
    expect(published).toMatchObject({ replayed: false, receipt: { operation: "publish", version: 1, acceptedVersionId: null, executionStarted: false, taskStatusChanged: false } });
    const version = await versionOf(f.service, { taskId: f.taskId });
    expect(version).toMatchObject({ parentVersionId: null, sourceKind: "external", actorKey: "external:external-author", sourceLabel: "External editor", content: { outcome: baseContent.outcome } });
    expect(version.publishedAt.getTime()).toBeGreaterThan(new Date("2026-01-01").getTime());
    const reviewed = await f.service.review(reviewInput(f.taskId, version.id, published.receipt.editRevision));
    expect(reviewed.receipt.acceptedVersionId).toBe(version.id);
    expect(await db.task.findUniqueOrThrow({ where: { id: f.taskId } })).toEqual(taskBefore);
    expect(await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).toEqual(goal);
    expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.taskPlanRun.count(), db.executionSession.count(), db.aiFeatureRun.count(), db.triggerDelivery.count(), db.goalInboxCandidate.count()])).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const events = await db.event.findMany({ orderBy: { ingestSequence: "asc" } });
    expect(events.map((e) => e.eventType)).toEqual(["result.version_published", "result.version_reviewed"]);
    expect(events.every((e) => e.actorId === f.principal.actorId && e.runId === null)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(baseContent.outcome.summary);
  });

  it("keeps accepted content pinned while a later version waits for review", async () => {
    const f = await fixture();
    const first = await f.service.publish(publishInput(f.taskId));
    const accepted = await f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision));
    const second = await f.service.publish({ ...publishInput(f.taskId, accepted.receipt.editRevision), content: { ...baseContent, outcome: { title: "Revision two", summary: "New content" } } });
    expect(second.receipt.acceptedVersionId).toBe(first.receipt.versionId);
    expect((await versionOf(f.service, { taskId: f.taskId, selection: "accepted" })).content.outcome).toEqual(baseContent.outcome);
    const latest = await f.service.read({ taskId: f.taskId });
    expect(latest).toMatchObject({ state: { current: true, accepted: false, newerVersionPending: true, canAcceptContent: true } });
    await rejected(() => f.service.review(reviewInput(f.taskId, first.receipt.versionId, second.receipt.editRevision)), "REVISION_CONFLICT");
    const changes = await f.service.review({ ...reviewInput(f.taskId, second.receipt.versionId, second.receipt.editRevision, "request_changes"), feedback: "Please cite sources" });
    expect(changes.receipt.acceptedVersionId).toBe(first.receipt.versionId);
    expect((await versionOf(f.service, { taskId: f.taskId })).parentVersionId).toBe(first.receipt.versionId);
    const history = await f.service.read({ taskId: f.taskId, view: "reviews" });
    expect(history).toMatchObject({ reviews: { total: 1, items: [{ decision: "request_changes", feedback: "Please cite sources" }] } });
  });

  it("uses durable actor-scoped receipts and detects changed intent after service recreation", async () => {
    const f = await fixture(), input = publishInput(f.taskId);
    const first = await f.service.publish(input);
    const replay = await createTaskResultsService(f.ports).publish(input);
    expect(replay).toEqual({ ...first, replayed: true });
    await rejected(() => f.service.publish({ ...input, source: { label: "Changed intent" } }), "IDEMPOTENCY_CONFLICT");
    f.principal.actorKind = "human"; f.principal.actorId = "same-label-distinct-author";
    const next = await f.service.publish({ ...input, expectedRevision: first.receipt.editRevision });
    expect(next.receipt.version).toBe(2);
    expect(await db.resultCommand.count()).toBe(2);
    expect((await versionOf(f.service, { taskId: f.taskId })).actorKey).toBe("human:same-label-distinct-author");
  });

  it("deduplicates concurrent retries and serializes competing publications", async () => {
    const f = await fixture(), input = publishInput(f.taskId);
    const copies = await Promise.all([f.service.publish(input), f.service.publish(input)]);
    expect(new Set(copies.map((v) => v.receipt.commandId)).size).toBe(1);
    const writes = await Promise.allSettled([f.service.publish(publishInput(f.taskId, copies[0].receipt.editRevision)), f.service.publish(publishInput(f.taskId, copies[0].receipt.editRevision))]);
    expect(writes.filter((w) => w.status === "fulfilled")).toHaveLength(1);
    expect(writes.find((w) => w.status === "rejected")).toMatchObject({ reason: { code: "REVISION_CONFLICT" } });
    expect(await db.taskResultVersion.count()).toBe(2);
    expect(await db.resultCommand.count()).toBe(2);
  });

  it("serializes a publication racing a review, without accepting the wrong head", async () => {
    const f = await fixture();
    const first = await f.service.publish(publishInput(f.taskId));
    const results = await Promise.allSettled([f.service.publish(publishInput(f.taskId, first.receipt.editRevision)), f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "REVISION_CONFLICT" } });
    const result = await db.taskResult.findUniqueOrThrow({ where: { id: first.receipt.resultId } });
    expect(result.acceptedVersionId === null || result.acceptedVersionId === first.receipt.versionId).toBe(true);
  });

  it("rolls back content, head, review, event and receipt with an enclosing transaction", async () => {
    const f = await fixture();
    await expect(withDatabaseTransaction(async () => {
      const first = await f.service.publish(publishInput(f.taskId));
      await f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision));
      throw new Error("outer transaction abort");
    })).rejects.toThrow("outer transaction abort");
    expect(await Promise.all([db.taskResult.count(), db.taskResultVersion.count(), db.taskResultReview.count(), db.resultCommand.count(), db.event.count()])).toEqual([0, 0, 0, 0, 0]);
  });

  it("does not leave a version or links when receipt persistence fails", async () => {
    const f = await fixture(), file = await artifact(f.workspaceId, f.taskId);
    await db.$executeRawUnsafe("CREATE TEMP TRIGGER Fail_result_receipt BEFORE INSERT ON ResultCommand BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    try {
      await rejected(() => f.service.publish({ ...publishInput(f.taskId), content: withFile(aiArtifactRef(file.id)) }), "STORAGE_ERROR");
      expect(await Promise.all([db.taskResult.count(), db.taskResultVersion.count(), db.resultVersionArtifact.count(), db.resultCommand.count(), db.event.count()])).toEqual([0, 0, 0, 0, 0]);
      expect(await db.artifact.count()).toBe(1);
    } finally { await db.$executeRawUnsafe("DROP TRIGGER Fail_result_receipt"); }
  });

  it("rechecks authorization before replay and never treats publishing as review authority", async () => {
    const f = await fixture(); f.principal.permissions = ["results:write", "results:read"];
    const input = publishInput(f.taskId), published = await f.service.publish(input);
    await rejected(() => f.service.review(reviewInput(f.taskId, published.receipt.versionId, published.receipt.editRevision)), "FORBIDDEN");
    f.principal.permissions = ["results:read"];
    await rejected(() => f.service.publish(input), "FORBIDDEN");
    f.revoke();
    await rejected(() => f.service.read({ taskId: f.taskId }), "AUTH_REQUIRED");
    await rejected(() => f.service.publish(input), "AUTH_REQUIRED");
    expect(await db.resultCommand.count()).toBe(1);
  });

  it("isolates task, workspace, occurrence, exact-version and revision identities", async () => {
    const f = await fixture(), other = await fixture();
    const a = await occurrence(f.workspaceId, f.taskId), b = await occurrence(f.workspaceId, f.taskId);
    const first = await f.service.publish({ ...publishInput(f.taskId), occurrenceId: a.id });
    await f.service.publish({ ...publishInput(f.taskId), occurrenceId: b.id });
    expect(await f.service.read({ taskId: f.taskId })).toEqual({ result: null, version: null });
    await rejected(() => other.service.read({ taskId: f.taskId }), "NOT_FOUND");
    await rejected(() => f.service.publish({ ...publishInput(other.taskId), occurrenceId: a.id }), "NOT_FOUND");
    await rejected(() => f.service.read({ taskId: f.taskId, occurrenceId: b.id, selection: "version", versionId: first.receipt.versionId }), "NOT_FOUND");
    await rejected(() => f.service.publish({ ...publishInput(f.taskId, first.receipt.editRevision), occurrenceId: b.id }), "REVISION_CONFLICT");
    expect(await db.taskResult.count()).toBe(2);
  });

  it.each(["Done", "Cancelled"] as const)("rejects late writes/replays on %s and preserves historical reads", async (status) => {
    const f = await fixture(), input = publishInput(f.taskId), first = await f.service.publish(input);
    await db.task.update({ where: { id: f.taskId }, data: { status } });
    await rejected(() => f.service.publish(input), "PRECONDITION_FAILED");
    await rejected(() => f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision)), "PRECONDITION_FAILED");
    expect((await versionOf(f.service, { taskId: f.taskId })).id).toBe(first.receipt.versionId);
    expect(await db.resultCommand.count()).toBe(1);
  });

  it("allows Completed task contributions without changing Completed to Done", async () => {
    const f = await fixture(); await db.task.update({ where: { id: f.taskId }, data: { status: "Completed" } });
    const first = await f.service.publish(publishInput(f.taskId));
    await f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision));
    expect((await db.task.findUniqueOrThrow({ where: { id: f.taskId } })).status).toBe("Completed");
  });

  it("does not resurrect deleted work through a receipt", async () => {
    const f = await fixture(), input = publishInput(f.taskId);
    await f.service.publish(input);
    await db.task.delete({ where: { id: f.taskId } });
    await rejected(() => f.service.publish(input), "NOT_FOUND");
    expect(await Promise.all([db.taskResult.count(), db.taskResultVersion.count(), db.resultCommand.count()])).toEqual([0, 0, 0]);
  });

  it("preserves the explicit task deletion lifecycle for reviewed results with existing artifacts", async () => {
    const f = await fixture(), file = await artifact(f.workspaceId, f.taskId);
    const first = await f.service.publish({ ...publishInput(f.taskId), content: withFile(aiArtifactRef(file.id)) });
    const accepted = await f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision));
    await f.service.publish({ ...publishInput(f.taskId, accepted.receipt.editRevision), content: withFile(aiArtifactRef(file.id)) });
    await deleteTask(f.taskId, { expectedTaskIds: [f.taskId], expectedAssetIds: [] });
    expect(await Promise.all([db.taskResult.count(), db.taskResultVersion.count(), db.taskResultReview.count(), db.resultCommand.count(), db.resultVersionArtifact.count(), db.artifact.count()])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it.each(["partial", "blocked"])("does not accept source readiness %s", async (status) => {
    const f = await fixture();
    const first = await f.service.publish({ ...publishInput(f.taskId), content: { ...baseContent, readiness: { status, summary: "Incomplete" } } });
    await rejected(() => f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision)), "PRECONDITION_FAILED");
    expect(await db.taskResultReview.count()).toBe(0);
  });

  it("rejects forged identity and UTF-8 oversize requests before any write", async () => {
    const f = await fixture();
    await rejected(() => f.service.publish({ ...publishInput(f.taskId), actorKind: "managed", runId: "invented" }), "VALIDATION_ERROR");
    const findings = Array.from({ length: 5 }, (_, n) => ({ key: `finding-${n}`, content: "研".repeat(8_000) }));
    await rejected(() => f.service.publish({ ...publishInput(f.taskId), content: { ...baseContent, findings } }), "VALIDATION_ERROR");
    expect(await db.taskResult.count()).toBe(0);
  });

  it("bounds review pagination without truncating stored feedback or skipping rows", async () => {
    const f = await fixture(), first = await f.service.publish(publishInput(f.taskId));
    let revision = first.receipt.editRevision;
    for (let n = 0; n < 8; n++) {
      const review = await f.service.review({ ...reviewInput(f.taskId, first.receipt.versionId, revision, "request_changes"), feedback: "研".repeat(8_000) });
      revision = review.receipt.editRevision;
    }
    let offset = 0;
    const ids: string[] = [];
    const revisions: number[] = [];
    while (ids.length < 8) {
      const response = await f.service.read({ taskId: f.taskId, view: "reviews", offset, limit: 20 });
      if (!("reviews" in response) || !response.reviews) throw new Error("Expected reviews");
      expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(128 * 1024);
      for (const item of response.reviews.items) { ids.push(item.id); revisions.push(item.revision); expect(item.feedback).toHaveLength(8_000); }
      if (response.reviews.nextOffset === null) break;
      offset = response.reviews.nextOffset;
    }
    expect(new Set(ids).size).toBe(8);
    expect(revisions).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
  });

  it("requires authorized, verified same-scope artifacts and binds them atomically", async () => {
    const f = await fixture(), other = await fixture();
    const file = await artifact(f.workspaceId, f.taskId), foreign = await artifact(other.workspaceId, other.taskId);
    await rejected(() => f.service.publish({ ...publishInput(f.taskId), content: withFile(aiArtifactRef(foreign.id)) }), "NOT_FOUND");
    const unconfigured = createTaskResultsService({ authorize: f.ports.authorize });
    await rejected(() => unconfigured.publish({ ...publishInput(f.taskId), content: withFile(aiArtifactRef(file.id)) }), "PRECONDITION_FAILED");
    f.principal.permissions = ["results:write", "results:read", "results:review"];
    await rejected(() => f.service.publish({ ...publishInput(f.taskId), content: withFile(aiArtifactRef(file.id)) }), "FORBIDDEN");
    f.principal.permissions = [...f.principal.permissions, "artifacts:read"];
    const first = await f.service.publish({ ...publishInput(f.taskId), content: withFile(aiArtifactRef(file.id)) });
    expect(await db.resultVersionArtifact.findFirst()).toMatchObject({ versionId: first.receipt.versionId, artifactId: file.id, key: "report", role: "deliverable", required: true });
    f.missingFiles();
    await rejected(() => f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision)), "PRECONDITION_FAILED");
    expect(await f.service.read({ taskId: f.taskId })).toMatchObject({ state: { canAcceptContent: false }, unavailableRequiredArtifacts: [aiArtifactRef(file.id)] });
    expect(await db.taskResultReview.count()).toBe(0);
  });

  it("detects changed artifact identity/metadata instead of silently reusing different bytes", async () => {
    const f = await fixture(), file = await artifact(f.workspaceId, f.taskId);
    const first = await f.service.publish({ ...publishInput(f.taskId), content: withFile(aiArtifactRef(file.id)) });
    await db.artifact.update({ where: { id: file.id }, data: { uri: "generated://fixture/replacement.txt" } });
    await rejected(() => f.service.review(reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision)), "PRECONDITION_FAILED");
    const read = await f.service.read({ taskId: f.taskId });
    expect(read).toMatchObject({ unavailableRequiredArtifacts: [aiArtifactRef(file.id)] });
    expect(JSON.stringify(read)).not.toContain("generated://");
    expect(await db.taskResultVersion.count()).toBe(1);
  });

  it("persists review receipts and does not append another review when retried", async () => {
    const f = await fixture(), first = await f.service.publish(publishInput(f.taskId));
    const input = reviewInput(f.taskId, first.receipt.versionId, first.receipt.editRevision);
    const accepted = await f.service.review(input);
    expect(await createTaskResultsService(f.ports).review(input)).toEqual({ ...accepted, replayed: true });
    await rejected(() => f.service.review({ ...input, decision: "reject" }), "IDEMPOTENCY_CONFLICT");
    expect(await db.taskResultReview.count()).toBe(1);
  });

  it("rejects an artifact from a sibling occurrence and forbids edits to sealed versions/links", async () => {
    const f = await fixture();
    const a = await occurrence(f.workspaceId, f.taskId), b = await occurrence(f.workspaceId, f.taskId), file = await artifact(f.workspaceId, f.taskId, a.id);
    await rejected(() => f.service.publish({ ...publishInput(f.taskId), occurrenceId: b.id, content: withFile(aiArtifactRef(file.id)) }), "NOT_FOUND");
    const first = await f.service.publish({ ...publishInput(f.taskId), occurrenceId: a.id, content: withFile(aiArtifactRef(file.id)) });
    await expect(Promise.resolve(db.taskResultVersion.update({ where: { id: first.receipt.versionId }, data: { content: {} } }))).rejects.toThrow();
    await expect(Promise.resolve(db.resultVersionArtifact.deleteMany({ where: { versionId: first.receipt.versionId } }))).rejects.toThrow();
    await expect(Promise.resolve(db.resultVersionArtifact.create({ data: { versionId: first.receipt.versionId, artifactId: file.id, artifactRef: aiArtifactRef(file.id), artifactFingerprint: "0".repeat(64), key: "late", role: "deliverable" } }))).rejects.toThrow();
    expect(await db.resultVersionArtifact.count()).toBe(1);
    await db.taskResult.delete({ where: { id: first.receipt.resultId } });
    expect(await db.resultVersionArtifact.count()).toBe(0);
  });
});
