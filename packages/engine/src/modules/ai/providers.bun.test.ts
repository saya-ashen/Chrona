import { afterEach, describe, expect, it, mock } from "bun:test";
import { testAiClientAvailability } from "./providers";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AI provider availability", () => {
  it("uses legacy OpenClaw baseUrl as gateway URL", async () => {
    const fetchMock = mock((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testAiClientAvailability({
      type: "openclaw",
      config: { baseUrl: "127.0.0.1:8642", bridgeToken: "" },
    });

    expect(result).toEqual({ available: true, reason: "Gateway is reachable" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:8642/v1/health");
  });
});
