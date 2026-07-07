import { afterEach, describe, expect, it, mock } from "bun:test";
import { buildProviderFeatureRequest, testAiClientAvailability } from "../../../packages/engine/src/modules/ai/providers";

const originalClaudeRecordDir = process.env.CHRONA_CLAUDE_CODE_RECORD_DIR;

/**
 * T10 — engine-side availability wireup.
 *
 * Default tests must not probe a developer's local Claude Code SDK. Setting
 * CHRONA_CLAUDE_CODE_RECORD_DIR exercises the same engine branch while keeping
 * health deterministic: the provider trusts record/replay mode and skips live
 * SDK startup.
 */
describe("AI provider availability — claude_code wireup (T10)", () => {
  it("reports available=true with a reachability reason in deterministic record mode", async () => {
    process.env.CHRONA_CLAUDE_CODE_RECORD_DIR = ".tmp/claude-code-health-test";

    const result = await testAiClientAvailability({
      type: "claude_code",
      config: {
        mcpBaseUrl: "http://localhost:3000",
      },
    });

    expect(result).toEqual({
      available: true,
      reason: "Claude Code connectivity check passed",
    });
  });

  it("accepts a ClaudeCodeClientConfig that round-trips through checkClientHealth", async () => {
    process.env.CHRONA_CLAUDE_CODE_RECORD_DIR = ".tmp/claude-code-health-test";

    const result = await testAiClientAvailability({
      type: "claude_code",
      config: {
        mcpBaseUrl: "http://localhost:3000",
        model: "claude-sonnet-4-6",
        timeoutSeconds: 60,
      },
    });

    expect(result).toEqual({
      available: true,
      reason: "Claude Code connectivity check passed",
    });
  });
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalClaudeRecordDir === undefined) {
    delete process.env.CHRONA_CLAUDE_CODE_RECORD_DIR;
  } else {
    process.env.CHRONA_CLAUDE_CODE_RECORD_DIR = originalClaudeRecordDir;
  }
});
describe("provider feature request input", () => {
  it("uses feature inputText as the canonical provider input", () => {
    const request = buildProviderFeatureRequest({
      sessionKey: "scope-1",
      input: { title: "Raw title", extra: "raw" },
      featureSpec: {
        feature: "generate_plan",
        instructions: "System instructions",
        inputText: "Create a concise plan.\nTitle: 查询并总结今天的github trendings",
      },
      stream: false,
    });

    expect(request.instructions).toBe("System instructions");
    expect(request.input).toEqual({
      type: "text",
      text: "Create a concise plan.\nTitle: 查询并总结今天的github trendings",
    });
  });
});


describe("AI provider availability", () => {
  it("accepts the local Chrona debug provider without network calls", async () => {
    const fetchMock = mock((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(new Response(null, { status: 500 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testAiClientAvailability({
      type: "debug",
      config: {},
    });

    expect(result).toEqual({
      available: true,
      reason: "Chrona debug provider is local (deterministic)",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the configured Chrona debug provider profile", async () => {
    const result = await testAiClientAvailability({
      type: "debug",
      config: { profile: "hermes-like" },
    });

    expect(result).toEqual({
      available: true,
      reason: "Chrona debug provider is local (hermes-like)",
    });
  });

  it("uses legacy Hermes baseUrl as gateway URL", async () => {
    const fetchMock = mock((url: Parameters<typeof fetch>[0]) => {
      if (String(url).endsWith("/v1/capabilities")) {
        return Promise.resolve(new Response(JSON.stringify({
          features: {
            run_submission: true,
            run_status: true,
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
      config: { baseUrl: "127.0.0.1:8642", bridgeToken: "" },
    });

    expect(result).toEqual({ available: true, reason: "Hermes API is reachable" });
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://127.0.0.1:8642/health/detailed",
      "http://127.0.0.1:8642/v1/capabilities",
    ]);
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
