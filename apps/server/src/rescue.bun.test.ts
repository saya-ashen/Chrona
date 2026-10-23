import { afterEach, expect, test } from "bun:test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import { createRescueApp, startRescueListener } from "./rescue";
import { createStewardRoutes } from "./routes/steward.routes";
import { approvalResolver } from "./steward-qq-bot";
import { resetEnvCacheForTests } from "./config/env";
import { buildArtifacts } from "../../../build/manifest";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
const htmlPath = join(import.meta.dirname, "static/rescue.html");
async function fixture() {
  const db = testDb(); dbs.push(db);
  await db.workspace.create({ data: { id: "ws_default", name: "Personal" } });
  const ports: StewardPorts = { db, dataDir: mkdtempSync(join(tmpdir(), "chrona-rescue-test-")), now: () => new Date(), deliveries: [], publicUrl: null, chat: null, chatTimeoutMs: 2000 };
  const service = createStewardService(ports);
  const app = createRescueApp(ports, service, "test-rescue-key", readFileSync(htmlPath, "utf8"));
  const request = (path: string, data?: unknown, key = "test-rescue-key") => app.request(path, { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(data ? { method: "POST", body: JSON.stringify(data) } : {}) });
  return { db, ports, service, app, request };
}
test("rescue auth fails closed, including page; CSP forbids external resources and cookies are absent", async () => {
  const f = await fixture();
  for (const path of ["/", "/api/messages", "/api/approvals"]) {
    expect((await f.app.request(path)).status).toBe(401);
    expect((await f.request(path, undefined, "wrong-key")).status).toBe(401);
  }
  const response = await f.request("/");
  expect(response.status).toBe(200);
  const csp = response.headers.get("content-security-policy")!;
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("script-src 'sha256-");
  expect(csp).not.toContain("unsafe-inline");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});
test("rescue listener refuses to start without a key", async () => {
  const f = await fixture(), logs: string[] = [];
  expect(startRescueListener(f.ports, f.service, htmlPath, { CHRONA_RESCUE_PORT: "3199" }, message => logs.push(message))).toBeUndefined();
  expect(logs).toEqual(["Rescue listener not started: RESCUE_KEY is required"]);
});
test("rescue approval list includes rescueOnly and resolve allows once/always", async () => {
  const f = await fixture();
  for (const scope of ["once", "always"]) {
    const approval = await f.service.forWorkspace("ws_default").approvals.create({ action: "change_policy", title: "Settings", detail: "Changes", preview: "diff", payload: {} });
    const list = await (await f.request("/api/approvals")).json();
    expect(list.items).toContainEqual(expect.objectContaining({ id: approval.id, rescueOnly: true, preview: "diff" }));
    const result = await f.request(`/api/approvals/${approval.id}/resolve`, { decision: "approve", scope });
    expect(result.status).toBe(200);
    expect((await result.json()).status).toBe("approved");
  }
});
test("rescue chat uses only session rescue; Provider failure points to chrona admin", async () => {
  const f = await fixture();
  const result = await f.request("/api/chat", { text: "Repair the web" });
  expect(result.status).toBe(200);
  const reply = await result.json();
  expect(await f.db.session.findUnique({ where: { id: reply.sessionId } })).toMatchObject({ key: "rescue", source: "rescue" });
  expect(reply.messages[0].text).toContain("chrona admin");
  const messages = await (await f.request("/api/messages")).json();
  expect(messages.items.map((m: { text: string }) => m.text)).toContain("Repair the web");
  expect(messages.items.at(-1).text).toContain("chrona admin");
  expect((await f.request("/api/chat", { text: "hi", attachments: [] })).status).toBe(400);
});
// The mcp module resolves through this same owner HTTP route.
test("HTTP, MCP and QQ cannot resolve rescue-only approvals", async () => {
  const f = await fixture();
  const saved = process.env.API_KEY;
  process.env.API_KEY = "owner-test-key";
  resetEnvCacheForTests();
  try {
    const approval = await f.service.forWorkspace("ws_default").approvals.create({ action: "change_policy", title: "Settings", detail: "Review", preview: "diff", payload: {} });
    const headers = { Authorization: "Bearer owner-test-key", "Content-Type": "application/json" };
    const http = createStewardRoutes(f.ports, f.service);
    const response = await http.request(`/approvals/${approval.id}/resolve?workspaceId=ws_default`, { method: "POST", headers, body: JSON.stringify({ decision: "approve" }) });
    expect(response.status).toBe(403);
    expect((await response.json()).message).toContain("rescue console");
    const binding = { version: 1 as const, workspaceId: "ws_default", openid: "owner", appId: "test", boundAt: new Date().toISOString() };
    expect(await approvalResolver(f.service)(binding, { ref: approval.id, decision: "approve", scope: "once" })).toContain("救援控制台");
    expect((await f.service.forWorkspace("ws_default").approvals.list("open"))).toHaveLength(1);
  } finally {
    if (saved === undefined) delete process.env.API_KEY; else process.env.API_KEY = saved;
    resetEnvCacheForTests();
  }
});
test("rescue HTML is a required release resource", () => {
  expect(buildArtifacts.resources).toContainEqual({ from: "apps/server/src/static/rescue.html", to: "resources/rescue.html", required: true });
  expect(readFileSync(htmlPath, "utf8")).toContain("Chrona rescue (immutable)");
});
