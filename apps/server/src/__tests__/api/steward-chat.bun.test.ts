import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQqBotState, type QqC2cMessage } from "@chrona/integrations/steward";
import { testDb } from "../../../../../packages/engine/src/modules/steward/test-db";
import { createStewardRuntime } from "../../steward-runtime";
import { createStewardQqBot } from "../../steward-qq-bot";
import { createApiRouter } from "../../routes/api";
let db: ReturnType<typeof testDb>, runtime: ReturnType<typeof createStewardRuntime>, dir: string;
let key: string | undefined, gate: string | undefined;
beforeEach(async () => {
  key = process.env.API_KEY; gate = process.env.CHRONA_E2E_TEST_ROUTES;
  process.env.API_KEY = "test-owner"; process.env.CHRONA_E2E_TEST_ROUTES = "1";
  db = testDb(); dir = mkdtempSync(join(tmpdir(), "chrona-chat-"));
  for (const id of ["w", "other"]) await db.workspace.create({ data: { id, name: id } });
  runtime = createStewardRuntime(db, { now: () => new Date("2026-10-15T04:00:00Z") }); runtime.installTestAgent();
});
afterEach(async () => {
  await runtime.stop(); await db.$disconnect(); rmSync(dir, { recursive: true, force: true });
  if (key === undefined) delete process.env.API_KEY; else process.env.API_KEY = key;
  if (gate === undefined) delete process.env.CHRONA_E2E_TEST_ROUTES; else process.env.CHRONA_E2E_TEST_ROUTES = gate;
});
function request(path: string, body?: unknown, workspace = "w", token = "test-owner") {
  return createApiRouter({ steward: runtime }).request(`http://localhost${path}?workspaceId=${workspace}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test("POST chat uses fake concierge; tick publishes one-source result and test delivery", async () => {
  expect((await request("/test/steward/agent/install", {})).status).toBe(200);
  const response = await request("/steward/chat", { text: "调研一个测试主题" }); expect(response.status).toBe(200);
  const reply = await response.json(); expect(reply.reply).toBe("收到"); expect(reply.affairId).toBeString();
  expect((await request("/test/steward/tick", {})).status).toBe(200);
  const result = await (await request(`/steward/affairs/${reply.affairId}/results/1`)).json();
  expect(result.title).toBe("Test result v1"); expect(result.sources).toHaveLength(1); expect(result.sources[0].verified).toBe(false);
  expect(await db.affairResult.count()).toBe(1);
  expect((await (await request("/test/steward/delivery/sent")).json()).items.length).toBeGreaterThan(0);
});
test("QQ wiring shares concierge and binding state with fake transport; no network", async () => {
  let onMessage: ((message: QqC2cMessage) => void) | undefined;
  const sent: { content: string; replyTo?: string | null; msgSeq?: number }[] = [];
  const bot = createStewardQqBot({ db, publicUrl: null, env: { CHRONA_QQ_APP_ID: "123456", CHRONA_QQ_STATE_DIR: dir, CHRONA_QQ_SECRET_FILE: "/never-read" }, transport: {
    send: async input => { sent.push(input); return { outcome: "accepted", messageId: "receipt" }; },
    gateway: options => { onMessage = options.onMessage; return { start() {}, async stop() {}, status: () => ({ state: "stopped", appId: "123456", readyAt: null, lastEventAt: null, reconnects: 0, lastCloseCode: null, resumable: false }) }; },
  } })!;
  runtime.ports.chat = { channel: "chrona_qqbot", bound: bot.bound };
  await bot.start(runtime.service, () => {});
  async function say(id: string, openid: string, content: string) {
    onMessage!({ id, openid, content, quoted: "", timestamp: new Date().toISOString() });
    // Drain handler without stopping its state; the status write follows the reply.
    await new Promise(r => setTimeout(r, 20));
  }
  try {
    await say("unbound", "U1", "hello"); expect(sent.at(-1)!.content).toContain("尚未绑定");
    const state = createQqBotState(dir, "123456"), challenge = await state.createChallenge({ workspaceId: "w" });
    await say("bind", "U1", `绑定 ${challenge.code}`); expect(await bot.bound()).toBe(true);
    await say("stranger", "U2", "hello"); expect(sent.at(-1)!.content).toContain("没有使用权限");
    await say("owner", "U1", "Prepare a fixture");
    await bot.stop();
    expect(sent.at(-1)).toMatchObject({ content: "收到", replyTo: "owner", msgSeq: 1 });
    await say("owner", "U1", "duplicate"); await bot.stop();
    expect(await db.chatMessage.count({ where: { direction: "in" } })).toBe(1);
    expect(await db.chatMessage.findFirst({ where: { direction: "in" } })).toMatchObject({ channel: "chrona_qqbot", externalId: "owner", workspaceId: "w" });
    const before = sent.length;
    onMessage!({ id: "expired", openid: "U1", content: "Another request", quoted: "", timestamp: new Date(Date.now() - 3600_000).toISOString() });
    await bot.stop();
    expect(sent).toHaveLength(before);
    expect(await db.notification.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: "w", idempotencyKey: "qq-final:expired" } } })).toMatchObject({ body: "收到", recipient: "chrona_qq:U1", channel: "chrona_qqbot" });
  } finally { await bot.stop(); }
});
test("seam requires gate, owner and workspace; reset is scoped and local sources are isolated", async () => {
  expect((await request("/test/steward/reset", {}, "w", "wrong")).status).toBe(401);
  expect((await request("/test/steward/reset", {}, "missing")).status).toBe(404);
  const other = await runtime.service.forWorkspace("other").affairs.create({ request: "Keep me" });
  await runtime.service.forWorkspace("w").preferences.add({ text: "Reset me" }, "said");
  for (const workspace of ["w", "other"]) await runtime.service.forWorkspace(workspace).connections.create({ kind: "local_test", label: "Fixture" });
  expect((await request("/test/steward/local-source/push", { items: [{ externalId: "fixture", title: "Fixture", body: "Test", author: "Test", url: null, occurredAt: new Date().toISOString() }] })).status).toBe(200);
  await runtime.service.tick();
  expect(await db.inboundEvent.count({ where: { workspaceId: "other" } })).toBe(0);
  expect((await request("/test/steward/reset", {})).status).toBe(200);
  expect(await db.preference.count({ where: { workspaceId: "w" } })).toBe(0);
  expect(await db.affair.findUnique({ where: { id: other.id } })).not.toBeNull();
  delete process.env.CHRONA_E2E_TEST_ROUTES;
  expect((await request("/test/steward/agent/install", {})).status).toBe(404);
});
