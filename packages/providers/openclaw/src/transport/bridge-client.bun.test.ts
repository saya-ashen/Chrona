import { afterEach, describe, expect, it } from "bun:test";
import { buildGeneratePlanFeatureSpec } from "@chrona/contracts";
import { OpenClawBridgeClient } from "./bridge-client";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function makeGatewayResponse(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "resp-1",
    status: "completed",
    output_text: "done",
    output: [],
    usage: null,
    ...overrides,
  };
}

describe("OpenClawBridgeClient", () => {
  it("sends execution requests with stable session key semantics", async () => {
    const calls: Array<{
      url: string;
      body: Record<string, unknown>;
      headers: Headers;
    }> = [];

    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1/responses")) {
        calls.push({
          url,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
          headers: new Headers(init?.headers),
        });
        return Response.json(
          makeGatewayResponse({
            id: "resp-openresponses-1",
            output_text: "Execution done",
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new OpenClawBridgeClient({
      baseUrl: "http://bridge.local",
      authToken: "secret-token",
    });
    const result = await client.createRun({
      prompt: "Analyze code",
      runtimeInput: { model: "gpt-5", prompt: "Task title from runtime input", maxTokens: 321 },
      runtimeSessionKey: "tenant-a:workflow-1",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      user: "tenant-a:workflow-1",
      instructions: "Analyze code",
      max_output_tokens: 321,
    });
    expect(calls[0]?.body.input).toEqual([
      {
        type: "input_text",
        text: [
          "Task title: Task title from runtime input",
          "Runtime adapter: openclaw",
          "Runtime input JSON:\n{\n  \"model\": \"gpt-5\",\n  \"prompt\": \"Task title from runtime input\",\n  \"maxTokens\": 321\n}",
          "Analyze code",
        ].join("\n\n"),
      },
    ]);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer secret-token");
    expect(result).toEqual({
      runtimeRunRef: "resp-openresponses-1",
      runtimeSessionRef: "tenant-a:workflow-1",
      runtimeSessionKey: "tenant-a:workflow-1",
      runStarted: true,
    });
  });

  it("uses response ids when resuming runs and reading snapshots", async () => {
    const calls: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1/responses")) {
        calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Response.json(
          makeGatewayResponse({
            id: calls.length === 1 ? "resp-1" : "resp-2",
            output_text: calls.length === 1 ? "first" : "second",
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
      user: "tenant-a:session-1",
      instructions: "Follow-up",
    });
    expect(snapshotByRun).toMatchObject({
      runtimeRunRef: "resp-2",
      runtimeSessionRef: "tenant-a:session-1",
      runtimeSessionKey: "tenant-a:session-1",
      lastMessage: "second",
      status: "Completed",
    });
  });

  it("sends structured feature requests with prompt-shaped input payloads", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const featureSpec = buildGeneratePlanFeatureSpec({
      taskId: "task-1",
      title: "Build a plan",
      estimatedMinutes: 15,
    });

    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/v1/responses")) {
        calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Response.json(
          makeGatewayResponse({
            id: "resp-plan-1",
            output: [
              {
                type: "function_call",
                id: "call-1",
                call_id: "call-1",
                name: "generate_task_plan_graph",
                arguments: JSON.stringify({ summary: "plan", title: "Plan", goal: "Goal", nodes: [{ id: "n1", type: "task", title: "Step" }], edges: [] }),
              },
            ],
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
      instructions: featureSpec.instructions,
      inputText: featureSpec.inputText,
      featureSpec,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      user: "tenant-a:plan-1",
      tool_choice: "required",
    });
    expect(String(calls[0]?.instructions)).toContain("Feature: generate_plan");
    expect(String(calls[0]?.instructions)).toContain(featureSpec.instructions);
    expect(calls[0]?.tools).toEqual([featureSpec.requiredTool]);
    expect(calls[0]?.input).toEqual([
      {
        type: "input_text",
        text: featureSpec.inputText,
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      parsed: { summary: "plan" },
      runId: "resp-plan-1",
      sessionId: "tenant-a:plan-1",
    });
  });
});
