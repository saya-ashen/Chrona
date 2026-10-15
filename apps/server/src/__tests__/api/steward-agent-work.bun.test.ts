import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { createChronaEngine, createManagementClient } from "@chrona/engine";
import { WORK_TOOLS } from "@chrona/contracts/steward";
import { createApiRouter } from "../../routes/api";
import { createStewardRuntime } from "../../steward-runtime";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

// TEST ONLY: a real HTTP server, the real runner and extension path lookup, and a fake `pi` that calls the agent endpoint.
const fakePi = resolve(import.meta.dir, "../fixtures/fake-pi-agent.ts");
const extension = resolve(import.meta.dir, "../../../../../external-plugins/pi-steward-agent/chrona-tools.ts");
const envKeys = ["API_KEY", "CHRONA_STEWARD_AGENT", "CHRONA_STEWARD_PI_COMMAND", "CHRONA_STEWARD_PI_AGENT_EXTENSION", "CHRONA_STEWARD_CHAT_RECIPIENTS", "CHRONA_STEWARD_ASSESSOR", "FAKE_PI_SCENARIO", "FAKE_PI_LOG"] as const;
let saved: Record<string, string | undefined>, dir: string, token: string, workspaceId: string, app: Hono, runtime: ReturnType<typeof createStewardRuntime>, server: ReturnType<typeof Bun.serve>;
beforeEach(async () => {
  saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  dir = mkdtempSync(resolve(tmpdir(), "chrona-agent-test-"));
  Object.assign(process.env, { API_KEY: "", CHRONA_STEWARD_AGENT: "pi", CHRONA_STEWARD_PI_COMMAND: fakePi, CHRONA_STEWARD_PI_AGENT_EXTENSION: extension, CHRONA_STEWARD_CHAT_RECIPIENTS: "qqbot:TESTOPENID", CHRONA_STEWARD_ASSESSOR: "rule", FAKE_PI_LOG: resolve(dir, "log") });
  await resetTestDb(); ({ workspaceId } = await seedWorkspace());
  ({ token } = await createManagementClient({ name: "Hermes chat bridge (test)", publicUrl: "http://localhost:3101", scopes: ["steward:read", "steward:chat"] }));
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => app.fetch(request) });
  runtime = createStewardRuntime(db, { port: server.port });
  app = new Hono().route("/api", createApiRouter(createChronaEngine(), { steward: runtime }));
});
afterEach(async () => {
  await runtime?.stop(); server?.stop(true);
  for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  rmSync(dir, { recursive: true, force: true });
});
const log = () => existsSync(resolve(dir, "log")) ? readFileSync(resolve(dir, "log"), "utf8") : "";
const chat = (userText: string) => ({ route: "chrona_command", platform: "qqbot", chatType: "dm", userId: "TESTOPENID", chatId: "TESTOPENID", messageId: crypto.randomUUID(), userText });
async function rpc(tool: string, args: unknown) {
  const response = await app.request("/api/mcp/management", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: `chrona_steward_chat_${tool}`, arguments: args } }) });
  const envelope = await response.json() as any; expect(envelope.result.structuredContent.ok).toBe(true); return envelope.result.structuredContent.data.result;
}
async function detail(affairId: string) { const response = await app.request(`/api/steward/affairs/${affairId}?workspaceId=${workspaceId}`); if (response.status !== 200) console.error(await response.clone().text()); expect(response.status).toBe(200); return response.json() as Promise<any>; }
const agent = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${server.port}/api/steward-agent${path}`, init);

test("a chat request is handled by the agent through scoped tools and publishes a result", async () => {
  const receipt = await rpc("request", { requestId: crypto.randomUUID(), chat: chat("/chrona 帮我比较几种备份方案"), text: "帮我比较几种备份方案" });
  expect(receipt).toMatchObject({ status: "received" });
  await runtime.agent.runAgentOnce();
  const work = (await detail(receipt.affairId)).works[0];
  expect(work).toMatchObject({ status: "result_ready", resultVersion: 1 });
  expect(work.resultHref).toMatch(/^\/tasks\/.+\/results$/);
  expect(work.attempts[0].toolCalls.map((call: any) => call.tool)).toEqual(["chrona_get_context", "web_search", "chrona_save_progress", "chrona_publish_result"]);
  const lines = log();
  // After the terminal tool the run's token is dead: later calls never reach a tool.
  expect(lines).toContain('after:{"ok":false,"error":{"code":"UNAUTHORIZED","message":"UNAUTHORIZED"}}');
  expect(lines).toContain("env:CHRONA_AGENT_TOKEN,CHRONA_AGENT_URL\n");
  expect(lines).toContain("--no-builtin-tools"); expect(lines).not.toContain("--approve");
  expect(lines).toContain(`catalog:${WORK_TOOLS.join(",")}`);
  expect(lines).toContain('web:true:{"queries":["backup tools comparison"],"workflow":"none","includeContent":false,"numResults":8}');
  const version = await db.taskResultVersion.findFirstOrThrow({ where: { result: { workspaceId } } });
  const evidence = (version.content as any).evidence.map((e: any) => e.summary.split("：")[0]);
  expect(evidence).toEqual(["本次检索取得", "未在本次检索中核实"]);
  const notifications = await db.stewardNotification.findMany({ where: { workspaceId } });
  expect(notifications.map(n => [n.channel, n.recipient])).toEqual([["hermes_qqbot", "qqbot:TESTOPENID"]]);
});

test("clarification binds the user's answer to the same work and resumes it", async () => {
  process.env.FAKE_PI_SCENARIO = "ask";
  const receipt = await rpc("request", { requestId: crypto.randomUUID(), chat: chat("/chrona 帮我准备答辩"), text: "帮我准备答辩" });
  await runtime.agent.runAgentOnce();
  expect((await detail(receipt.affairId)).works[0]).toMatchObject({ status: "waiting_input" });
  const ask = await db.attentionItem.findFirstOrThrow({ where: { workspaceId, kind: "decision", affairId: receipt.affairId } });
  const ref = (await db.attentionItem.findUniqueOrThrow({ where: { id: ask.id } })).replyRef ?? (await rpc("pending", { chat: chat("/chrona 委托") }), (await db.attentionItem.findUniqueOrThrow({ where: { id: ask.id } })).replyRef);
  expect(ref).toBeTruthy();
  const answer = await rpc("respond", { requestId: crypto.randomUUID(), chat: chat(`/chrona ${ref} 补充 周五下午，硕士论文`), ref, action: "feedback", note: "周五下午，硕士论文" });
  expect(answer).toMatchObject({ status: "applied" });
  await runtime.agent.runAgentOnce();
  const work = (await detail(receipt.affairId)).works[0];
  expect(work.status).toBe("result_ready");
  expect(work.attempts.map((a: any) => a.status)).toEqual(["result_published", "asked_user"]);
  expect(log()).toContain('inputs:["周五下午，硕士论文"]');
});

test("the agent endpoint refuses proxied, unauthenticated and stale callers", async () => {
  expect((await agent("/catalog")).status).toBe(401);
  expect((await agent("/catalog", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  expect((await agent("/tools/chrona_get_context", { method: "POST", headers: { authorization: "Bearer nope", "x-forwarded-for": "203.0.113.1", "content-type": "application/json" }, body: "{}" })).status).toBe(403);
  const receipt = await rpc("request", { requestId: crypto.randomUUID(), chat: chat("/chrona 查点东西"), text: "查点东西" });
  await runtime.agent.runAgentOnce();
  // The run is over, so its token no longer works for anything.
  const attempts = (await detail(receipt.affairId)).works[0].attempts;
  expect(attempts).toHaveLength(1);
  expect((await agent("/catalog", { headers: { authorization: `Bearer ${"x".repeat(43)}` } })).status).toBe(401);
});
