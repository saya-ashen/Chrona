import { beforeEach, describe, expect, it, mock } from "bun:test";

const aiSuggestStream = mock();
const aiGeneratePlanStream = mock(async function* () {});
const aiGeneratePlan = mock(async () => null);

mock.module("@/modules/ai/ai-service", () => ({
  aiSuggestStream,
  aiGeneratePlanStream,
  aiGeneratePlan,
}));

mock.module("@/lib/db", () => ({
  db: {
    taskProjection: {
      findMany: mock(async () => []),
    },
  },
}));

describe("POST /api/ai/auto-complete (stream)", () => {
  beforeEach(() => {
    aiSuggestStream.mockReset();
  });

  it("forwards streamed structured suggestions as SSE suggestions event", async () => {
    aiSuggestStream.mockImplementation(async function* () {
      yield { type: "status", message: "Generating suggestions" };
      yield { type: "tool_call", tool: "suggest_task_completions", input: { input: "write tests" } };
      yield { type: "tool_result", tool: "suggest_task_completions", result: "generated 1 suggestion" };
      yield {
        type: "result",
        suggestions: {
          suggestions: [
            {
              title: "Write unit tests",
              description: "Write comprehensive unit tests",
              priority: "High",
              estimatedMinutes: 45,
              tags: ["testing"],
            },
          ],
          source: "openclaw",
          requestId: "req-1",
        },
      };
      yield { type: "done", text: "done", structured: null };
    });

    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/auto-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "write tests", workspaceId: "ws-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");

    const text = await response.text();
    expect(text).toContain("event: status");
    expect(text).toContain("Generating suggestions");
    expect(text).toContain("event: tool_call");
    expect(text).toContain("suggest_task_completions");
    expect(text).toContain("event: tool_result");
    expect(text).toContain("generated 1 suggestion");
    expect(text).not.toContain('"tool":"unexpected_legacy_tool"');
    expect(text).toContain("event: suggestions");
    expect(text).toContain("Write unit tests");
    expect(text).toContain('"isFinal":true');
    expect(text).not.toContain('"source":"rules"');
  });

  it("does not emit rule-based fallback suggestions when AI returns nothing", async () => {
    aiSuggestStream.mockImplementation(async function* () {
      yield { type: "status", message: "Generating suggestions" };
      yield { type: "done", text: "done", structured: null };
    });

    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/auto-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "meeting", workspaceId: "ws-1" }),
      }),
    );

    const text = await response.text();
    expect(text).not.toContain('"source":"rules"');
    expect(text).not.toContain("Team sync meeting");
  });
});
