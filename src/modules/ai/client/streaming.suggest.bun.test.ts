import { afterEach, describe, expect, it, mock } from "bun:test";

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
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  it("emits structured smart_suggestions result from OpenClaw stream", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        sseResponse([
          'event: event\ndata: {"type":"lifecycle","phase":"planning","message":"Generating suggestions"}\n\n',
          'event: event\ndata: {"type":"tool_use","tool":"submit_structured_result","callId":"call-1","input":{"schemaName":"smart_suggestions"}}\n\n',
          'event: done\ndata: {"output":"done","structured":{"ok":true,"parsed":{"suggestions":[{"title":"Write unit tests","description":"Write comprehensive unit tests","priority":"High","estimatedMinutes":45,"tags":["testing"]}]},"structured":{"schemaName":"smart_suggestions","schemaVersion":"1.0.0","status":"success","confidence":0.92,"result":{"suggestions":[{"title":"Write unit tests","description":"Write comprehensive unit tests","priority":"High","estimatedMinutes":45,"tags":["testing"]}]},"missingFields":[],"followUpQuestions":[],"notes":[]},"status":"success","reliability":"tool_call"}}\n\n',
        ]),
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

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
    expect(events[3]).toMatchObject({ type: "tool_call", tool: "submit_structured_result" });
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
  });
});
