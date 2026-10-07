import { expect, test } from "bun:test";
import { pageContinuationSchema } from "./continuation";
import { pageReadSchema, pageWriteSchema } from "./pages";
const report = { requestId: "request", baseVersionId: "v1", summary: "Adjusted", changes: ["One change"], feedback: [{ entryId: "input", disposition: "incorporated", explanation: "What changed" }] };
test("bounded continuation reports reject duplicate refs, unsupported authority and oversized unicode", () => {
  expect(pageContinuationSchema.safeParse(report).success).toBe(true);
  for (const invalid of [
    { ...report, feedback: [...report.feedback, ...report.feedback] },
    { ...report, accepted: true },
    { ...report, feedback: [{ ...report.feedback[0], disposition: "approved" }] },
    { ...report, changes: [] },
    { ...report, feedback: Array.from({ length: 100 }, (_, i) => ({ entryId: String(i), disposition: "incorporated", explanation: "汉".repeat(300) })) },
  ]) expect(pageContinuationSchema.safeParse(invalid).success).toBe(false);
});
test("handoff selectors are explicit and cannot mix historical-version filters", () => {
  expect(pageReadSchema.safeParse({ taskId: "t", view: "handoff", requestId: "r" }).success).toBe(true);
  for (const value of [{ taskId: "t", requestId: "r" }, { taskId: "t", view: "handoff", versionId: "v" }, { taskId: "t", view: "handoff", kind: "note" }]) expect(pageReadSchema.safeParse(value).success).toBe(false);
  const input = { taskId: "t", requestId: crypto.randomUUID(), expectedRevision: "page-input-v1:r:1", action: { type: "handoff", versionId: "v1", text: " continue " } };
  expect(pageWriteSchema.parse(input).action).toMatchObject({ text: "continue" });
  expect(pageWriteSchema.safeParse({ ...input, action: { ...input.action, text: " " } }).success).toBe(false);
  expect(pageWriteSchema.safeParse({ ...input, action: { ...input.action, snapshotRevision: 1 } }).success).toBe(false);
});
