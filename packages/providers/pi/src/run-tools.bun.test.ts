import { afterEach, describe, expect, it } from "bun:test";
import type { StartRunInput } from "@chrona/providers-foundation";
import { PiRunTools } from "./run-tools";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(ack: Record<string, unknown> = { ok: true, kind: "complete", recorded: true }) {
  const calls: string[] = [];
  const payloads: unknown[] = [];
  const token = "local-fixture-token";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 401 });
    if (req.method !== "POST") return new Response(null, { status: 405 });
    const body = await req.json() as Record<string, unknown>;
    const path = new URL(req.url).pathname;
    if (path === "/api/agent/control") { calls.push("control"); payloads.push(body); return Response.json(ack); }
    const method = String(body.method); calls.push(method);
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = method === "initialize" ? {
      protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" },
    } : method === "tools/list" ? { tools: [
      { name: "chrona.node.complete", description: "complete", inputSchema: { type: "object" } },
      { name: "chrona.context.read", description: "read", inputSchema: { type: "object" } },
    ] } : { content: [{ type: "text", text: "bounded context" }] };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  } });
  const input: StartRunInput = { clientOperationId: "fixture", sessionId: "fixture", instructions: "fixture", input: "fixture", toolPolicy: "full",
    control: { baseUrl: `${server.url}api`, runToken: token }, terminalToolName: "chrona_node_complete" };
  const tools = new PiRunTools(input, AbortSignal.timeout(5000));
  cleanups.push(async () => { await tools.close(); await server.stop(true); });
  await tools.initialize();
  return { tools, calls, payloads, token };
}

describe("Pi scoped execution tool bridge", () => {
  it("uses MCP for tools but requires durable control acknowledgement for terminal actions", async () => {
    const f = await fixture();
    expect(JSON.stringify(f.tools.tools)).not.toContain(f.token);
    expect((await f.tools.call("chrona_context_read", {})).content[0]?.text).toContain("bounded context");
    expect((await f.tools.call("chrona_node_complete", { summary: "done" })).terminate).toBe(true);
    expect(f.calls.filter((call) => call === "tools/call")).toHaveLength(1);
    expect(f.payloads).toEqual([{ body: { kind: "complete", payload: { summary: "done" } } }]);
    await expect(f.tools.call("chrona_node_complete", { summary: "done" })).rejects.toThrow("already submitted");
    await expect(f.tools.call("chrona_context_read", {})).rejects.toThrow("already submitted");
    expect(f.calls.filter((call) => call === "control")).toHaveLength(1);
  });
  it.each([{ ok: true }, { ok: true, recorded: true, kind: "fail" }, { ok: false }])("does not replay an uncertain/rejected terminal submission: %j", async (ack) => {
    const f = await fixture(ack);
    await expect(f.tools.call("chrona_node_complete", {})).rejects.toThrow("acknowledge");
    await expect(f.tools.call("chrona_node_complete", {})).rejects.toThrow("already submitted");
    expect(f.calls.filter((call) => call === "control")).toHaveLength(1);
  });
  it("accepts a same-kind alreadyAccepted acknowledgement", async () => {
    const f = await fixture({ ok: true, kind: "complete", alreadyAccepted: true });
    expect((await f.tools.call("chrona_node_complete", {})).terminate).toBe(true);
  });
  it.each(["https://example.invalid", "http://user:pass@localhost", "http://localhost/?token=secret"])("rejects unsafe control URLs before connecting: %s", async (baseUrl) => {
    const input: StartRunInput = { clientOperationId: "fixture", sessionId: "fixture", input: "", instructions: "", toolPolicy: "full", control: { baseUrl, runToken: "fixture" } };
    await expect(new PiRunTools(input, new AbortController().signal).initialize()).rejects.toThrow("loopback");
  });
});
