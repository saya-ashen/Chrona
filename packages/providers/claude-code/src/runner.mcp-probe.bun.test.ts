/**
 * probeMcpServer — fail-fast preflight for the Claude Code provider.
 *
 * The SDK registers an HTTP MCP transport at the start of every `claude`
 * run. If the transport is unreachable or the Bearer token is rejected,
 * the agent would only notice mid-session (wasting a model turn
 * exploring unrelated filesystem paths). `probeMcpServer` issues a
 * single `initialize` + `tools/list` handshake at `SdkRunner.start` time
 * so a bad config surfaces immediately as `McpProbeError`.
 *
 * These tests stub `globalThis.fetch` with `bun:test`'s `mock`. No real
 * HTTP, no spawned subprocesses.
 */
import { afterEach, describe, expect, it, mock } from "bun:test";

import { extractSdkSessionId, McpProbeError, mcpUrlForSession, probeMcpServer } from "./runner";

type FetchResponseInit = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

function makeFetchStub(responses: Array<(method: string) => FetchResponseInit>) {
  let call = 0;
  const fn = mock(async (_url: string, init: { method?: string } = {}) => {
    const idx = call++;
    if (idx >= responses.length) {
      throw new Error(`fetch called ${idx + 1} times; only ${responses.length} responses stubbed`);
    }
    const make = responses[idx]!;
    const { status, headers, body = "" } = make(init.method ?? "GET");
    return new Response(body, { status, headers });
  });
  return fn as unknown as typeof fetch;
}

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  mock.restore();
});

describe("mcpUrlForSession", () => {
  it("adds encoded session_id to the registered MCP URL", () => {
    expect(mcpUrlForSession("http://mcp.test/", "chrona:task:task-1:execute:url")).toBe(
      "http://mcp.test/api/mcp?session_id=chrona%3Atask%3Atask-1%3Aexecute%3Aurl",
    );
  });

  it("leaves the MCP URL unscoped when no session exists", () => {
    expect(mcpUrlForSession("http://mcp.test", null)).toBe("http://mcp.test/api/mcp");
  });
});

describe("extractSdkSessionId", () => {
  it("reads SDK session_id from system and result messages", () => {
    expect(extractSdkSessionId({ type: "system", subtype: "init", session_id: "sdk-session-1" })).toBe("sdk-session-1");
    expect(extractSdkSessionId({ type: "result", session_id: "sdk-session-2" })).toBe("sdk-session-2");
  });

  it("ignores missing or invalid SDK session ids", () => {
    expect(extractSdkSessionId({ type: "system" })).toBeUndefined();
    expect(extractSdkSessionId({ type: "result", session_id: "" })).toBeUndefined();
    expect(extractSdkSessionId(null)).toBeUndefined();
  });
});

describe("probeMcpServer", () => {
  it("returns the registered tool names on a healthy MCP server", async () => {
    globalThis.fetch = makeFetchStub([
      () => ({ status: 200, headers: { "mcp-session-id": "sess-abc" } }),
      () => ({
        status: 200,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: { tools: [{ name: "chrona_plan_generate" }, { name: "chrona_node_complete" }] },
        }),
      }),
    ]);

    const result = await probeMcpServer({
      baseUrl: "http://mcp.test",
      token: "bearer-tok",
      runId: "preflight",
    });
    expect(result.status).toBe(200);
    expect(result.sessionId).toBe("sess-abc");
    expect(result.toolNames).toEqual(["chrona_plan_generate", "chrona_node_complete"]);
  });

  it("throws McpProbeError on 401 with a hint about CHRONA_API_KEY", async () => {
    globalThis.fetch = makeFetchStub([
      () => ({ status: 401, body: "Missing or invalid Authorization header" }),
    ]);

    let caught: unknown;
    try {
      await probeMcpServer({
        baseUrl: "http://mcp.test",
        token: "wrong-token",
        runId: "preflight",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpProbeError);
    const err = caught as McpProbeError;
    expect(err.status).toBe(401);
    expect(err.mcpBaseUrl).toBe("http://mcp.test");
    expect(err.message).toMatch(/CHRONA_API_KEY/);
    expect(err.message).toMatch(/401/);
  });

  it("throws McpProbeError on 403", async () => {
    globalThis.fetch = makeFetchStub([
      () => ({ status: 403, body: "Forbidden" }),
    ]);

    expect(
      probeMcpServer({ baseUrl: "http://mcp.test", token: "tok", runId: "preflight" }),
    ).rejects.toMatchObject({ status: 403, mcpBaseUrl: "http://mcp.test" });
  });

  it("throws McpProbeError when the server returns 0 tools", async () => {
    globalThis.fetch = makeFetchStub([
      () => ({ status: 200, headers: { "mcp-session-id": "sess-empty" } }),
      () => ({
        status: 200,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [] } }),
      }),
    ]);

    expect(
      probeMcpServer({ baseUrl: "http://mcp.test", token: "tok", runId: "preflight" }),
    ).rejects.toMatchObject({ status: 200, toolCount: 0 });
  });

  it("probes WITHOUT an Authorization header when the token is empty (local no-auth server)", async () => {
    // A server without API_KEY accepts unauthenticated requests. An empty
    // token must NOT fail fast: we probe with no Authorization header and let
    // the server's response decide. Here the server is healthy and returns a
    // tool list, so the probe succeeds.
    const authHeaders: Array<string | null> = [];
    globalThis.fetch = mock(async (_url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
      const headers = new Headers(init.headers as Record<string, string> | undefined);
      authHeaders.push(headers.get("authorization"));
      if (authHeaders.length === 1) {
        return new Response("", { status: 200, headers: { "mcp-session-id": "sess-noauth" } });
      }
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "chrona_plan_generate" }] } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await probeMcpServer({
      baseUrl: "http://mcp.test",
      token: "",
      runId: "preflight",
    });
    expect(result.toolNames).toEqual(["chrona_plan_generate"]);
    // Neither the initialize nor the tools/list request carried an Authorization header.
    expect(authHeaders).toEqual([null, null]);
  });

  it("still surfaces a 401 with a CHRONA_API_KEY hint when an empty-token probe hits an auth-required server", async () => {
    // Server HAS API_KEY set → rejects the unauthenticated probe. The empty
    // token is only a problem because the server actually requires auth, and
    // the error stays actionable.
    globalThis.fetch = makeFetchStub([
      () => ({ status: 401, body: "Missing or invalid Authorization header" }),
    ]);

    let caught: unknown;
    try {
      await probeMcpServer({ baseUrl: "http://mcp.test", token: "", runId: "preflight" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpProbeError);
    expect((caught as McpProbeError).status).toBe(401);
    expect((caught as McpProbeError).message).toMatch(/CHRONA_API_KEY/);
  });

  it("throws McpProbeError on fetch network failure", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    expect(
      probeMcpServer({ baseUrl: "http://mcp.test", token: "tok", runId: "preflight" }),
    ).rejects.toMatchObject({ status: 0, mcpBaseUrl: "http://mcp.test" });
  });

  it("accepts SSE-framed tools/list responses", async () => {
    const sseBody =
      "event: message\n" +
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "chrona_plan_generate" }] },
      })}\n\n`;
    globalThis.fetch = makeFetchStub([
      () => ({ status: 200, headers: { "mcp-session-id": "sess-sse" } }),
      () => ({ status: 200, headers: { "content-type": "text/event-stream" }, body: sseBody }),
    ]);

    const result = await probeMcpServer({
      baseUrl: "http://mcp.test",
      token: "tok",
      runId: "preflight",
    });
    expect(result.toolNames).toEqual(["chrona_plan_generate"]);
  });
});
