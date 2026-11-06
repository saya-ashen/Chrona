import { expect, test } from "bun:test";
import fixture from "../../fixtures/executor-v1/cases.json";
import { EXECUTOR_HTTP, EXECUTOR_OWNER_HTTP, executorOwnerIncarnationSchema, EXECUTOR_LIMITS, EXECUTOR_MODULE_CATALOG, executorAssignmentSchema, executorDigest, executorFinalRequestSchema, executorJournalSchema, executorPairSchema, executorPollReceiptSchema, executorRequestSchemas, executorSourceRecordSchema, executorStopProofSchema, parseExecutorResponse } from "./executor";

test("device fixtures bind stable launch/source/final digests independent of JSON key order", async () => {
  expect(executorAssignmentSchema.parse(fixture.assignment).assignmentId).toBe("assignment-fixture");
  for (const [op, raw] of Object.entries(fixture.requests)) expect(executorRequestSchemas[op as keyof typeof fixture.requests].safeParse(raw).success).toBe(true);
  expect(await executorDigest(fixture.assignment)).toBe(fixture.assignmentDigest);
  const { digest, ...record } = fixture.record;
  expect(await executorDigest(record)).toBe(digest);
  expect(await executorDigest(fixture.final)).toBe(fixture.finalDigest);
  expect(await executorDigest(fixture.assignment.source)).toBe(fixture.final.sourceReceipt.manifestDigest);
  expect(await executorDigest(Object.fromEntries(Object.entries(fixture.assignment).reverse()))).toBe(fixture.assignmentDigest);
});

test("stop evidence requires owned aggregate-empty identity; PID, exit and missing unit are insufficient", () => {
  expect(executorStopProofSchema.safeParse(fixture.final.stop).success).toBe(true);
  for (const proof of [
    { kind: "cgroup_empty", unit: "gone", empty: true }, { kind: "pid_exited", pid: 123 },
    { ...fixture.final.stop, populated: 1 }, { ...fixture.final.stop, observer: "http_ok" },
    { ...fixture.final.stop, identity: { ...fixture.final.stop.identity, invocationId: "reused" } },
    { ...fixture.final.stop, identity: { ...fixture.final.stop.identity, controlGroup: "/user.slice/../other" } },
  ]) expect(executorStopProofSchema.safeParse(proof).success).toBe(false);
  expect(executorStopProofSchema.safeParse({ kind: "unknown", reason: "Observation was lost before collection" }).success).toBe(true);
  expect(executorStopProofSchema.safeParse({ kind: "never_started", tombstoneDigest: "a".repeat(64) }).success).toBe(true);
});

test("source records cannot manufacture questions or stop confirmation and all transport allocations are bounded", () => {
  for (const payload of [
    { type: "state", status: "completed", cancelRequested: false, stopConfirmed: true },
    { type: "question", question: {} },
  ]) expect(executorSourceRecordSchema.safeParse({ ...fixture.record, item: { kind: "detail", payload } }).success).toBe(false);
  expect(executorSourceRecordSchema.safeParse({ ...fixture.record, sourceSeq: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  expect(executorSourceRecordSchema.safeParse({ ...fixture.record, item: { kind: "detail", payload: { ...fixture.record.item.payload, text: "汉".repeat(12_000) } } }).success).toBe(false);
  expect(executorFinalRequestSchema.safeParse({ ...fixture.requests.final, credential: "forbidden" }).success).toBe(false);
  expect(executorPairSchema.safeParse({ v: "chrona.executor.v1", requestId: "pair", code: "a".repeat(64), label: "Temporary fixture", credential: "forbidden" }).success).toBe(false);
  expect(Number(EXECUTOR_LIMITS.deviceSpoolBytes)).toBe(2 * (EXECUTOR_LIMITS.spoolBytes + EXECUTOR_LIMITS.receiptBytes + EXECUTOR_LIMITS.terminalBytes));
  expect(EXECUTOR_LIMITS.terminalBytes).toBeGreaterThan(EXECUTOR_LIMITS.finalBytes + EXECUTOR_LIMITS.proofBytes);
  const gap = { ...fixture.record, item: { kind: "gap", throughSourceSeq: 3, reason: "backpressure" } };
  expect(executorSourceRecordSchema.safeParse(gap).success).toBe(true);
  expect(executorSourceRecordSchema.safeParse({ ...gap, sourceSeq: 4 }).success).toBe(false);
});

test("incarnation journal and poll response have explicit fences and no replayable answers in durable state", () => {
  const journal = { assignment: fixture.assignment, launchDigest: fixture.assignmentDigest, phase: "final", identity: fixture.final.stop.identity, sourceAck: 1, sourceProduced: 1, consumedControls: [], final: fixture.final, finalDigest: fixture.finalDigest, tombstoneDigest: null };
  expect(executorJournalSchema.safeParse(journal).success).toBe(true);
  for (const extra of [{ answer: { decision: "submit", value: true } }, { credential: "forbidden" }, { sourceAck: 2 }]) expect(executorJournalSchema.safeParse({ ...journal, ...extra }).success).toBe(false);
  const poll = { executorId: "device-fixture", generation: 1, incarnation: "incarnation-fixture", authorizedForMs: 60_000, launches: [], controls: [], questions: [] };
  expect(executorPollReceiptSchema.safeParse(poll).success).toBe(true);
  expect(executorPollReceiptSchema.safeParse({ ...poll, incarnation: undefined }).success).toBe(false);
  expect(executorPollReceiptSchema.safeParse({ ...poll, authorizedForMs: 60_001 }).success).toBe(false);
  const response = { v: "chrona.executor.v1", requestId: "poll-fixture", ok: true, data: poll };
  expect(parseExecutorResponse("poll", "poll-fixture", response).ok).toBe(true);
  expect(() => parseExecutorResponse("poll", "other-request", response)).toThrow();
  expect(() => parseExecutorResponse("final", "poll-fixture", response)).toThrow();
});

test("owner incarnation transition is strict and separate from device exemptions", () => {
  const input = { executorId: "device", generation: 1, expectedIncarnation: "old", nextIncarnation: "new", commandKey: "transfer" };
  expect(executorOwnerIncarnationSchema.safeParse(input).success).toBe(true);
  for (const extra of [{ workspaceId: "injected" }, { ownerId: "injected" }, { nextIncarnation: "old" }, { expectedIncarnation: null }]) expect(executorOwnerIncarnationSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  expect(EXECUTOR_OWNER_HTTP.incarnation).toEqual({ method: "POST", path: "/api/executor/v1/incarnation" });
  expect(Object.values(EXECUTOR_HTTP).some(route => route.path === EXECUTOR_OWNER_HTTP.incarnation.path as string)).toBe(false);
});

test("HTTP exemption contract lists six exact POST paths with independent auth and an empty module bridge", () => {
  expect(Object.values(EXECUTOR_HTTP).map(route => `${route.method} ${route.path}`)).toEqual([
    "POST /api/executor/v1/pair", "POST /api/executor/v1/poll", "POST /api/executor/v1/report",
    "POST /api/executor/v1/question", "POST /api/executor/v1/final", "POST /api/executor/v1/reconcile",
  ]);
  expect(EXECUTOR_HTTP.final.auth).toBe("active_or_drain");
  expect(EXECUTOR_HTTP.report.auth).toBe("active");
  expect(EXECUTOR_MODULE_CATALOG).toEqual([]);
});
