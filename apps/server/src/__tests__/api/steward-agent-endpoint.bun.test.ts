import { afterEach, beforeEach, expect, test } from "bun:test";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { testDb } from "../../../../../packages/engine/src/modules/steward/test-db";
import { createStewardAgentRoutes } from "../../routes/steward-agent.routes";

let db: ReturnType<typeof testDb>, now: Date, service: ReturnType<typeof createStewardService>, app: ReturnType<typeof createStewardAgentRoutes>;
let script: (token: string) => Promise<void>;
function request(path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
beforeEach(async () => {
  db = testDb(); now = new Date(); script = async () => {};
  await db.workspace.create({ data: { id: "w", name: "Test" } });
  const ports: StewardPorts = { db, now: () => now, publicUrl: null, sources: [], deliveries: [], chat: null, assessor: { name: "fake", assess: async () => { throw new Error("unused"); } }, agentHealth: () => ({ available: true, name: "fake", lastError: null }), agent: { runAffair: async () => {}, runConcierge: ({ token }) => script(token) } };
  service = createStewardService(ports); app = createStewardAgentRoutes(ports, service);
});
afterEach(() => db.$disconnect());
async function claim() { await service.forWorkspace("w").affairs.create({ request: "Research" }); return (await service.runs.claimNext())!; }
test("affair catalog maps extension parameters and terminal tools", async () => {
  const { token } = await claim(); const res = await request("/catalog", token);
  expect(res.status).toBe(200); const { tools } = await res.json();
  expect(tools.find((t: { name: string }) => t.name === "chrona_publish_result")).toMatchObject({ terminal: true, parameters: { type: "object" } });
  expect(tools.some((t: { name: string }) => t.name.startsWith("concierge_"))).toBe(false);
});
test("missing, invalid, expired tokens rejected; forwarded requests refused", async () => {
  expect((await request("/catalog")).status).toBe(401);
  expect((await request("/catalog", "wrong")).status).toBe(401);
  const c = await claim(); expect((await request("/catalog", c.token, undefined, { forwarded: "for=127.0.0.1" })).status).toBe(403);
  now = c.deadlineAt; expect((await request("/catalog", c.token)).status).toBe(401);
});
test("HTTP tool effects and web budget boundary", async () => {
  const { token } = await claim();
  expect((await (await request("/tools/chrona_save_progress", token, { summary: "Working" })).json()).ok).toBe(true);
  expect((await (await request("/web/preflight", token, { tool: "fetch_content", input: { url: "http://127.0.0.1/" } })).json()).allow).toBe(false);
  expect((await (await request("/web/preflight", token, { tool: "web_search", input: { query: "public research" } })).json()).allow).toBe(true);
  expect((await (await request("/web/observed", token, { tool: "web_search", urls: ["https://example.com/"], titles: [] })).json()).ok).toBe(true);
});
test("concierge token uses same service, distinct catalog and terminal reply", async () => {
  let saved = "";
  script = async token => {
    saved = token; const { tools } = await (await request("/catalog", token)).json();
    expect(tools.some((t: { name: string }) => t.name === "concierge_reply")).toBe(true);
    expect(tools.some((t: { name: string }) => t.name === "chrona_publish_result")).toBe(false);
    expect((await (await request("/tools/concierge_reply", token, { text: "Hello" })).json()).ok).toBe(true);
  };
  expect((await service.forWorkspace("w").chat.handleMessage({ channel: "in_app", text: "Hello" })).reply).toBe("Hello");
  expect((await request("/catalog", saved)).status).toBe(401);
});
test("capabilities cannot switch role or workspace, and terminal tools revoke access", async () => {
  await db.workspace.create({ data: { id: "other", name: "Other" } });
  const other = await service.forWorkspace("other").affairs.create({ request: "Private" });
  await service.forWorkspace("other").affairs.update(other.id, { status: "paused" });
  const { token, affairId } = await claim();
  const context = await (await request("/tools/chrona_get_context", token, {})).json();
  expect(context.ok).toBe(true);
  expect(JSON.stringify(context)).not.toContain(other.id);
  expect(JSON.stringify(context)).toContain(affairId);
  expect((await (await request("/tools/concierge_reply", token, { text: "No" })).json()).ok).toBe(false);
  expect((await (await request("/tools/chrona_save_progress", token, { summary: "No", affairId: other.id })).json()).ok).toBe(false);
  expect((await (await request("/tools/chrona_close", token, { outcome: "done", reason: "Done" })).json()).ok).toBe(true);
  expect((await request("/catalog", token)).status).toBe(401);
});
test("invalid JSON and oversized capability requests fail at transport boundary", async () => {
  const { token } = await claim();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  expect((await app.request("http://localhost/tools/chrona_get_context", { method: "POST", headers, body: "{" })).status).toBe(400);
  expect((await app.request("http://localhost/tools/chrona_get_context", { method: "POST", headers, body: "x".repeat(65537) })).status).toBe(413);
  expect((await (await request("/web/observed", token, { tool: "unknown", urls: [] })).json()).ok).toBe(false);
});
