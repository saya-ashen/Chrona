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
  it("posts generate_plan requests to bridge feature routes instead of /v1/responses", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({ url, init });

      return Response.json({
        sessionId: "sess-1",
        responseStatus: "completed",
        output: "bridge ok",
        toolCalls: [],
        toolCallOutputs: [],
        usage: null,
        error: null,
        durationMs: 5,
        structured: null,
        feature: null,
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
    expect(requests[0]?.url).toBe("https://bridge.example.com/v1/features/generate-plan");
    expect(requests[0]?.url).not.toContain("/v1/responses");
    expect(requests[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-token",
    });

    const body = JSON.parse(String(requests[0]?.init?.body ?? "{}")) as {
      input?: { task?: { title?: string; description?: string; estimatedDurationMinutes?: number } };
    };
    expect(body.input?.task?.title).toBe("制作一个汉堡");
    expect(body.input?.task?.description).toBe("准备食材并完成烹饪");
    expect(body.input?.task?.estimatedDurationMinutes).toBe(60);
  });

  it("checks bridge health via /v1/health", async () => {
    const requests: string[] = [];

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push(url);
      return Response.json({ status: "ok", gateway: "http://gateway.internal" });
    }) as unknown as typeof fetch;

    const healthy = await checkClientHealth(makeOpenClawClient());

    expect(healthy).toBe(true);
    expect(requests).toEqual(["https://bridge.example.com/v1/health"]);
  });
});
