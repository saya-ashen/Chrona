import { expect, test } from "bun:test";
import cases from "../../fixtures/executions-v1/cases.json";
import { executionEventSchema, executionEventBatchSchema, executionJsonBytes, executionSnapshotSchema, editorResponseSchema, executionClientMessageSchema } from "./execution-events";
for (const sample of cases.events) test(`event fixture: ${sample.name}`, () => {
  expect(executionEventSchema.safeParse(sample.value).success).toBe(sample.valid);
});
for (const sample of cases.responses) test(`response fixture: ${sample.name}`, () => {
  expect(editorResponseSchema.safeParse(sample.value).success).toBe(sample.valid);
});
test("client message uses normalized fields without Pi raw; empty arrays/null stay distinct", () => {
  expect(executionClientMessageSchema.parse(cases.normalizedUi.message).message.content[0]?.text).toBe("你好 🐱");
  expect(executionClientMessageSchema.safeParse({ ...cases.normalizedUi.message, raw: {} }).success).toBe(false);
  expect(cases.normalizedUi.snapshot.finalMessage).toBeNull();
  expect(Array.isArray(cases.normalizedUi.snapshot.questions)).toBe(true);
});
test("UTF-8 event and batch budgets apply before storage", () => {
  const event = executionEventSchema.parse(cases.events[0]!.value);
  const ascii = { ...event, payload: { type: "text_delta", messageId: "m", delta: "a".repeat(12_000) } };
  expect(executionEventSchema.safeParse(ascii).success).toBe(true);
  expect(executionEventSchema.safeParse({ ...ascii, payload: { ...ascii.payload, delta: "猫".repeat(12_000) } }).success).toBe(false);
  expect(executionEventBatchSchema.safeParse(Array(101).fill(event)).success).toBe(false);
  const page = Array(30).fill(ascii);
  expect(executionJsonBytes(page)).toBeGreaterThan(256 * 1024);
  expect(executionEventBatchSchema.safeParse(page).success).toBe(false);
});
test("questions cannot restore original text, answer bodies or raw permissions", () => {
  const event = executionEventSchema.parse(cases.events[3]!.value);
  if (event.payload.type !== "question") throw new Error("fixture");
  for (const key of ["prefill", "answer", "raw", "grant"]) expect(executionEventSchema.safeParse({ ...event, payload: { ...event.payload, question: { ...event.payload.question, [key]: "secret" } } }).success).toBe(false);
  const ref = { workId: "w", sessionId: "s", runId: "r", attemptId: "a" };
  expect(executionSnapshotSchema.parse({ ...ref, highWatermark: 0, status: "completed", cancelRequested: false, stopConfirmed: true, finalMessage: null, questions: [], missing: true, expiresAt: "2026-11-06T00:00:00Z" }).finalMessage).toBeNull();
});
