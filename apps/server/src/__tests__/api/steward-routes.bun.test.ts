import { afterEach, beforeEach, expect, test } from "bun:test";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { testDb } from "../../../../../packages/engine/src/modules/steward/test-db";
import { createStewardRoutes } from "../../routes/steward.routes";
import { createLocalTestSource } from "@chrona/integrations/steward";
let ports: StewardPorts;
let db: ReturnType<typeof testDb>, app: ReturnType<typeof createStewardRoutes>, service: ReturnType<typeof createStewardService>, key: string | undefined, wakes: number;
function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", workspace = "w", token = "test-owner") {
  return app.request(`http://localhost${path}${path.includes("?") ? "&" : "?"}workspaceId=${workspace}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
beforeEach(async () => {
  key = process.env.API_KEY; process.env.API_KEY = "test-owner"; wakes = 0; db = testDb();
  for (const id of ["w", "other"]) await db.workspace.create({ data: { id, name: id } });
  ports = { db, now: () => new Date(), publicUrl: null, sources: [createLocalTestSource().adapter], deliveries: [], chat: null, agent: null, assessor: { name: "fake", assess: async () => { throw new Error("unused"); } }, agentHealth: () => ({ available: false, name: "fake", lastError: null }) };
  service = createStewardService(ports); app = createStewardRoutes(ports, service, () => { wakes++; });
});
afterEach(async () => { if (key === undefined) delete process.env.API_KEY; else process.env.API_KEY = key; await db.$disconnect(); });
test("panel entries validate, isolate, order and audit", async () => {
  const spec = { title: "Weight", fields: [{ key: "date", label: "Date", type: "date", required: true }, { key: "kg", label: "Weight", type: "number", required: true }], views: [{ kind: "trend", x: "date", y: "kg" }] };
  const tool = await db.managedTool.create({ data: { workspaceId: "w", kind: "panel", name: "Weight", purpose: "Track", state: "enabled", approvedVersion: 1, versions: { create: { workspaceId: "w", version: 1, contentHash: "test", spec } } } });
  const path = `/tools/${tool.id}`;
  expect((await request(path, undefined, "GET", "other")).status).toBe(404);
  const invalid = await request(`${path}/entries`, { values: { date: "2025-02-29", kg: 60 } });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ code: "invalid", message: expect.stringContaining("date") });
  expect((await request(`${path}/entries`, { values: { date: "2024-02-29", kg: 60 } }, "POST", "other")).status).toBe(404);
  const first = await (await request(`${path}/entries`, { values: { date: "2024-02-29", kg: "60.5" } })).json();
  expect(first.values.kg).toBe(60.5);
  const second = await (await request(`${path}/entries`, { values: { date: "2024-03-01", kg: 60 } })).json();
  expect((await (await request(path)).json()).entries.map((e: { id: string }) => e.id)).toEqual([second.id, first.id]);
  expect((await request(`${path}/entries/${first.id}`, undefined, "DELETE", "other")).status).toBe(404);
  expect((await request(`${path}/entries/${first.id}`, undefined, "DELETE")).status).toBe(204);
  expect((await request(`${path}/entries/${first.id}`, undefined, "DELETE")).status).toBe(404);
  await db.managedTool.update({ where: { id: tool.id }, data: { state: "disabled" } });
  expect((await request(`${path}/entries`, { values: { date: "2024-03-02", kg: 60 } })).status).toBe(409);
  expect(await db.audit.count({ where: { kind: "panel_entry_added" } })).toBe(2);
  expect(await db.audit.count({ where: { kind: "panel_entry_deleted" } })).toBe(1);
});
test("owner auth and required existing workspace", async () => {
  expect((await request("/today", undefined, "GET", "w", "wrong")).status).toBe(401);
  expect((await request("/today", undefined, "GET", "")).status).toBe(400);
  expect((await request("/today", undefined, "GET", "missing")).status).toBe(404);
  for (const path of ["/today", "/health", "/settings", "/affairs", "/grants", "/preferences", "/notifications", "/connections", "/tools", "/chat/messages"]) expect((await request(path)).status).toBe(200);
});
test("affairs validate requests, isolate workspaces and wake on writes", async () => {
  expect((await request("/affairs", { request: "" })).status).toBe(400);
  const affair = await (await request("/affairs", { request: "Research" })).json(); expect(affair.agentState).toBe("queued");
  expect((await request(`/affairs/${affair.id}`, undefined, "GET", "other")).status).toBe(404);
  expect((await (await request("/affairs", undefined, "GET", "other")).json()).items).toEqual([]);
  expect((await request(`/affairs/${affair.id}`, { status: "paused" }, "PATCH")).status).toBe(200);
  expect((await request(`/affairs/${affair.id}/entries`, { kind: "feedback", text: "Correction" })).status).toBe(200);
  expect((await request(`/affairs/${affair.id}/results/1`)).status).toBe(404);
  expect((await request(`/affairs/${affair.id}/results/nope`)).status).toBe(400);
  expect(wakes).toBe(3);
});
test("asks resolve once; settings and grants preserve authority", async () => {
  const affair = await service.forWorkspace("w").affairs.create({ request: "Approval" });
  const ask = await service.forWorkspace("w").asks.createApproval({ affairId: affair.id, action: "run_script", title: "Allow?" });
  expect((await request(`/asks/${ask.id}/resolve`, { decision: "approve" })).status).toBe(200);
  expect((await request(`/asks/${ask.id}/resolve`, { decision: "deny" })).status).toBe(409);
  expect((await request("/settings", { notifications: { timezone: "invalid" } }, "PATCH")).status).toBe(400);
  expect((await request("/settings", { notifications: { dailyCap: 3 } }, "PATCH")).status).toBe(200);
  expect((await request("/grants", { action: "change_credentials", mode: "auto", scope: { kind: "global" } })).status).toBe(403);
  const grant = await (await request("/grants", { action: "web_research", mode: "ask", scope: { kind: "global" } })).json();
  expect((await request(`/grants/${grant.id}/revoke`, {})).status).toBe(200);
});
test("preferences and connection transition conflicts", async () => {
  const p = await (await request("/preferences", { text: "Short replies" })).json();
  expect((await request(`/preferences/${p.id}`, undefined, "DELETE")).status).toBe(204);
  expect((await request(`/preferences/${p.id}`, undefined, "DELETE")).status).toBe(404);
  const c = await (await request("/connections", { kind: "local_test", label: "Test" })).json();
  expect((await request(`/connections/${c.id}/transition`, { action: "revoke" })).status).toBe(200);
  expect((await request(`/connections/${c.id}/transition`, { action: "resume" })).status).toBe(409);
});
test("chat uses shared concierge; records fallback and rejects empty input", async () => {
  expect((await request("/chat", { text: "" })).status).toBe(400);
  const reply = await (await request("/chat", { text: "Save my request" })).json();
  expect(reply.affairId).toBeString(); expect(reply.reply).toBeString();
  expect((await (await request("/chat/messages?limit=2")).json()).items).toHaveLength(2);
});

test("tools expose current content and version-bound lifecycle grants", async () => {
  const tool = await db.managedTool.create({ data: { workspaceId: "w", kind: "script", name: "Test", purpose: "Purpose", rationale: "Repeated work", versions: { create: { workspaceId: "w", version: 1, contentHash: "fake", script: { language: "python", source: "print(1)", usage: "Test" } } } } });
  const path = `/tools/${tool.id}/transition`;
  expect((await (await request("/tools")).json()).items[0].script.source).toBe("print(1)");
  expect((await (await request("/tools", undefined, "GET", "other")).json()).items).toEqual([]);
  expect((await request(path, { action: "approve", expectedVersion: 1 }, "POST", "other")).status).toBe(404);
  expect((await request(path, { action: "approve", expectedVersion: 2 })).status).toBe(409);
  expect((await request(path, { action: "enable", expectedVersion: 1 })).status).toBe(409);
  expect((await request(path, { action: "approve" })).status).toBe(400);
  for (const action of ["approve", "enable", "disable", "enable", "retire"]) expect((await request(path, { action, expectedVersion: 1 })).status).toBe(200);
  expect((await request(path, { action: "enable", expectedVersion: 1 })).status).toBe(409);
  const grants = await service.forWorkspace("w").grants.list();
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ action: "run_script", mode: "preapproved", scope: { kind: "tool_version", toolId: tool.id, version: 1 } });
});

test("result, notification feedback/retry and sync response happy paths", async () => {
  const affair = await service.forWorkspace("w").affairs.create({ request: "Research" });
  const run = (await service.runs.claimNext())!;
  expect((await service.agentEndpoint.callTool(run.token, "chrona_publish_result", { title: "Result", summary: "Summary", body: "Body", handling: { mode: "result_page", rationale: "Useful" } })).ok).toBe(true);
  expect((await request(`/affairs/${affair.id}`)).status).toBe(200);
  expect((await (await request(`/affairs/${affair.id}/results/1`)).json()).body).toBe("Body");
  expect((await request(`/affairs/${affair.id}/results/1`, undefined, "GET", "other")).status).toBe(404);
  const notification = await service.forWorkspace("w").notifications.enqueue({ affairId: affair.id, level: "web", title: "Test", body: "Body", dedupeKey: "route-test" });
  const path = `/notifications/${notification.id}`;
  expect((await request(`${path}/feedback`, { feedback: "not_useful" })).status).toBe(200);
  expect((await request(`${path}/retry`, {})).status).toBe(409);
  await db.notification.update({ where: { id: notification.id }, data: { status: "failed" } });
  expect((await request(`${path}/retry`, {})).status).toBe(200);
  expect((await request(`${path}/feedback`, { feedback: "useful" }, "POST", "other")).status).toBe(404);
  const connection = await (await request("/connections", { kind: "local_test", label: "Test" })).json();
  const sync = await request(`/connections/${connection.id}/sync`, {});
  expect(sync.status).toBe(200); expect((await sync.json()).id).toBe(connection.id);
});

const mutations: [string, string, unknown][] = [
  ["/chat", "POST", { text: "Hello" }], ["/affairs", "POST", { request: "Hello" }],
  ["/affairs/missing", "PATCH", { status: "paused" }], ["/affairs/missing/entries", "POST", { kind: "feedback", text: "Hello" }],
  ["/asks/missing/resolve", "POST", { decision: "deny" }], ["/settings", "PATCH", { notifications: { dailyCap: 2 } }],
  ["/grants", "POST", { action: "web_research", mode: "ask", scope: { kind: "global" } }], ["/grants/missing/revoke", "POST", {}],
  ["/preferences", "POST", { text: "Hello" }], ["/preferences/missing", "DELETE", undefined],
  ["/notifications/missing/feedback", "POST", { feedback: "useful" }], ["/notifications/missing/retry", "POST", {}],
  ["/connections", "POST", { kind: "local_test", label: "Hello" }], ["/connections/missing/transition", "POST", { action: "pause" }],
  ["/connections/missing/sync", "POST", {}], ["/tools/missing/transition", "POST", { action: "approve", expectedVersion: 1 }],
];
test("every mutation requires owner and workspace; missing resources return 404", async () => {
  for (const [path, method, body] of mutations) {
    expect((await request(path, body, method, "w", "wrong")).status).toBe(401);
    expect((await request(path, body, method, "")).status).toBe(400);
    expect((await request(path, body, method, "absent")).status).toBe(404);
    if (path.includes("missing")) expect((await request(path, body, method)).status).toBe(404);
  }
});
test("workspace isolation covers asks, grants, preferences, connections and settings", async () => {
  const w = service.forWorkspace("w");
  const affair = await w.affairs.create({ request: "Question" });
  const ask = await w.asks.createQuestion({ affairId: affair.id, title: "Question", questions: [{ question: "Which?", why: "Need detail" }] });
  const grant = await w.grants.create({ action: "web_research", mode: "ask", scope: { kind: "global" } });
  const pref = await w.preferences.add({ text: "Short replies" });
  const connection = await w.connections.create({ kind: "local_test", label: "Local" });
  const cases: [string, unknown, string][] = [
    [`/asks/${ask.id}/resolve`, { decision: "answer", text: "This" }, "POST"],
    [`/grants/${grant.id}/revoke`, {}, "POST"], [`/preferences/${pref.id}`, undefined, "DELETE"],
    [`/connections/${connection.id}/transition`, { action: "pause" }, "POST"], [`/connections/${connection.id}/sync`, {}, "POST"],
    [`/affairs/${affair.id}`, { status: "done" }, "PATCH"], [`/affairs/${affair.id}/entries`, { kind: "feedback", text: "No" }, "POST"],
  ];
  for (const [path, body, method] of cases) expect((await request(path, body, method, "other")).status).toBe(404);
  for (const path of ["/affairs", "/grants", "/preferences", "/connections", "/notifications", "/chat/messages", "/tools"]) expect((await (await request(path, undefined, "GET", "other")).json()).items).toEqual([]);
  await request("/settings", { notifications: { dailyCap: 2 } }, "PATCH");
  expect((await (await request("/settings", undefined, "GET", "other")).json()).notifications.dailyCap).toBe(5);
});
test("every read route rejects unauthorized and absent workspace requests", async () => {
  for (const path of ["/today", "/health", "/chat/messages", "/affairs", "/affairs/missing", "/affairs/missing/results/1", "/settings", "/grants", "/preferences", "/notifications", "/connections", "/tools"]) {
    expect((await request(path, undefined, "GET", "w", "wrong")).status).toBe(401);
    expect((await request(path, undefined, "GET", "")).status).toBe(400);
    expect((await request(path, undefined, "GET", "absent")).status).toBe(404);
  }
});
test("all request schemas reject malformed bodies and query values", async () => {
  for (const [path, method] of mutations.filter(([p, m]) => m !== "DELETE" && !/\/(revoke|retry|sync)$/.test(p))) expect((await request(path, { unexpected: true }, method)).status).toBe(400);
  for (const path of ["/chat/messages?limit=0", "/affairs?status=nope", "/affairs/x/results/nope"]) expect((await request(path)).status).toBe(400);
});
test("POST chat uses a fake concierge and shared capability service", async () => {
  ports.agent = { runAffair: async () => {}, runConcierge: async ({ token }) => {
    expect((await service.agentEndpoint.callTool(token, "concierge_create_affair", { title: "Research", request: "Research this" })).ok).toBe(true);
    expect((await service.agentEndpoint.callTool(token, "concierge_reply", { text: "I will research that" })).ok).toBe(true);
  } };
  const response = await request("/chat", { text: "Research this" });
  expect(response.status).toBe(200);
  expect((await response.json()).reply).toBe("I will research that");
  expect(await db.affair.count({ where: { workspaceId: "w", agentState: "queued" } })).toBe(1);
  expect(wakes).toBe(1);
});
test("malformed engine projections are internal errors, not request errors", async () => {
  const p = await service.forWorkspace("w").preferences.add({ text: "Valid" });
  await db.preference.update({ where: { id: p.id }, data: { text: "" } });
  expect((await request("/preferences")).status).toBe(500);
});
