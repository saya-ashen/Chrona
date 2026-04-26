import { afterEach, describe, expect, it } from "vitest";

import { OpenClawBridgeClient } from "./bridge-client";
import type { BridgeResponse } from "./bridge-types";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function makeBridgeResponse(overrides: Partial<BridgeResponse> = {}): BridgeResponse {
  return {
    sessionId: "bridge-session-1",
    responseId: "resp-1",
    responseStatus: "completed",
    runId: "resp-1",
    output: "done",
    toolCalls: [],
    toolCallOutputs: [],
    usage: null,
    error: null,
    durationMs: 5,
    structured: null,
    feature: null,
    ...overrides,
  };
}

describe("OpenClawBridgeClient", () => {
  it("sends execution requests with stable session key semantics", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1/execution/task")) {
        calls.push({
          url,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        });
        return Response.json(
          makeBridgeResponse({
            sessionId: "bridge-session-xyz",
            responseId: "resp-openresponses-1",
            runId: "resp-openresponses-1",
            output: "Execution done",
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new OpenClawBridgeClient({ baseUrl: "http://bridge.local" });
    const result = await client.createRun({
      prompt: "Analyze code",
      runtimeInput: { model: "gpt-5", prompt: "Task title from runtime input", maxTokens: 321 },
      runtimeSessionKey: "tenant-a:workflow-1",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      sessionId: "tenant-a:workflow-1",
      sessionKey: "tenant-a:workflow-1",
      instructions: "Analyze code",
      taskTitle: "Task title from runtime input",
      runtimeAdapterKey: "openclaw",
      runtimeInput: { model: "gpt-5", prompt: "Task title from runtime input", maxTokens: 321 },
    });
    expect(result).toEqual({
      runtimeRunRef: "resp-openresponses-1",
      runtimeSessionRef: "bridge-session-xyz",
      runtimeSessionKey: "tenant-a:workflow-1",
      runStarted: true,
    });
  });

  it("uses response ids when resuming runs and reading snapshots", async () => {
    const calls: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1/execution/task")) {
        calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Response.json(
          makeBridgeResponse({
            sessionId: "bridge-session-abc",
            responseId: calls.length === 1 ? "resp-1" : "resp-2",
            runId: calls.length === 1 ? "resp-1" : "resp-2",
            output: calls.length === 1 ? "first" : "second",
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new OpenClawBridgeClient({ baseUrl: "http://bridge.local" });
    const created = await client.createRun({
      prompt: "First prompt",
      runtimeInput: {},
      runtimeSessionKey: "tenant-a:session-1",
    });
    const resumed = await client.sendInput({
      runtimeSessionKey: "tenant-a:session-1",
      message: "Follow-up",
    });
    const snapshotByRun = await client.waitForRun({
      runtimeRunRef: "resp-2",
      runtimeSessionKey: undefined,
    });

    expect(created.runtimeRunRef).toBe("resp-1");
    expect(resumed.runtimeRunRef).toBe("resp-2");
    expect(calls[1]).toMatchObject({
      sessionId: "tenant-a:session-1",
      sessionKey: "tenant-a:session-1",
      instructions: "Follow-up",
    });
    expect(snapshotByRun).toMatchObject({
      runtimeRunRef: "resp-2",
      runtimeSessionRef: "bridge-session-abc",
      runtimeSessionKey: "tenant-a:session-1",
      lastMessage: "second",
      status: "Completed",
    });
  });

  it("sends structured feature requests with prompt-shaped input payloads", async () => {
    const calls: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1/features/generate-plan")) {
        calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Response.json(
          makeBridgeResponse({
            sessionId: "bridge-session-plan",
            responseId: "resp-plan-1",
            runId: "resp-plan-1",
            output: "plan",
            structured: {
              ok: true,
              parsed: { summary: "plan" },
              source: "business_tool",
              feature: "generate_plan",
              toolName: "generate_task_plan_graph",
              rawOutput: "plan",
              error: null,
              validationIssues: [],
              sessionId: "bridge-session-plan",
              runId: "resp-plan-1",
              bridgeToolCalls: [],
            },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new OpenClawBridgeClient({ baseUrl: "http://bridge.local" });
    const result = await client.createStructuredRun<{ summary: string }>({
      feature: "generate_plan",
      prompt: "Build a plan",
      runtimeSessionKey: "tenant-a:plan-1",
      instructions: "You are a planner",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      sessionId: "tenant-a:plan-1",
      sessionKey: "tenant-a:plan-1",
      input: {
        prompt: "Build a plan",
      },
      instructions: "You are a planner",
      timeout: 300,
    });
    expect(result).toMatchObject({
      ok: true,
      parsed: { summary: "plan" },
      runId: "resp-plan-1",
      sessionId: "bridge-session-plan",
    });
  });
});
