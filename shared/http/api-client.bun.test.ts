import { describe, expect, it } from "bun:test";
import { apiJson } from "./api-client";
import { clearAccessKey, setAccessKey } from "./access-key";

describe("apiJson", () => {
  it("sends JSON and adds the configured access key without replacing explicit authorization", async () => {
    setAccessKey("test-key", false);
    const originalFetch = globalThis.fetch;
    let request: Request | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      await expect(apiJson<{ ok: boolean }>("https://chrona.test/api/tasks", { method: "POST" })).resolves.toEqual({ ok: true });
      expect(request?.headers.get("authorization")).toBe("Bearer test-key");
      expect(request?.headers.get("content-type")).toBe("application/json");

      await apiJson("https://chrona.test/api/tasks", { headers: { Authorization: "Bearer caller-key" } });
      expect(request?.headers.get("authorization")).toBe("Bearer caller-key");
    } finally {
      globalThis.fetch = originalFetch;
      clearAccessKey();
    }
  });

  it("preserves structured HTTP error status, message, and payload", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: "Task unavailable" }, { status: 409 })) as typeof fetch;

    try {
      await expect(apiJson("https://chrona.test/api/tasks/1")).rejects.toMatchObject({
        name: "ApiError",
        message: "Task unavailable",
        status: 409,
        data: { error: "Task unavailable" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the response status text when an error response is not JSON", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("gateway error", { status: 502, statusText: "Bad Gateway" })) as typeof fetch;

    try {
      await expect(apiJson("https://chrona.test/api/tasks/1")).rejects.toMatchObject({
        name: "ApiError",
        message: "Bad Gateway",
        status: 502,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
