import { afterAll, beforeAll, expect, test } from "bun:test";
import { createStewardService, type StewardPorts } from "./service";
import { testDb } from "./test-db";
const db = testDb();
let script: (token: string) => Promise<void> = async () => {};
const ports: StewardPorts = { db, now: () => new Date(), publicUrl: null, sources: [], deliveries: [], assessor: { name: "test", assess: async () => { throw new Error("unused"); } }, chat: null, agentHealth: () => ({ available: true, name: "fake", lastError: null }), agent: { runAffair: async () => {}, runConcierge: async ({ token }) => script(token) } };
const service = createStewardService(ports), s = service.forWorkspace("owner");
const send = (text = "请帮我调查", externalId?: string) => s.chat.handleMessage({ channel: "in_app", text, externalId });
async function call(token: string, name: string, raw: unknown) {
  const reply = await service.agentEndpoint.callTool(token, name, raw);
  expect(reply.ok).toBe(true); return reply;
}
const reply = (token: string) => call(token, "concierge_reply", { text: "好的" });
beforeAll(async () => { await db.workspace.create({ data: { id: "owner", name: "Owner" } }); await db.workspace.create({ data: { id: "other", name: "Other" } }); });
afterAll(() => db.$disconnect());
test("new affair stores user request, context and both chat messages", async () => {
  script = async token => {
    await call(token, "concierge_context", {});
    await call(token, "concierge_create_affair", { title: "调查", request: "调查价格" });
    await reply(token);
    expect((await service.agentEndpoint.callTool(token, "concierge_remember", { text: "too late" })).ok).toBe(false);
  };
  const result = await send();
  expect(result.effects[0]?.kind).toBe("create_affair");
  expect((await s.affairs.detail(result.affairId!)).entries[0]?.text).toBe("调查价格");
  expect((await s.chat.messages(2)).map(m => m.affairId)).toEqual([result.affairId, result.affairId]);
});
test("add feedback to existing affair", async () => {
  const a = await s.affairs.create({ request: "existing" });
  script = async token => { await call(token, "concierge_add_to_affair", { affairId: a.id, kind: "feedback", text: "换方向" }); await reply(token); };
  expect((await send()).affairId).toBe(a.id);
  expect((await s.affairs.detail(a.id)).entries.some(e => e.text === "换方向")).toBe(true);
});
test("resolve approval creates scoped grant", async () => {
  const a = await s.affairs.create({ request: "approval" });
  const ask = await s.asks.createApproval({ affairId: a.id, title: "允许脚本？", action: "run_script" });
  script = async token => { await call(token, "concierge_resolve_ask", { askId: ask.id, decision: "approve" }); await reply(token); };
  expect((await send()).effects[0]?.label).toBe("已同意：允许脚本？");
  expect((await s.affairs.detail(a.id)).grants).toHaveLength(1);
});
test("pause affair", async () => {
  const a = await s.affairs.create({ request: "pause" });
  script = async token => { await call(token, "concierge_set_affair_status", { affairId: a.id, status: "paused" }); await reply(token); };
  await send(); expect((await s.affairs.detail(a.id)).affair.status).toBe("paused");
});
test("remember said preference and mark context use", async () => {
  script = async token => { await call(token, "concierge_remember", { text: "简短回复" }); await call(token, "concierge_context", {}); await reply(token); };
  await send(); const p = (await s.preferences.list()).find(p => p.text === "简短回复");
  expect(p?.origin).toBe("said"); expect(p?.lastUsedAt).not.toBeNull();
});
test("direct answer creates no affair", async () => {
  const before = await db.affair.count(); script = async token => { await reply(token); };
  expect((await send()).affairId).toBeNull(); expect(await db.affair.count()).toBe(before);
});
test("no reply falls back losslessly", async () => {
  script = async () => {}; const result = await send("原始需求");
  expect(result.reply).toBe("收到，我记下了，会在后台处理。");
  expect((await s.affairs.detail(result.affairId!)).entries[0]?.text).toBe("原始需求");
});
test("null agent ref fallback approves and pauses", async () => {
  const offline = createStewardService({ ...ports, agent: null }).forWorkspace("owner");
  const a = await s.affairs.create({ request: "offline" });
  const ask = await s.asks.createApproval({ affairId: a.id, title: "同意吗", action: "run_script" });
  expect((await offline.chat.handleMessage({ channel: "in_app", text: `${ask.ref} 同意` })).effects[0]?.kind).toBe("resolve_ask");
  await offline.chat.handleMessage({ channel: "in_app", text: `${a.ref} 暂停` });
  expect((await s.affairs.detail(a.id)).affair.status).toBe("paused");
});
test("externalId dedupes concurrent calls and persists across service recreation", async () => {
  let calls = 0; script = async token => { calls++; await reply(token); };
  const [a, b] = await Promise.all([send("去重", "same"), send("去重", "same")]);
  expect(a).toEqual(b); expect(calls).toBe(1);
  const restarted = createStewardService({ ...ports, agent: null });
  expect(await restarted.chat.handleMessage({ workspaceId: "owner", channel: "in_app", text: "去重", externalId: "same" })).toEqual(a);
});
test("cross-workspace ids rejected for affairs, asks and preferences", async () => {
  const other = service.forWorkspace("other"), a = await other.affairs.create({ request: "private" });
  const p = await other.preferences.add({ text: "private" });
  const ask = await other.asks.createApproval({ affairId: a.id, title: "private", action: "run_script" });
  script = async token => {
    for (const [name, raw] of [["concierge_set_affair_status", { affairId: a.id, status: "done" }], ["concierge_add_to_affair", { affairId: a.id, kind: "feedback", text: "bad" }], ["concierge_forget", { preferenceId: p.id }], ["concierge_resolve_ask", { askId: ask.id, decision: "approve" }]] as const) expect((await service.agentEndpoint.callTool(token, name, raw)).ok).toBe(false);
    await reply(token);
  };
  expect((await send()).effects).toHaveLength(0);
});
test("ambiguous or negated ref commands never approve", async () => {
  const offline = createStewardService({ ...ports, agent: null }).forWorkspace("owner");
  const a = await s.affairs.create({ request: "safe fallback" });
  const ask = await s.asks.createApproval({ affairId: a.id, title: "授权？", action: "run_script" });
  for (const text of [`${ask.ref} 不同意`, `${ask.ref} 同意还是拒绝`, `${ask.ref} ${a.ref} 同意`]) {
    expect((await offline.chat.handleMessage({ channel: "in_app", text })).effects[0]?.kind).toBe("create_affair");
  }
  expect((await db.ask.findUniqueOrThrow({ where: { id: ask.id } })).status).toBe("open");
});
test("ten tool calls maximum; fallback retains already-applied effects", async () => {
  script = async token => {
    await call(token, "concierge_remember", { text: "budget preference" });
    for (let i = 1; i < 10; i++) await call(token, "concierge_context", {});
    expect((await service.agentEndpoint.callTool(token, "concierge_reply", { text: "late" })).ok).toBe(false);
  };
  const result = await send();
  expect(result.effects.map(e => e.kind)).toEqual(["remember", "create_affair"]);
});
test("expired session rejects effects and falls back", async () => {
  const now = ports.now;
  script = async token => {
    ports.now = () => new Date(Date.now() + 100_000);
    expect((await service.agentEndpoint.callTool(token, "concierge_remember", { text: "expired" })).ok).toBe(false);
  };
  try { expect((await send()).effects[0]?.kind).toBe("create_affair"); } finally { ports.now = now; }
});
test("web URL rules, budget, observations and revoked capability", async () => {
  let saved = "";
  script = async token => {
    saved = token;
    expect((await service.agentEndpoint.webPreflight(token, { tool: "fetch_content", input: { url: "http://127.0.0.1/" } })).allow).toBe(false);
    for (let i = 0; i < 4; i++) expect((await service.agentEndpoint.webPreflight(token, { tool: "web_search", input: { query: "weather" } })).allow).toBe(true);
    expect((await service.agentEndpoint.webPreflight(token, { tool: "web_search", input: { query: "weather" } })).allow).toBe(false);
    expect((await service.agentEndpoint.webObserved(token, { tool: "web_search", urls: ["https://example.com"] })).ok).toBe(true);
    await reply(token);
  };
  await send(); expect((await service.agentEndpoint.callTool(saved, "concierge_context", {})).ok).toBe(false);
});
