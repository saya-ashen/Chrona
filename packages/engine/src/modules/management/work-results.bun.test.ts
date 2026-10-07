import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, resetTestDb, seedTask } from "@chrona/db";
import { withDatabaseTransaction } from "@chrona/db/db";
import { MANAGEMENT_ACCESS_PRESETS, type ManagementAccessPreset } from "@chrona/contracts/api";
import { createChronaEngine } from "../../engine";
import { createManagementClient, requireManagementClient, revokeManagementClient } from "./clients";
import { callManagementWorkResult } from "./work-results";

const previousEnabled = process.env.CHRONA_RESULT_WRITES_ENABLED;
const content = { schemaVersion: 1, outcome: { title: "Research result", summary: "A contributor's findings" }, readiness: { status: "ready", summary: "Reported ready" } };
const input = (taskId: string, expectedRevision: string | null = null) => ({ taskId, expectedRevision, requestId: crypto.randomUUID(), content });
const engine = createChronaEngine();
async function client(access: ManagementAccessPreset = "results-submit") {
  const created = await createManagementClient({ name: access, publicUrl: "http://localhost:3101", scopes: [...MANAGEMENT_ACCESS_PRESETS[access]] });
  return requireManagementClient(created.token);
}
function data(value: unknown): Record<string, any> { return value as Record<string, any>; }
async function fixture() {
  const writer = await client(), reviewer = await client("results-review");
  const { taskId } = await seedTask(writer.workspaceId);
  await db.task.update({ where: { id: taskId }, data: { taskExecutionMode: "manual", autoPlanGeneration: false, autoExecute: false } });
  return { writer, reviewer, taskId };
}
const call = async (identity: Awaited<ReturnType<typeof client>>, name: string, raw: unknown) => data(await engine.management.call(identity, name, raw));
beforeEach(async () => { await resetTestDb(); process.env.CHRONA_RESULT_WRITES_ENABLED = "true"; });
afterEach(async () => { await resetTestDb(); if (previousEnabled === undefined) delete process.env.CHRONA_RESULT_WRITES_ENABLED; else process.env.CHRONA_RESULT_WRITES_ENABLED = previousEnabled; });

