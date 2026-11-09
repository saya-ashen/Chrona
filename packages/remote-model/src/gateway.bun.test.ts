import { afterEach, expect, test } from "bun:test";
import { createRemoteModelGateway } from "./gateway";
import { decodeAnswer, encodeRequest, PROMPT_PROTOCOL } from "./protocol";

const gateways: ReturnType<typeof createRemoteModelGateway>[] = [];
afterEach(() => { for (const gateway of gateways.splice(0)) gateway.close(); });
const body = { model: "execution", stream: true, max_tokens: 200, messages: [{ role: "user", content: "hello" }] };
function setup(model: Parameters<typeof createRemoteModelGateway>[0]["model"], maxModelCalls = 2) {
  const gateway = createRemoteModelGateway({ deadlineAt: new Date(Date.now() + 5000).toISOString(), budget: { maxModelCalls, maxOutputTokens: 100 }, model });
  gateways.push(gateway);
  return { ...gateway, request: (raw: unknown = body, token = gateway.token) => fetch(`${gateway.baseUrl}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(raw) }) };
}
const completed = { status: "completed", reservationId: "reservation", result: { text: JSON.stringify({ version: 1, content: "governed answer", tool_calls: [] }), inputTokens: null, outputTokens: null } };
test("authenticated loopback completion preserves structured transcript, clamps cap, and omits unknown usage", async () => {
  let input: unknown, key = "", calls = 0;
  const gateway = setup(async (k, value) => { calls++; key = k; input = value; return completed; }, 1);
  expect((await gateway.request(body, "wrong")).status).toBe(401);
  expect(calls).toBe(0);
  const response = await gateway.request();
  expect(response.status).toBe(200);
  const sse = await response.text();
  expect(sse).toContain("governed answer"); expect(sse).not.toContain('"usage"');
  expect(key).toMatch(/^pi-model-/);
  expect(input).toMatchObject({ maxOutputTokens: 100 });
  expect(JSON.parse((input as { prompt: string }).prompt)).toMatchObject({ protocol: PROMPT_PROTOCOL, messages: body.messages, tools: [] });
  expect((await gateway.request()).status).toBe(409); expect(calls).toBe(1);
});
for (const outcome of ["pending", "throw", "malformed", "excess-usage"] as const) test(`${outcome} model outcome latches proxy closed without issuing a second key`, async () => {
  let calls = 0;
  const gateway = setup(async () => { calls++; if (outcome === "throw") throw new Error("unknown response"); if (outcome === "pending") return { status: "pending", reservationId: "retained", error: null }; if (outcome === "malformed") return { ...completed, result: { ...completed.result, text: "not a protocol answer" } }; return { ...completed, result: { ...completed.result, outputTokens: 101 } }; });
  expect((await gateway.request()).status).toBe(502);
  expect((await gateway.request()).status).toBe(409); expect(calls).toBe(1);
});
test("unsupported modalities and generation controls fail before reservation", async () => {
  let calls = 0;
  const gateway = setup(async () => { calls++; return completed; });
  expect((await gateway.request({ ...body, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }] })).status).toBe(502);
  expect(calls).toBe(0);
  expect(() => encodeRequest({ ...body, temperature: 0.4 }, 100)).toThrow();
});
test("invalid UTF-8 is refused before any durable model reservation", async () => {
  let calls = 0;
  const gateway = setup(async () => { calls++; return completed; });
  const prefix = new TextEncoder().encode('{"model":"execution","stream":true,"max_tokens":200,"messages":[{"role":"user","content":"');
  const suffix = new TextEncoder().encode('"}]}');
  const bytes = new Uint8Array([...prefix, 255, ...suffix]);
  const response = await fetch(`${gateway.baseUrl}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${gateway.token}` }, body: bytes });
  expect(response.status).toBe(502); expect(calls).toBe(0);
  expect((await gateway.request()).status).toBe(409);
});
test("tool protocol preserves tool call/results and rejects unadvertised or duplicate calls", () => {
  const request = { ...body, tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { path: { type: "string" } } } } }], messages: [...body.messages, { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: '{"path":"fixture.txt"}' } }] }, { role: "tool", tool_call_id: "c1", content: "fixture data" }] };
  const encoded = encodeRequest(request, 100);
  expect(JSON.parse(encoded.input.prompt).messages).toEqual(request.messages);
  const call = { id: "c2", name: "read", arguments: { path: "second.txt" } };
  expect(decodeAnswer(JSON.stringify({ version: 1, content: null, tool_calls: [call] }), encoded.tools).tool_calls).toEqual([call]);
  expect(() => decodeAnswer(JSON.stringify({ version: 1, content: null, tool_calls: [call, call] }), encoded.tools)).toThrow();
  expect(() => decodeAnswer(JSON.stringify({ version: 1, content: null, tool_calls: [{ ...call, name: "unadvertised" }] }), encoded.tools)).toThrow();
});
