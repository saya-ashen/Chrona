import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import type { AiClientRecord, StreamEvent } from "./types";
import { suggestStream } from "./streaming";

const originalFetch = globalThis.fetch;

function sseResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
    {
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

describe("suggestStream", () => {
  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  it("emits suggestions from business tool input without requiring submit_structured_result", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = mock((url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url, body });
      return Promise.resolve(
        sseResponse([
          'event: event\ndata: {"type":"lifecycle","phase":"planning","message":"Generating suggestions"}\n\n',
          'event: event\ndata: {"type":"tool_use","tool":"suggest_task_completions","callId":"call-1","input":{"suggestions":[{"title":"Write unit tests","description":"Write comprehensive unit tests","priority":"High","estimatedMinutes":45,"tags":["testing"]}]}}\n\n',
          'event: done\ndata: {"output":"done","structured":null}\n\n',
        ]),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client: AiClientRecord = {
      id: "client-1",
      name: "OpenClaw",
      type: "openclaw",
      enabled: true,
      isDefault: true,
      config: {
        bridgeUrl: "http://localhost:7677",
        timeoutSeconds: 30,
      },
    };

    const events: StreamEvent[] = [];
    for await (const event of suggestStream(client, {
      input: "write tests",
      kind: "auto-complete",
      workspaceId: "ws-1",
    })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({ type: "status", message: "正在连接 AI 服务..." });
    expect(events[1]).toMatchObject({ type: "status", message: "AI 正在思考..." });
    expect(events[2]).toMatchObject({ type: "status", message: "Generating suggestions" });
    expect(events[3]).toMatchObject({ type: "tool_call", tool: "suggest_task_completions" });
    expect(events[4]).toMatchObject({
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
      },
    });
    expect(events[5]).toMatchObject({ type: "done" });
    expect(String(calls[0]?.body.sessionId ?? "")).toContain("write-tests");
  });

  it("uses different suggest sessions for different inputs in the same workspace", async () => {
    const sessionIds: string[] = [];
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sessionIds.push(String(body.sessionId ?? ""));
      return Promise.resolve(
        sseResponse([
          'event: done\ndata: {"output":"done","structured":{"ok":true,"parsed":{"suggestions":[]},"structured":{"schemaName":"smart_suggestions","schemaVersion":"1.0.0","status":"success","confidence":0.92,"result":{"suggestions":[]},"missingFields":[],"followUpQuestions":[],"notes":[]},"status":"success","reliability":"tool_call"}}\n\n',
        ]),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client: AiClientRecord = {
      id: "client-1",
      name: "OpenClaw",
      type: "openclaw",
      enabled: true,
      isDefault: true,
      config: {
        bridgeUrl: "http://localhost:7677",
        timeoutSeconds: 30,
      },
    };

    for await (const _event of suggestStream(client, {
      input: "参加美国总统竞选",
      kind: "auto-complete",
      workspaceId: "ws-1",
    })) {}
    for await (const _event of suggestStream(client, {
      input: "修水龙头",
      kind: "auto-complete",
      workspaceId: "ws-1",
    })) {}

    expect(sessionIds).toHaveLength(2);
    expect(sessionIds[0]).not.toBe(sessionIds[1]);
    expect(sessionIds[0]).toContain("ws-1-auto-complete");
    expect(sessionIds[1]).toContain("ws-1-auto-complete");
  });
});