describe("scoped management work-result entries", () => {
  it("publishes and reviews with separate actors and no managed-execution side effects", async () => {
    const f = await fixture(), taskBefore = await db.task.findUniqueOrThrow({ where: { id: f.taskId } });
    const created = await call(f.writer, "chrona_result_submit", { ...input(f.taskId), source: { label: "Untrusted author label", workId: "source-1" } });
    expect(created.ok).toBe(true);
    const receipt = created.data.receipt;
    expect(receipt).toMatchObject({ operation: "publish", version: 1, executionStarted: false, taskStatusChanged: false });
    const read = await call(f.writer, "chrona_result_read", { taskId: f.taskId });
    expect(read.data.version).toMatchObject({ actorKey: `external:${f.writer.id}`, sourceKind: "external", sourceLabel: "Untrusted author label" });
    const review = { taskId: f.taskId, requestId: crypto.randomUUID(), versionId: receipt.versionId, expectedRevision: receipt.editRevision, decision: "accept" };
    expect((await call(f.writer, "chrona_result_review", review)).error.code).toBe("FORBIDDEN");
    const accepted = await call(f.reviewer, "chrona_result_review", review);
    expect(accepted.data.receipt.acceptedVersionId).toBe(receipt.versionId);
    expect(await db.taskResultReview.findFirst()).toMatchObject({ actorKey: `external:${f.reviewer.id}` });
    expect(await db.task.findUniqueOrThrow({ where: { id: f.taskId } })).toEqual(taskBefore);
    expect({ runs: await db.run.count(), plans: await db.taskPlan.count(), planRuns: await db.taskPlanRun.count(), sessions: await db.executionSession.count(), ai: await db.aiFeatureRun.count(), deliveries: await db.triggerDelivery.count(), inbox: await db.goalInboxCandidate.count(), managementCommands: await db.managementCommand.count() }).toEqual({ runs: 0, plans: 0, planRuns: 0, sessions: 0, ai: 0, deliveries: 0, inbox: 0, managementCommands: 0 });
    expect(await db.resultCommand.count()).toBe(2);
    expect((await db.event.findMany()).map((e) => e.eventType)).toEqual(["result.version_published", "result.version_reviewed"]);
  });

  it("keeps immutable accepted content and ordered feedback after a new publication", async () => {
    const f = await fixture();
    const first = (await call(f.writer, "chrona_result_submit", input(f.taskId))).data.receipt;
    const accepted = (await call(f.reviewer, "chrona_result_review", { taskId: f.taskId, requestId: crypto.randomUUID(), versionId: first.versionId, expectedRevision: first.editRevision, decision: "accept" })).data.receipt;
    const next = (await call(f.writer, "chrona_result_submit", { ...input(f.taskId, accepted.editRevision), content: { ...content, outcome: { title: "New version", summary: "Not accepted" } } })).data.receipt;
    expect((await call(f.writer, "chrona_result_read", { taskId: f.taskId, selection: "accepted" })).data.version.id).toBe(first.versionId);
    const feedback = await call(f.reviewer, "chrona_result_review", { taskId: f.taskId, requestId: crypto.randomUUID(), versionId: next.versionId, expectedRevision: next.editRevision, decision: "request_changes", feedback: "Check the source" });
    const reviews = await call(f.writer, "chrona_result_read", { taskId: f.taskId, view: "reviews" });
    expect(reviews.data.reviews.items[0]).toMatchObject({ decision: "request_changes", feedback: "Check the source" });
    expect(feedback.data.receipt.acceptedVersionId).toBe(first.versionId);
    const stale = await call(f.reviewer, "chrona_result_review", { taskId: f.taskId, requestId: crypto.randomUUID(), versionId: first.versionId, expectedRevision: feedback.data.receipt.editRevision, decision: "accept" });
    expect(stale.error.code).toBe("REVISION_CONFLICT");
  });

  it("does not widen legacy presets, give writers lifecycle control or give reviewers publish rights", async () => {
    const f = await fixture();
    for (const preset of ["read", "full", "assistant-read", "assistant", "assistant-edit"] as const) {
      const legacy = await client(preset);
      expect((await call(legacy, "chrona_result_read", { taskId: f.taskId })).error.code).toBe("FORBIDDEN");
      expect((await call(legacy, "chrona_result_submit", input(f.taskId))).error.code).toBe("FORBIDDEN");
    }
    expect((await call(f.reviewer, "chrona_result_submit", input(f.taskId))).error.code).toBe("FORBIDDEN");
    expect((await call(await client("results-read"), "chrona_result_submit", input(f.taskId))).error.code).toBe("FORBIDDEN");
    expect((await call(f.writer, "chrona_task_create", { requestId: crypto.randomUUID(), title: "Escalation", mode: "todo" })).error.code).toBe("FORBIDDEN");
    expect((await call(f.writer, "chrona_task_action", { taskId: f.taskId, requestId: crypto.randomUUID(), action: { type: "accept_result", runId: "fake" } })).error.code).toBe("FORBIDDEN");
    expect(await db.resultCommand.count()).toBe(0);
  });

  it("rejects incomplete scope enrollment without issuing a client", async () => {
    for (const scopes of [["tasks:read", "results:write"], ["goals:read", "results:read"], ["tasks:read", "results:review"]] as const) {
      await expect(createManagementClient({ name: "Invalid scope", publicUrl: "http://localhost:3101", scopes: [...scopes] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(await db.managementClient.count()).toBe(0);
  });

  it("serializes duplicate requests, replays across service reconstruction and rejects changed payloads", async () => {
    const f = await fixture(), args = input(f.taskId);
    const replies = await Promise.all(Array.from({ length: 3 }, () => call(f.writer, "chrona_result_submit", args)));
    expect(replies.every((r) => r.ok)).toBe(true);
    expect(new Set(replies.map((r) => r.data.receipt.commandId)).size).toBe(1);
    const replay = data(await createChronaEngine().management.call(f.writer, "chrona_result_submit", args));
    expect(replay.data).toEqual({ replayed: true, receipt: replies[0].data.receipt });
    expect((await call(f.writer, "chrona_result_submit", { ...args, source: { label: "Changed" } })).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await db.resultCommand.count()).toBe(1);
    expect(await db.taskResultVersion.count()).toBe(1);
  });

  it("refreshes authorization inside the shared transaction and before replay", async () => {
    const f = await fixture(), args = input(f.taskId);
    expect((await call(f.writer, "chrona_result_submit", args)).ok).toBe(true);
    await withDatabaseTransaction(async () => {
      await db.managementClient.update({ where: { id: f.writer.id }, data: { scopes: ["tasks:read", "results:read"] } });
      await expect(callManagementWorkResult(f.writer, "chrona_result_submit", args)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    await revokeManagementClient(f.writer.id);
    expect((await call(f.writer, "chrona_result_read", { taskId: f.taskId })).error.code).toBe("AUTH_REQUIRED");
    expect((await call(f.writer, "chrona_result_submit", args)).error.code).toBe("AUTH_REQUIRED");
    expect(await db.resultCommand.count()).toBe(1);
  });

  it("rejects cross-workspace/occurrence reads and late writes against closed or deleted tasks", async () => {
    const f = await fixture(), args = input(f.taskId);
    const first = (await call(f.writer, "chrona_result_submit", args)).data.receipt;
    const foreign = await db.workspace.create({ data: { name: "Foreign", status: "Active" } });
    const { taskId: foreignTask } = await seedTask(foreign.id);
    expect((await call(f.writer, "chrona_result_submit", input(foreignTask))).error.code).toBe("NOT_FOUND");
    expect((await call(f.writer, "chrona_result_read", { taskId: foreignTask })).error.code).toBe("NOT_FOUND");
    const occurrence = await db.taskOccurrence.create({ data: { workspaceId: f.writer.workspaceId, taskId: f.taskId, occurrenceKey: "separate", source: {}, status: "Ready", eligibleAt: new Date() } });
    expect((await call(f.writer, "chrona_result_read", { taskId: f.taskId, occurrenceId: occurrence.id, selection: "version", versionId: first.versionId })).error.code).toBe("NOT_FOUND");
    await db.task.update({ where: { id: f.taskId }, data: { status: "Cancelled" } });
    expect((await call(f.writer, "chrona_result_submit", args)).error.code).toBe("PRECONDITION_FAILED");
    await db.task.delete({ where: { id: f.taskId } });
    expect((await call(f.writer, "chrona_result_submit", args)).error.code).toBe("NOT_FOUND");
    expect(await db.taskResult.count()).toBe(0);
  });

  it("exposes truthful capabilities; the default-off write switch preserves reads and blocks replay", async () => {
    const f = await fixture(), args = input(f.taskId);
    await call(f.writer, "chrona_result_submit", args);
    const context = await call(f.writer, "chrona_context_read", {});
    expect(context.data.capabilities.workResults).toMatchObject({ canRead: true, canSubmit: true, canReview: false, uploads: false, artifactBytes: false, artifactLinking: false, providerRequired: false, goalInbox: false });
    for (const value of [undefined, "false", "1", "TRUE"]) {
      if (value === undefined) delete process.env.CHRONA_RESULT_WRITES_ENABLED; else process.env.CHRONA_RESULT_WRITES_ENABLED = value;
      expect((await call(f.writer, "chrona_result_submit", args)).error.code).toBe("PRECONDITION_FAILED");
      expect((await call(f.writer, "chrona_result_read", { taskId: f.taskId })).ok).toBe(true);
      expect((await call(f.writer, "chrona_context_read", {})).data.capabilities.workResults).toMatchObject({ writesEnabled: false, canRead: true, canSubmit: false });
    }
  });

  it("rejects authority injection and unimplemented files without writing a result", async () => {
    const f = await fixture();
    for (const extra of [{ actorId: "owner" }, { workspaceId: "foreign" }, { runId: "fake" }, { status: "Completed" }, { accept: true }, { source: { actorKind: "human" } }]) {
      expect((await call(f.writer, "chrona_result_submit", { ...input(f.taskId), ...extra })).error.code).toBe("VALIDATION_ERROR");
    }
    const withFile = { ...content, deliverables: [{ key: "f", title: "File", kind: "document", artifactRef: "AF000000000001", presentation: { primary: "file", allowDownload: true } }] };
    expect((await call(f.writer, "chrona_result_submit", { ...input(f.taskId), content: withFile })).error.code).toBe("FORBIDDEN");
    expect(await db.taskResult.count()).toBe(0);
    expect(await db.resultCommand.count()).toBe(0);
  });

  it("uses the 96 KiB result budget without widening the legacy 64 KiB limit", async () => {
    const f = await fixture();
    const findings = Array.from({ length: 12 }, (_, i) => ({ key: `f${i}`, content: "x".repeat(6_000) }));
    const large = { ...input(f.taskId), content: { ...content, findings } };
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(65_536);
    expect((await call(f.writer, "chrona_result_submit", large)).ok).toBe(true);
    const read = await call(f.writer, "chrona_result_read", { taskId: f.taskId });
    expect(read.data.version.content.findings).toHaveLength(12);
    expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThan(128 * 1024);
    expect((await call(f.writer, "chrona_result_submit", { ...large, content: { ...content, findings: [...findings, ...findings.map((f) => ({ ...f, key: `${f.key}z` }))] } })).error.code).toBe("VALIDATION_ERROR");
    expect((await call(f.writer, "chrona_task_create", { requestId: crypto.randomUUID(), title: "Budget", mode: "todo", description: "x".repeat(70_000) })).error.message).toContain("request budget");
  });
});
