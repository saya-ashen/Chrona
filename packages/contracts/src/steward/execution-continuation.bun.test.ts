import { expect, test } from "bun:test";
import { editorRequestSchema, executionInputSchemas, executionStartSchema } from "./execution";

const start = { workId: "turn-2", projectRef: "project", commandKey: "start-2", goal: "Continue the fix", budget: { timeoutMs: 60_000, maxToolCalls: 5 } };
const resumeFrom = { workId: "turn-1", runId: "run-1", attemptId: "attempt-1" };

test("continuation reference survives start, routed input and editor command parsing", () => {
  expect(executionStartSchema.parse(start)).toEqual(start);
  expect(executionStartSchema.parse({ ...start, resumeFrom }).resumeFrom).toEqual(resumeFrom);
  expect(executionInputSchemas.start.parse({ ...start, resumeFrom }).resumeFrom).toEqual(resumeFrom);
  const request = editorRequestSchema.parse({ v: "chrona.execution.v1", requestId: "request", command: { op: "start", ...start, resumeFrom } });
  expect(request.command).toMatchObject({ resumeFrom });
});

const invalidRefs: Record<string, unknown>[] = [
  {}, { workId: "turn-1", runId: "run-1" }, { ...resumeFrom, attemptId: "" }, { ...resumeFrom, workId: "../project" },
  { ...resumeFrom, sessionId: "arbitrary-provider-context" }, { ...resumeFrom, logDir: "/private/logs" },
  { ...resumeFrom, caller: { kind: "owner" } }, { ...resumeFrom, token: "old-capability" },
];
test.each(invalidRefs)("continuation rejects incomplete identities and caller-supplied context authority: %j", ref => {
  expect(executionStartSchema.safeParse({ ...start, resumeFrom: ref }).success).toBe(false);
});
