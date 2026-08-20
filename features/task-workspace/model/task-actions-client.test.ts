import { afterEach, expect, it, vi } from "vitest";
import { startExecution } from "./task-actions-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("dispatches direct execution controls through the command rail", async () => {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ commandId: "command-1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await startExecution({ taskId: "task/1", prompt: "Start now" });

  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("/api/work/task%2F1/commands");
  expect(JSON.parse(String(init?.body))).toMatchObject({
    type: "execution.action",
    action: "start_manual",
    prompt: "Start now",
    idempotencyKey: expect.stringMatching(/^web-/),
  });
});
