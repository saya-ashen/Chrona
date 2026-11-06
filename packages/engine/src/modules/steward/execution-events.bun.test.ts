import { expect, test } from "bun:test";
import type { ExecutionEvent, ExecutionSnapshot } from "@chrona/contracts/steward";
import { executionCursor, executionPosition, reduceExecutionEvent, retainedExecutionSnapshot, executionWait } from "./execution-events";
const ref = { workId: "w", sessionId: "s", runId: "r", attemptId: "a" };
const snapshot: ExecutionSnapshot = { ...ref, highWatermark: 0, status: "running", cancelRequested: false, stopConfirmed: false, finalMessage: null, questions: [], missing: false, expiresAt: "2026-12-05T00:00:00.000Z" };
test("cursor is stable position, rejects malformed and other execution references", () => {
  expect(executionPosition(ref, executionCursor(ref, 42))).toEqual({ after: 42, lifecycle: null });
  expect(executionPosition(ref, executionCursor(ref, 42, '["unknown",false,false]'))).toEqual({ after: 42, lifecycle: '["unknown",false,false]' });
  expect(() => executionPosition(ref, "!!!")).toThrow();
  expect(() => executionPosition({ ...ref, runId: "other" }, executionCursor(ref, 42))).toThrow();
});
test("missing delta is explicit while a complete assistant message restores final text", () => {
  const event: ExecutionEvent = { ...ref, seq: 3, at: "2026-11-05T00:00:00.000Z", payload: { type: "message", messageId: "m", role: "assistant", text: "Complete result", complete: true } };
  expect(reduceExecutionEvent(snapshot, event)).toMatchObject({ highWatermark: 3, missing: true, finalMessage: { text: "Complete result", truncated: false } });
});
test("retained questions are interrupted or expired, never restored as live authority", () => {
  const question = { requestId: "q", title: "Continue?", method: "confirm" as const, options: [], status: "pending" as const, expiresAt: "2026-11-05T01:00:00.000Z" };
  expect(retainedExecutionSnapshot({ ...snapshot, questions: [question] }, new Date("2026-11-05T00:00:00.000Z")).questions[0]!.status).toBe("interrupted");
  expect(retainedExecutionSnapshot({ ...snapshot, questions: [question] }, new Date("2026-11-05T02:00:00.000Z")).questions[0]!.status).toBe("expired");
  expect(question.status).toBe("pending");
});
test("abort releases a bounded wait promptly", async () => {
  const controller = new AbortController(), start = Date.now();
  const waiting = executionWait(controller.signal, 15_000); controller.abort(); await waiting;
  expect(Date.now() - start).toBeLessThan(100);
});
