import { afterEach, expect, test } from "bun:test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import { createRescueApp, startRescueListener } from "./rescue";
import { builtinEntry, createRelay, qqEntry } from "@chrona/engine/test-support";
import { buildArtifacts } from "../../../build/manifest";
import webManifest from "../../../packages/engine/src/modules/steward/external/web/module.json";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
const htmlPath = join(import.meta.dirname, "static/rescue.html");
async function fixture() {
  const db = testDb(); dbs.push(db);
  await db.workspace.create({ data: { id: "ws_default", name: "Personal" } });
  const ports: StewardPorts = { db, dataDir: mkdtempSync(join(tmpdir(), "chrona-rescue-test-")), now: () => new Date(), publicUrl: null, chatTimeoutMs: 2000 };
  const service = createStewardService(ports);
  const app = createRescueApp(service, "test-rescue-key", readFileSync(htmlPath, "utf8"));
  const request = (path: string, data?: unknown, key = "test-rescue-key") => app.request(path, { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(data ? { method: "POST", body: JSON.stringify(data) } : {}) });
  return { db, ports, service, app, request };
}
test("rescue auth fails closed, including page; CSP forbids external resources and cookies are absent", async () => {
  const f = await fixture();
  for (const path of ["/", "/api/modules", "/api/approvals"]) {
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
  expect(startRescueListener(f.service, htmlPath, { CHRONA_RESCUE_PORT: "3199" }, message => logs.push(message))).toBeUndefined();
  expect(logs).toEqual(["Rescue listener not started: RESCUE_KEY is required"]);
});
test("rescue approvals and kernel tick work with both web and notify disabled", async () => {
  const f = await fixture();
  await f.db.module.createMany({ data: ["web", "notify"].map(name => ({ workspaceId: "ws_default", name, builtin: true, activeHash: `${name}-hash`, status: "paused" })) });
  await f.service.tick();
  for (const scope of [undefined, "once"]) {
    const approval = await f.service.forWorkspace("ws_default").approvals.create({ action: "modify_external", title: "Decide", detail: "Changes", preview: "diff", payload: {} });
    const list = await (await f.request("/api/approvals")).json();
    expect(list.items).toContainEqual(expect.objectContaining({ id: approval.id, preview: "diff" }));
    expect((await f.request(`/api/approvals/${approval.id}/resolve`, { decision: "approve", scope: "always" })).status).toBe(400);
    expect((await f.db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("open");
    const result = await f.request(`/api/approvals/${approval.id}/resolve`, { decision: "approve", scope });
    expect(result.status).toBe(200);
    expect((await result.json()).status).toBe("approved");
  }
  expect(await f.db.grant.count()).toBe(0);
  expect(await f.db.kernelFact.count({ where: { workspaceId: "ws_default" } })).toBeGreaterThanOrEqual(4);
  expect(await f.db.moduleInvocation.count({ where: { workspaceId: "ws_default", target: { in: ["web", "notify"] } } })).toBe(0);
});
test("rescue exposes governed recovery controls, never conversations", async () => {
  const f = await fixture();
  expect((await f.request("/api/chat", { text: "Repair the web" })).status).toBe(404);
  expect((await f.request("/api/messages")).status).toBe(404);
  expect(await f.db.session.count()).toBe(0);
  const module = await f.db.module.create({ data: { workspaceId: "ws_default", name: "example", activeHash: "approved", status: "active" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "approved", status: "approved", source: "user", manifest: { ...webManifest, name: "example" }, intent: {}, report: {} } });
  expect((await (await f.request("/api/modules")).json()).items).toContainEqual(expect.objectContaining({ id: module.id }));
  expect((await f.request(`/api/modules/${module.id}/pause`, {})).status).toBe(200);
  const paused = await f.db.module.findUniqueOrThrow({ where: { id: module.id } });
  expect(paused.status).toBe("paused");
  const resumePath = `/api/modules/${module.id}/resume`;
  expect((await f.app.request(resumePath, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
  expect((await f.request(resumePath, {}, "wrong-key")).status).toBe(401);
  expect((await f.request(resumePath, { disableAuth: true })).status).toBe(400);
  expect((await f.db.module.findUniqueOrThrow({ where: { id: module.id } })).status).toBe("paused");
  const response = await f.request(resumePath, {});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ moduleId: module.id, status: "active" });
  const resumed = await f.db.module.findUniqueOrThrow({ where: { id: module.id } });
  expect(resumed).toMatchObject({ status: "active", activeHash: paused.activeHash, executionFenceAt: null });
  expect(resumed.activationId).not.toBe(paused.activationId);
  expect((await f.request(`/api/modules/${module.id}/rollback`, { hash: "missing" })).status).toBe(409);
  expect((await f.request(`/api/modules/${module.id}/rollback`, { hash: "approved", disableAuth: true })).status).toBe(400);
});
// The mcp module resolves through this same owner HTTP route.
test("the web page and QQ resolve application-requested approvals like any other entry", async () => {
  const f = await fixture();
  const create = () => f.service.forWorkspace("ws_default").approvals.create({ action: "modify_external", title: "Decision", detail: "Review", preview: "diff", payload: {} });
  const viaWeb = await create(), viaQq = await create(), deniedViaQq = await create();
  const web = await builtinEntry(f.ports, "ws_default", "web");
  expect(await web.call("approvals.resolve", { approval: viaWeb.id, decision: "approve" })).toMatchObject({ status: "approved" });
  const binding = { version: 1 as const, workspaceId: "ws_default", openid: "owner", appId: "test", boundAt: new Date().toISOString() };
  // The qq module resolves through the approvals system module, as an entry (no owner API).
  const qq = await qqEntry(f.ports, "ws_default");
  const relay = createRelay({ call: qq.call, notify: async () => ({}), publicUrl: null, download: async () => { throw new Error("unused"); } });
  expect(await relay.resolveApproval(binding, { ref: viaQq.id, decision: "approve" })).toContain("已批准");
  expect(await relay.resolveApproval(binding, { ref: deniedViaQq.id, decision: "deny" })).toContain("已拒绝");
  expect((await f.service.forWorkspace("ws_default").approvals.list("open"))).toHaveLength(0);
});
test("rescue HTML is a required release resource", () => {
  expect(buildArtifacts.resources).toContainEqual({ from: "apps/server/src/static/rescue.html", to: "resources/rescue.html", required: true });
  expect(readFileSync(htmlPath, "utf8")).toContain("Chrona rescue (immutable)");
  expect(readFileSync(htmlPath, "utf8")).toContain("恢复应用");
});
