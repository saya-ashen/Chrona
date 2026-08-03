/**
 * Claude Code SDK registration and session-resume regression coverage.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

import type { StartRunInput } from "@chrona/providers-foundation";
import { createClaudeCodeRunner, probeClaudeCodeSdk } from "./runner";

let capturedOptions: Record<string, unknown> | null = null;
let capturedPrompt: unknown = null;
let nextQueryMessages: unknown[] = [];
let nextQueryError: unknown = null;

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mock((input: { prompt?: unknown; options?: Record<string, unknown> }) => {
    capturedPrompt = input.prompt;
    capturedOptions = input.options ?? null;
    return Object.assign((async function* () {
      if (nextQueryError) throw nextQueryError;
      for (const message of nextQueryMessages) yield message;
    })(), { close: mock(() => {}), interrupt: async () => {} });
  }),
  startup: mock(async () => ({ close: () => {} })),
}));

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  capturedOptions = null;
  capturedPrompt = null;
  nextQueryMessages = [];
  nextQueryError = null;
  mock.restore();
});

function declaredTools(): NonNullable<StartRunInput["tools"]> {
  return [{
    name: "fixture_echo",
    description: "Echo a fixture value.",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  }];
}

describe("Claude Code declared-tool registration", () => {
  test("registers request tools through the SDK-local MCP server", async () => {
    const runner = await createClaudeCodeRunner({
      mcpBaseUrl: "http://unused.test/",
      mcpRunToken: "",
    });

    await runner.start({
      clientOperationId: "claude-code-declared-tools",
      sessionId: "session-1",
      sessionKey: "feature:fixture",
      instructions: "Call the fixture tool.",
      input: { type: "text", text: "Echo a value." },
      tools: declaredTools(),
      terminalToolName: "fixture_echo",
    } satisfies StartRunInput);

    const mcpServers = capturedOptions?.["mcpServers"] as
      | { run_tools?: { name?: string } }
      | undefined;
    expect(mcpServers?.run_tools?.name).toBe("run_tools");
  });

  test("does not pass synthetic Claude Code run ids to SDK resume", async () => {
    const runner = await createClaudeCodeRunner({
      mcpBaseUrl: "http://unused.test/",
      mcpRunToken: "",
    });

    await runner.start({
      clientOperationId: "claude-code-synthetic-resume",
      sessionId: "session-1",
      sessionKey: "feature:fixture",
      instructions: "Retry the operation.",
      input: { type: "text", text: "Retry." },
      resumeSessionRef: "claude-sdk-3583bad8-4764-417b-9998-973c5b6bde60",
    } satisfies StartRunInput);

    expect(capturedOptions?.["resume"]).toBeUndefined();
  });


  test("removes declared tools for read-only runs", async () => {
    const runner = await createClaudeCodeRunner({
      mcpBaseUrl: "http://unused.test",
      mcpRunToken: "token",
      cwd: "/tmp/provider",
    });
    await runner.start({
      clientOperationId: "claude-code-read-only",
      sessionId: "session-read-only",
      sessionKey: "feature:review",
      instructions: "Review without side effects.",
      input: { type: "text", text: "Review this input." },
      tools: declaredTools(),
      toolPolicy: "read_only",
    } satisfies StartRunInput);

    expect(capturedOptions?.["mcpServers"]).toBeUndefined();
    expect(capturedOptions?.["permissionMode"]).toBe("dontAsk");
    expect(capturedOptions?.["allowedTools"]).toEqual([]);
    expect(capturedOptions?.["disallowedTools"]).toEqual([
      "Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task",
    ]);
  });
  test("passes native Claude session ids to SDK resume", async () => {
    const runner = await createClaudeCodeRunner({
      mcpBaseUrl: "http://unused.test/",
      mcpRunToken: "",
    });
    const nativeSessionId = "3583bad8-4764-417b-9998-973c5b6bde60";

    await runner.start({
      clientOperationId: "claude-code-native-resume",
      sessionId: "session-1",
      sessionKey: "feature:fixture",
      instructions: "Continue the operation.",
      input: { type: "text", text: "Continue." },
      resumeSessionRef: nativeSessionId,
    } satisfies StartRunInput);

    expect(capturedOptions?.["resume"]).toBe(nativeSessionId);
  });
});

describe("Claude Code health probe", () => {
  test("runs a tool-free one-turn SDK query", async () => {
    nextQueryMessages = [{ type: "result", subtype: "success", is_error: false }];

    await expect(probeClaudeCodeSdk({
      config: {
        model: "claude-test-model",
        env: { ANTHROPIC_API_KEY: "sk-test" },
        cwd: "/tmp/provider-health",
        mcpBaseUrl: "http://unused.test",
        mcpRunToken: "",
      },
      timeoutMs: 1000,
    })).resolves.toBeNull();

    expect(capturedPrompt).toContain("ready");
    expect(capturedOptions).toMatchObject({
      model: "claude-test-model",
      cwd: "/tmp/provider-health",
      tools: [],
      maxTurns: 1,
      permissionMode: "dontAsk",
    });
    expect((capturedOptions?.env as Record<string, string>).ANTHROPIC_API_KEY).toBe("sk-test");
  });

  test("reports SDK result errors as failed connectivity", async () => {
    nextQueryMessages = [{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["invalid auth"] }];

    await expect(probeClaudeCodeSdk({ config: { mcpBaseUrl: "http://unused.test", mcpRunToken: "" }, timeoutMs: 1000 })).resolves.toContain("invalid auth");
  });
});
