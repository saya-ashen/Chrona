import { expect, test } from "bun:test";
import { EXECUTOR_PROTOCOL, executorCleanupOperationSchema, executorCleanupResultSchema, executorPollReceiptSchema, executorReportSchema } from "./executor";

const target = { workId: "work", sessionId: "session", runId: "run", attemptId: "attempt", assignmentId: "assignment", generation: 1 };
const operation = { target, launchDigest: "a".repeat(64), workspaceRef: "workspace", mappingRevision: 1,
  sourceReceiptDigest: null, input: { workId: "work", commandKey: "preview-key", action: "preview" }, requestDigest: "b".repeat(64) };
const result = { commandKey: "preview-key", requestDigest: operation.requestDigest,
  receipt: { workId: "work", workspaceRef: "workspace", state: "retained", reason: "Review before removal", previewDigest: "c".repeat(64) } };
const fence = { executorId: "device", generation: 1, incarnation: "connection" };

test("cleanup transport remains optional for existing poll and report envelopes", () => {
  const poll = { ...fence, authorizedForMs: 60000, launches: [], controls: [], questions: [] };
  const report = { v: EXECUTOR_PROTOCOL, requestId: "request", ...fence, target, records: [] };
  expect(executorPollReceiptSchema.parse(poll)).toEqual(poll);
  expect(executorReportSchema.parse(report)).toEqual(report);
  expect(executorPollReceiptSchema.safeParse({ ...poll, cleanupOperations: [operation] }).success).toBe(true);
  expect(executorReportSchema.safeParse({ ...report, cleanupResults: [result] }).success).toBe(true);
  expect(executorPollReceiptSchema.safeParse({ ...poll, cleanupOperations: Array(5).fill(operation) }).success).toBe(false);
  expect(executorReportSchema.safeParse({ ...report, cleanupResults: Array(5).fill(result) }).success).toBe(false);
});

test("cleanup command binds work, mapping revision and a separately confirmed preview", () => {
  expect(executorCleanupOperationSchema.safeParse(operation).success).toBe(true);
  for (const invalid of [
    { ...operation, input: { ...operation.input, workId: "other" } },
    { ...operation, mappingRevision: "1" },
    { ...operation, input: { ...operation.input, action: "confirm" } },
    { ...operation, sourceReceiptDigest: "bad" },
    { ...operation, path: "/arbitrary" },
  ]) expect(executorCleanupOperationSchema.safeParse(invalid).success).toBe(false);
  expect(executorCleanupOperationSchema.safeParse({ ...operation, input: { ...operation.input, action: "confirm", previewDigest: "d".repeat(64) } }).success).toBe(true);
  expect(executorCleanupResultSchema.safeParse(result).success).toBe(true);
  expect(executorCleanupResultSchema.safeParse({ ...result, receipt: { ...result.receipt, secret: "forbidden" } }).success).toBe(false);
});
