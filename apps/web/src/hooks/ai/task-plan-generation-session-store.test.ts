import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: async (input: string, init: { onopen?: (response: Response) => Promise<void>; onmessage?: (message: { event: string; data: string }) => void }) => {
    await globalThis.fetch(input, init as RequestInit);
    await init.onopen?.(new Response(null, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    init.onmessage?.({ event: "done", data: "{}" });
  },
}));
import { startTaskPlanGenerationSession, stopTaskPlanGenerationSession } from "./task-plan-generation-session-store";

function sse(events: Array<{ event: string; data: unknown }>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`));
      }
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});
function stateStore(initial: Record<string, unknown>) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    get: (path: string) => snapshot[path],
    set: (path: string, value: unknown) => {
      snapshot = { ...snapshot, [path]: value };
      for (const listener of listeners) listener();
    },
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (next: Record<string, unknown>) => {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) listener();
    },
  };
}

describe("task plan generation session store", () => {
  it("sends workBlockId when starting recurring occurrence generation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sse([{ event: "done", data: {} }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ generationSession: null }), { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await startTaskPlanGenerationSession({ taskId: "task_1", workBlockId: "block_1", forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task_1/plan/generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ forceRefresh: true, userInstruction: null, workBlockId: "block_1" }),
      }),
    );
  });

  it("sends workBlockId query when stopping recurring occurrence generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stopped: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await stopTaskPlanGenerationSession("task_1", "block_1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task_1/plan/generations/stop?workBlockId=block_1",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
