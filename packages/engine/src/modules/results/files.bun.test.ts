import { afterEach, beforeEach, expect, it } from "bun:test";
import { db, resetTestDb, seedWorkspace, seedTask } from "@chrona/db";
import { withDatabaseTransaction } from "@chrona/db/db";
import { RESULT_FILE_CHUNK_BYTES, type ResultUploadStatus, type ResultFileRead } from "@chrona/contracts/results";
import { createLocalTaskResultsService } from "./local-owner";
import { createTaskResultsService } from "./service";
import { fileHash, resultFileAvailable } from "./file-storage";
import type { ResultPrincipal } from "./access";
import { deleteTask } from "../tasks/delete-task";

const prior = process.env.CHRONA_RESULT_WRITES_ENABLED;
beforeEach(async () => { await resetTestDb(); process.env.CHRONA_RESULT_WRITES_ENABLED = "true"; });
afterEach(async () => { await resetTestDb(); if (prior === undefined) delete process.env.CHRONA_RESULT_WRITES_ENABLED; else process.env.CHRONA_RESULT_WRITES_ENABLED = prior; });
async function fixture() {
  const { workspaceId } = await seedWorkspace(), { taskId } = await seedTask(workspaceId);
  const service = createLocalTaskResultsService(async () => true);
  const data = Buffer.alloc(RESULT_FILE_CHUNK_BYTES + 7, "x");
  const begin = { taskId, action: { type: "begin", requestId: crypto.randomUUID(), filename: "report.html", mimeType: "text/html", sizeBytes: data.length, sha256: fileHash(data) } };
  const file = async (action: object, scope = { taskId }) => await service.file({ ...scope, action }) as ResultUploadStatus;
  const write = (uploadId: string, offset: number, bytes = data.subarray(offset, offset + RESULT_FILE_CHUNK_BYTES)) => file({ type: "write", uploadId, offset, sha256: fileHash(bytes), base64: bytes.toString("base64") });
  return { workspaceId, taskId, service, data, begin, file, write };
}
async function upload(f: Awaited<ReturnType<typeof fixture>>) {
  const begun = await f.service.file(f.begin) as ResultUploadStatus;
  await f.write(begun.uploadId, 0); await f.write(begun.uploadId, RESULT_FILE_CHUNK_BYTES);
  return f.file({ type: "finish", uploadId: begun.uploadId });
}
async function publish(f: Awaited<ReturnType<typeof fixture>>, completed: ResultUploadStatus) {
  return f.service.publish({ taskId: f.taskId, requestId: crypto.randomUUID(), expectedRevision: completed.editRevision,
    content: { schemaVersion: 1, outcome: { title: "Report", summary: "External result" }, readiness: { status: "ready", summary: "Source report" },
      deliverables: [{ key: "report", title: "Report", kind: "document", artifactRef: completed.artifactRef }] } });
}
it("finalizes private bytes without Run, publishes, reviews and downloads exact version; retries survive service recreation", async () => {
  const f = await fixture(), completed = await upload(f);
  expect(completed).toMatchObject({ status: "completed", artifactAvailable: true });
  expect(await createLocalTaskResultsService(async () => true).file(f.begin)).toEqual(completed);
  expect(await f.file({ type: "finish", uploadId: completed.uploadId })).toEqual(completed);
  expect(await f.write(completed.uploadId, 0)).toEqual(completed);
  const artifact = await db.artifact.findFirstOrThrow();
  expect(artifact).toMatchObject({ ownerKind: "result", runId: null, resultId: completed.resultId });
  expect(await db.resultFileChunk.count()).toBe(0);
  await expect(f.file({ type: "read", versionId: "no-version", artifactRef: completed.artifactRef })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const first = await publish(f, completed);
  await f.service.review({ taskId: f.taskId, versionId: first.receipt.versionId, expectedRevision: first.receipt.editRevision, requestId: crypto.randomUUID(), decision: "accept" });
  const chunks: Buffer[] = []; let offset: number | null = 0;
  while (offset !== null) {
    const page = await f.service.file({ taskId: f.taskId, action: { type: "read", versionId: first.receipt.versionId, artifactRef: completed.artifactRef, offset } }) as ResultFileRead;
    expect(page.sha256).toBe(fileHash(f.data)); chunks.push(Buffer.from(page.base64, "base64")); offset = page.nextOffset;
  }
  expect(Buffer.concat(chunks)).toEqual(f.data);
  expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.executionSession.count(), db.goalInboxCandidate.count()])).toEqual([0, 0, 0, 0]);
  expect(await f.service.read({ taskId: f.taskId })).toMatchObject({ state: { accepted: true }, unavailableRequiredArtifacts: [] });
  await deleteTask(f.taskId, { expectedTaskIds: [f.taskId], expectedAssetIds: [] });
  expect(await Promise.all([db.artifact.count(), db.resultArtifactBytes.count(), db.resultFileUpload.count()])).toEqual([0, 0, 0]);
});
it("enforces chunk boundaries, hashes and idempotent intent without advancing invalid input", async () => {
  const f = await fixture(), begun = await f.service.file(f.begin) as ResultUploadStatus;
  await expect(f.service.file({ ...f.begin, action: { ...f.begin.action, filename: "different" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(f.file({ type: "finish", uploadId: begun.uploadId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(f.write(begun.uploadId, 1)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(f.write(begun.uploadId, RESULT_FILE_CHUNK_BYTES)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(f.file({ type: "write", uploadId: begun.uploadId, offset: 0, sha256: "0".repeat(64), base64: f.data.subarray(0, RESULT_FILE_CHUNK_BYTES).toString("base64") })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const first = await f.write(begun.uploadId, 0);
  expect(await f.write(begun.uploadId, 0)).toEqual(first);
  await expect(f.write(begun.uploadId, 0, Buffer.alloc(RESULT_FILE_CHUNK_BYTES, "y"))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect((await f.file({ type: "status", uploadId: begun.uploadId })).receivedBytes).toBe(RESULT_FILE_CHUNK_BYTES);
});
it("rolls back final bytes, artifact and completed receipt atomically on failure", async () => {
  const f = await fixture(), begun = await f.service.file(f.begin) as ResultUploadStatus;
  await f.write(begun.uploadId, 0); await f.write(begun.uploadId, RESULT_FILE_CHUNK_BYTES);
  await expect(withDatabaseTransaction(async () => { await f.file({ type: "finish", uploadId: begun.uploadId }); throw new Error("abort"); })).rejects.toThrow("abort");
  expect(await Promise.all([db.artifact.count(), db.resultArtifactBytes.count(), db.resultFileChunk.count()])).toEqual([0, 0, 2]);
  expect(await f.file({ type: "status", uploadId: begun.uploadId })).toMatchObject({ status: "open" });
  expect(await f.file({ type: "finish", uploadId: begun.uploadId })).toMatchObject({ status: "completed" });
});
it("allows cleanup/read after write disable or work closure, but never new allocation", async () => {
  const f = await fixture(), begun = await f.service.file(f.begin) as ResultUploadStatus;
  await f.write(begun.uploadId, 0);
  process.env.CHRONA_RESULT_WRITES_ENABLED = "false";
  await db.task.update({ where: { id: f.taskId }, data: { status: "Done" } });
  await expect(f.service.file(f.begin)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await f.file({ type: "cancel", uploadId: begun.uploadId })).toMatchObject({ status: "cancelled" });
  expect(await f.file({ type: "cancel", uploadId: begun.uploadId })).toMatchObject({ status: "cancelled" });
  expect(await db.resultFileChunk.count()).toBe(0);
});
it("rechecks actor permissions, revocation and task/version scope including upload replays", async () => {
  const f = await fixture(), completed = await upload(f), first = await publish(f, completed);
  let principal: ResultPrincipal | null = { workspaceId: f.workspaceId, actorId: "other", actorKind: "external", permissions: ["results:read", "artifacts:read", "artifacts:write"] };
  const service = createTaskResultsService({ authorize: async () => principal, artifactAvailable: resultFileAvailable });
  await expect(service.file({ taskId: f.taskId, action: { type: "status", uploadId: completed.uploadId } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const { taskId: other } = await seedTask(f.workspaceId);
  const action = { type: "read", versionId: first.receipt.versionId, artifactRef: completed.artifactRef };
  await expect(service.file({ taskId: other, action })).rejects.toMatchObject({ code: "NOT_FOUND" });
  principal.permissions = ["results:read"];
  await expect(service.file({ taskId: f.taskId, action })).rejects.toMatchObject({ code: "FORBIDDEN" });
  principal = null;
  await expect(service.file(f.begin)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
});
it("blocks acceptance/download when finalized bytes fail verification and preserves immutable storage", async () => {
  const f = await fixture(), completed = await upload(f), first = await publish(f, completed);
  await expect(Promise.resolve(db.resultArtifactBytes.updateMany({ data: { sha256: "0".repeat(64) } }))).rejects.toThrow();
  await expect(withDatabaseTransaction(async () => {
    // Simulate corrupt storage inside a rolled-back test transaction, not an application repair path.
    await db.$executeRawUnsafe('DROP TRIGGER "ResultArtifactBytes_immutable"');
    await db.resultArtifactBytes.updateMany({ data: { sha256: "0".repeat(64) } });
    expect(await f.service.read({ taskId: f.taskId })).toMatchObject({ unavailableRequiredArtifacts: [completed.artifactRef], state: { canAcceptContent: false } });
    await expect(f.service.review({ taskId: f.taskId, versionId: first.receipt.versionId, expectedRevision: first.receipt.editRevision, requestId: crypto.randomUUID(), decision: "accept" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(f.file({ type: "read", versionId: first.receipt.versionId, artifactRef: completed.artifactRef })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    throw new Error("restore storage");
  })).rejects.toThrow("restore storage");
  expect(await f.service.read({ taskId: f.taskId })).toMatchObject({ unavailableRequiredArtifacts: [] });
});
it("counts distinct finalized files against the 32 MiB version budget without binding a failed version", async () => {
  const f = await fixture(), container = await f.service.file(f.begin) as ResultUploadStatus;
  const data = Buffer.alloc(8 * 1024 * 1024), sha256 = fileHash(data);
  const refs: string[] = [];
  const { aiArtifactRef } = await import("./artifact-ref");
  for (let index = 0; index < 5; index++) {
    const id = crypto.randomUUID();
    await db.artifact.create({ data: { id, workspaceId: f.workspaceId, taskId: f.taskId, ownerKind: "result", resultId: container.resultId, type: "file", title: "Large", uri: `result-file://${id}`,
      resultBytes: { create: { sizeBytes: data.length, sha256, filename: "large.bin", mimeType: "application/octet-stream", data } } } });
    refs.push(aiArtifactRef(id));
  }
  await expect(f.service.publish({ taskId: f.taskId, expectedRevision: container.editRevision, requestId: crypto.randomUUID(), content: { schemaVersion: 1,
    outcome: { title: "Large", summary: "Files" }, readiness: { status: "ready", summary: "Ready" }, deliverables: refs.map((artifactRef, i) => ({ key: `file-${i}`, title: "File", kind: "other", artifactRef })) } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.taskResultVersion.count()).toBe(0);
  expect(await db.resultVersionArtifact.count()).toBe(0);
});
it("expires old reservations durably and releases their chunks while retaining request identity", async () => {
  const f = await fixture(), seed = await f.service.file(f.begin) as ResultUploadStatus;
  const old = await db.resultFileUpload.create({ data: { id: crypto.randomUUID(), workspaceId: f.workspaceId, taskId: f.taskId, resultId: seed.resultId,
    actorKey: "human:local-owner", requestId: crypto.randomUUID(), payloadHash: "0".repeat(64), filename: "old.bin", mimeType: "application/octet-stream",
    sizeBytes: f.data.length, sha256: fileHash(f.data), expiresAt: new Date(0) } });
  const part = f.data.subarray(0, RESULT_FILE_CHUNK_BYTES);
  await db.resultFileChunk.create({ data: { uploadId: old.id, offset: 0, sizeBytes: part.length, sha256: fileHash(part), data: part } });
  await db.resultFileUpload.update({ where: { id: old.id }, data: { receivedBytes: part.length } });
  expect(await f.file({ type: "status", uploadId: old.id })).toMatchObject({ status: "expired" });
  expect(await db.resultFileChunk.count({ where: { uploadId: old.id } })).toBe(0);
  expect(await f.file({ type: "status", uploadId: old.id })).toMatchObject({ status: "expired" });
  expect(await db.resultFileUpload.count()).toBe(2);
});
it("reserves workspace quota across tasks, rejects overflow and frees cancelled reservations", async () => {
  const f = await fixture(); const uploads: ResultUploadStatus[] = [];
  for (let index = 0; index < 32; index++) uploads.push(await f.service.file({ ...f.begin, action: { ...f.begin.action, requestId: crypto.randomUUID(), sizeBytes: 8 * 1024 * 1024 } }) as ResultUploadStatus);
  await expect(f.service.file(f.begin)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await f.file({ type: "cancel", uploadId: uploads[0].uploadId });
  expect(await f.service.file(f.begin)).toMatchObject({ status: "open" });
});
it("rejects cross-occurrence file linking and downloads, with no legacy projection leakage", async () => {
  const f = await fixture();
  const occurrence = await db.taskOccurrence.create({ data: { workspaceId: f.workspaceId, taskId: f.taskId, occurrenceKey: crypto.randomUUID(), source: {}, status: "Ready", eligibleAt: new Date() } });
  const completed = await upload(f), first = await publish(f, completed);
  await expect(f.service.file({ taskId: f.taskId, occurrenceId: occurrence.id, action: { type: "read", versionId: first.receipt.versionId, artifactRef: completed.artifactRef } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(f.service.publish({ taskId: f.taskId, occurrenceId: occurrence.id, expectedRevision: null, requestId: crypto.randomUUID(), content: { schemaVersion: 1,
    outcome: { title: "Wrong occurrence", summary: "No" }, readiness: { status: "ready", summary: "No" }, deliverables: [{ key: "file", title: "File", kind: "other", artifactRef: completed.artifactRef }] } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const { getTaskPage } = await import("../tasks/get-task-page");
  const page = await getTaskPage(f.taskId);
  expect(JSON.stringify(page)).not.toContain("result-file://");
});
it("rejects paths, oversize declarations and final hash mismatch; handles empty files", async () => {
  const f = await fixture();
  for (const action of [{ ...f.begin.action, filename: "../escape" }, { ...f.begin.action, sizeBytes: 8 * 1024 * 1024 + 1 }]) {
    await expect(Promise.resolve().then(() => f.service.file({ taskId: f.taskId, action }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  }
  const bad = await f.service.file({ ...f.begin, action: { ...f.begin.action, sha256: "0".repeat(64) } }) as ResultUploadStatus;
  await f.write(bad.uploadId, 0); await f.write(bad.uploadId, RESULT_FILE_CHUNK_BYTES);
  await expect(f.file({ type: "finish", uploadId: bad.uploadId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.artifact.count()).toBe(0);
  const empty = await f.service.file({ ...f.begin, action: { ...f.begin.action, requestId: crypto.randomUUID(), sizeBytes: 0, sha256: fileHash(Buffer.alloc(0)) } }) as ResultUploadStatus;
  expect(await f.file({ type: "finish", uploadId: empty.uploadId })).toMatchObject({ status: "completed", sizeBytes: 0, artifactAvailable: true });
});
