import { afterEach, describe, expect, it, mock } from "bun:test";
import { testAiClientAvailability } from "./providers";
import { CHRONA_DEBUG_PROVIDER_URL } from "./runtime/debug-provider-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AI provider availability", () => {
  it("accepts the local Chrona debug provider through Hermes without network calls", async () => {
    const fetchMock = mock((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(new Response(null, { status: 500 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testAiClientAvailability({
      type: "hermes",
      config: { baseUrl: CHRONA_DEBUG_PROVIDER_URL },
    });

    expect(result).toEqual({
      available: true,
      reason: `Chrona debug provider enabled at ${CHRONA_DEBUG_PROVIDER_URL}`,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

  it("tests Hermes token against an authenticated endpoint", async () => {
    const fetchMock = mock((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer bad-token");
      if (String(url).endsWith("/v1/capabilities")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "invalid token" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testAiClientAvailability({
      type: "hermes",
      config: {
        baseUrl: "http://hermes.local",
        apiKey: "bad-token",
      },
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("401");
    expect(result.reason).toContain("token");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://hermes.local/health/detailed",
      "http://hermes.local/v1/capabilities",
    ]);
  });

  it("requires Hermes run capabilities during availability checks", async () => {
    const fetchMock = mock((url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith("/v1/capabilities")) {
        return Promise.resolve(new Response(JSON.stringify({
          features: {
            run_submission: true,
            run_status: false,
            run_events_sse: true,
            run_stop: true,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testAiClientAvailability({
      type: "hermes",
      config: {
        baseUrl: "http://hermes.local",
        apiKey: "token",
      },
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("run status");
    expect(result.reason).toContain("API_SERVER_ENABLED=true");
    expect(result.reason).toContain("API_SERVER_KEY");
  });
});
