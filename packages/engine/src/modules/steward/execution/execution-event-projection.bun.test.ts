import { expect, test } from "bun:test";
import type { ExecutionEvent } from "@chrona/contracts/steward";
import { projectExecutionEvent, executionDisplayText } from "./execution-event-projection";

const base = { workId: "w", sessionId: "s", runId: "r", attemptId: "a", seq: 1, at: "2026-11-05T00:00:00.000Z" };
test("normalized display projection selects only the tool's allowed display keys", () => {
  const display = { path: "/safe/path", command: "echo private", args: { password: "fixture" }, thinking: "private" };
  const read = projectExecutionEvent({ ...base, payload: { type: "tool_started", toolCallId: "t", tool: "read", display } });
  expect(read.payload).toEqual({ type: "tool_started", toolCallId: "t", tool: "read", display: { path: "/safe/path" } });
  const bash = projectExecutionEvent({ ...base, payload: { type: "tool_started", toolCallId: "t", tool: "bash", display } });
  expect(bash.payload).toEqual({ type: "tool_started", toolCallId: "t", tool: "bash", display: { command: "echo private" } });
  expect(projectExecutionEvent({ ...base, payload: { type: "tool_started", toolCallId: "t", tool: "custom", display } }).payload).toMatchObject({ display: {} });
});
for (const text of ["https://user:pass@example.test/path?token=fixture", "Authorization: Basic Zml4dHVyZQ==", "Bearer fixture-test-token", "API_KEY=fixture", "PASSWORD='fixture value'", "token=fixture", "sk-fixture1234567890", "api_key:fixture", "Cookie: session=fixture"]) {
  test(`redacts credential display sample ${text.split(/[ :=]/)[0]}`, () => {
    const projected = projectExecutionEvent({ ...base, payload: { type: "message", messageId: "m", role: "assistant", text, complete: true } });
    expect(JSON.stringify(projected)).not.toContain("fixture");
    expect(JSON.stringify(projected)).toContain("[redacted]");
  });
}
test("safe text and line breaks remain readable; private fields cannot survive projection", () => {
  expect(executionDisplayText("hello\nworld")).toBe("hello\nworld");
  const event = { ...base, thinking: "hidden", payload: { type: "tool_finished", toolCallId: "t", tool: "read", isError: false, summary: "safe", truncated: true, originalBytes: 100_000, raw: "hidden" } };
  const result = projectExecutionEvent(event as ExecutionEvent);
  expect(JSON.stringify(result)).not.toContain("hidden");
  expect(result.payload).toMatchObject({ summary: "safe", truncated: true, originalBytes: 100_000 });
});
