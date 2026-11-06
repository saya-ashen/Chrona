import { expect, test } from "bun:test";
import cases from "../../fixtures/executions-v1/cases.json";
import { editorRequestSchema, executionStartSchema, executionViewSchema, EXECUTION_CAPABILITIES } from "./execution";

for (const sample of cases.requests) test(`execution fixture: ${sample.name}`, () => {
  expect(editorRequestSchema.safeParse(sample.value).success).toBe(sample.valid);
});
test("untrusted starts cannot supply identity, lease, capability or filesystem paths", () => {
  const { op: _op, ...request } = cases.requests[0]!.value.command;
  expect(executionStartSchema.safeParse(request).success).toBe(true);
  for (const field of ["caller", "workspaceId", "moduleId", "lease", "token", "cwd", "canonicalPath"]) {
    expect(executionStartSchema.safeParse({ ...request, [field]: "/tmp/forged" }).success).toBe(false);
  }
  expect(EXECUTION_CAPABILITIES.raw_rpc).toBe(false);
  expect(EXECUTION_CAPABILITIES.thinking).toBe(false);
});
test("cancel intent alone is not stopped", () => {
  const view = { workId: "w", sessionId: "s", runId: "r", attemptId: "a", projectRef: "p", status: "running", cancelRequested: true, stopConfirmed: false };
  expect(executionViewSchema.safeParse(view).success).toBe(true);
  expect(executionViewSchema.safeParse({ ...view, status: "cancelled" }).success).toBe(false);
  expect(executionViewSchema.safeParse({ ...view, status: "cancelled", stopConfirmed: true }).success).toBe(true);
});
