import { expect, test } from "bun:test";
import bridge from "../../../../external-plugins/pi-steward-agent/chrona-tools";

type Tool = Parameters<Parameters<typeof bridge>[0]["registerTool"]>[0];
async function withBridge(base: string, fetcher: typeof fetch, run: (tools: Tool[]) => Promise<void>) {
  const originalFetch = globalThis.fetch, url = process.env.CHRONA_AGENT_URL, token = process.env.CHRONA_AGENT_TOKEN;
  process.env.CHRONA_AGENT_URL = base; process.env.CHRONA_AGENT_TOKEN = "bridge-token";
  globalThis.fetch = fetcher;
  try {
    const tools: Tool[] = [];
    // No on/sendUserMessage methods: old lifecycle hooks would fail this test.
    await bridge({ registerTool: tool => { tools.push(tool); } });
    await run(tools);
  } finally {
    globalThis.fetch = originalFetch;
    if (url === undefined) delete process.env.CHRONA_AGENT_URL; else process.env.CHRONA_AGENT_URL = url;
    if (token === undefined) delete process.env.CHRONA_AGENT_TOKEN; else process.env.CHRONA_AGENT_TOKEN = token;
  }
}
const base = "http://127.0.0.1:1234/api/steward-agent";
test("bridge registers catalog schemas, forwards calls, never terminates or nudges", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const parameters = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return Response.json(String(url).endsWith("/catalog") ? { tools: [{ name: "chrona_reply", description: "Reply", parameters }] } : { ok: true, data: { messageId: "id" } });
  }) as typeof fetch;
  await withBridge(base, fetcher, async tools => {
    expect(tools).toHaveLength(1); expect(tools[0].parameters).toEqual(parameters);
    const result = await tools[0].execute("call", { text: "hello" });
    expect(result.content[0].text).toBe('{"messageId":"id"}');
    expect("terminate" in result).toBe(false);
    expect(seen.map(s => s.url)).toEqual([`${base}/catalog`, `${base}/tools/chrona_reply`]);
    expect(seen[0].init?.method).toBe("GET"); expect(seen[1].init?.method).toBe("POST");
    expect(seen[1].init?.body).toBe('{"text":"hello"}');
    expect(seen[1].init?.redirect).toBe("error");
    expect(seen[1].init?.headers).toEqual({ authorization: "Bearer bridge-token", "content-type": "application/json" });
  });
});
test("bridge refuses non-loopback URLs without sending the capability", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error("must not fetch"); }) as unknown as typeof fetch;
  for (const url of ["https://example.org/api/steward-agent", "http://127.0.0.1:1234/api/steward-agent@evil", "http://localhost:1234/api/steward-agent"]) {
    await withBridge(url, fetcher, async tools => { expect(tools).toHaveLength(0); });
  }
  expect(calls).toBe(0);
});
test("bridge preserves refusal and cancellation and redacts run token", async () => {
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/catalog")) return Response.json({ tools: [{ name: "chrona_send_email", description: "Send", parameters: {} }] });
    init?.signal?.throwIfAborted();
    return Response.json({ ok: false, error: { code: "forbidden", message: "bridge-token refused" } });
  }) as typeof fetch;
  await withBridge(base, fetcher, async tools => {
    await expect(tools[0].execute("call", {})).rejects.toThrow("forbidden: [redacted] refused");
    await expect(tools[0].execute("call", {}, AbortSignal.abort())).rejects.toThrow();
  });
});
