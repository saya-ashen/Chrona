import { afterEach, describe, expect, it, mock } from "bun:test";

import { checkClientHealth, openclawCall } from "./providers";
import type { AiClientRecord, OpenClawClientConfig } from "./types";

const originalFetch = globalThis.fetch;

function makeOpenClawClient(
  config: Partial<OpenClawClientConfig> = {},
): AiClientRecord {
  return {
    id: "client-1",
    name: "OpenClaw",
    type: "openclaw",
    isDefault: true,
    enabled: true,
    config: {
      bridgeUrl: "https://bridge.example.com/",
      bridgeToken: "secret-token",
      timeoutSeconds: 30,
      ...config,
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("openclaw feature transport", () => {
  it("posts generate_plan requests to the OpenResponses gateway with function tool constraints", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({ url, init });

      return Response.json({
        id: "resp-1",
        status: "completed",
        output_text: "bridge ok",
        output: [
          {
            type: "function_call",
            name: "generate_task_plan_graph",
            call_id: "call-1",
            arguments: JSON.stringify({
              title: "汉堡制作计划",
              goal: "完成汉堡制作",
              summary: "bridge ok",
              nodes: [
                {
                  id: "step-1",
                  type: "task",
                  title: "准备食材",
                  expectedOutput: "食材准备完成",
                  executor: "user",
                  mode: "manual",
                },
              ],
              edges: [],
            }),
          },
        ],
      });
    }) as unknown as typeof fetch;

    const text = await openclawCall(
      makeOpenClawClient().config as OpenClawClientConfig,
      "generate_plan",
      "task:1",
      {
        taskId: "task-1",
        title: "制作一个汉堡",
        description: "准备食材并完成烹饪",
        estimatedMinutes: 60,
      },
    );

    expect(text).toBe("bridge ok");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://bridge.example.com//v1/responses");
    expect(requests[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-token",
      "x-openclaw-agent-id": "main",
      "x-openclaw-session-key": "task:1",
    });

    const body = JSON.parse(String(requests[0]?.init?.body ?? "{}")) as {
      tools?: Array<{ name?: string; type?: string }>;
      tool_choice?: string;
      input?: Array<Record<string, unknown>>;
    };
    expect(body.tool_choice).toBe("required");
    expect(body.tools?.[0]).toMatchObject({
      type: "function",
      name: "generate_task_plan_graph",
    });
    expect(body.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "input_text" }),
      ]),
    );
  });

  it("checks bridge health via /health", async () => {
    const requests: string[] = [];

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);
      return Response.json({ status: "ok", gateway: "http://gateway.internal" });
    }) as unknown as typeof fetch;

    const healthy = await checkClientHealth(makeOpenClawClient());

    expect(healthy).toBe(true);
    expect(requests).toEqual(["https://bridge.example.com//v1/health"]);
  });
});
