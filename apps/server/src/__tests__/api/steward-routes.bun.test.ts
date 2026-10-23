import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { createStewardService, moduleSupervisor, type StewardPorts } from "@chrona/engine";
import { createStewardRoutes } from "../../routes/steward.routes";
import { createScriptSandbox } from "../../../../../packages/integrations/src/steward/script-sandbox";
let db: ReturnType<typeof testDb>, app: ReturnType<typeof createStewardRoutes>, service: ReturnType<typeof createStewardService>, dataDir: string;
let savedKey: string | undefined;
beforeEach(async () => {
  savedKey = process.env.API_KEY; process.env.API_KEY = "test-owner";
  db = testDb(); await db.workspace.create({ data: { id: "w", name: "Test" } });
  dataDir = mkdtempSync(join(tmpdir(), "chrona-content-routes-"));
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null, deliveries: [], chat: null };
  service = createStewardService(ports); app = createStewardRoutes(ports, service);
});
afterEach(async () => { await db.$disconnect(); if (savedKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = savedKey; });
function request(path: string, method = "GET", body?: unknown) {
  return app.request(`http://localhost${path}${path.includes("?") ? "&" : "?"}workspaceId=w`, { method, headers: { authorization: "Bearer test-owner", ...(body instanceof FormData ? {} : { "content-type": "application/json" }) }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
}
async function contentApp(workspaceId = "w") {
  const module = await db.module.create({ data: { workspaceId, name: "files", status: "paused", activeHash: "hash" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", status: "active", intent: "fixture", source: "user", report: {}, manifest: { name: "files", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], content: true } } });
  await service.forWorkspace(workspaceId).content.save(module.id, { path: "README.md", content: "# Test\n\n- [ ] task\n", baseRevision: null });
  return module.id;
}
test("owner/workspace boundary and projections", async () => {
  expect((await app.request("http://localhost/health?workspaceId=w")).status).toBe(401);
  expect((await app.request("http://localhost/health", { headers: { authorization: "Bearer test-owner" } })).status).toBe(400);
  expect((await app.request("http://localhost/health?workspaceId=absent", { headers: { authorization: "Bearer test-owner" } })).status).toBe(404);
  for (const path of ["/today", "/health", "/schedules", "/settings", "/grants", "/preferences", "/approvals", "/notifications"]) expect((await request(path)).status).toBe(200);
});
test("content save conflicts, checkbox, tree, upload and safe raw download", async () => {
  const id = await contentApp(), base = `/apps/${id}`;
  const original = await (await request(`${base}/file?path=README.md`)).json();
  expect((await request(`${base}/file`, "PUT", { path: "README.md", content: "# Updated\n\n- [ ] task\n", baseRevision: original.revision })).status).toBe(200);
  expect((await request(`${base}/file`, "PUT", { path: "README.md", content: "stale", baseRevision: original.revision })).status).toBe(409);
  expect((await request(`${base}/file?path=absent.md`)).status).toBe(404);
  expect((await request(`${base}/file?path=../outside`)).status).toBe(400);
  const updated = await (await request(`${base}/file?path=README.md`)).json();
  const toggled = await request(`${base}/checkbox`, "POST", { path: "README.md", line: 3, checked: true, baseRevision: updated.revision });
  expect(toggled.status).toBe(200); expect((await toggled.json()).content).toContain("- [x]");
  expect((await (await request(`${base}/tree`)).json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ path: "README.md" })]));
  const form = () => { const f = new FormData(); f.set("file", new File(["<script>alert(1)</script>"], "evil.html", { type: "text/html" })); f.set("dir", "uploads"); return f; };
  expect((await request(`${base}/upload`, "POST", form())).status).toBe(200);
  expect((await request(`${base}/upload`, "POST", form())).status).toBe(409);
  const raw = await request(`${base}/raw?path=uploads/evil.html`);
  expect(raw.headers.get("content-type")).toBe("application/octet-stream");
  expect(raw.headers.get("content-disposition")).toStartWith("attachment;");
  expect(raw.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await raw.text()).toBe("<script>alert(1)</script>");
  const unsafe = form(); unsafe.set("dir", "../outside");
  expect((await request(`${base}/upload`, "POST", unsafe)).status).toBe(400);
  expect((await request(`${base}/upload`, "POST", {})).status).toBe(400);
  await symlink("README.md", join(dataDir, "platform", "content", id, "link"));
  expect((await request(`${base}/raw?path=link`)).status).toBe(403);
});
test("UI events validate and isolate apps", async () => {
  const id = await contentApp(), path = `/apps/${id}/ui-event`;
  expect((await request(path, "POST", { path: "home.ui.json", kind: "open" })).status).toBe(200);
  expect(await db.audit.findFirst({ where: { workspaceId: "w", kind: "ui_event", subjectId: id } })).toMatchObject({ details: { path: "home.ui.json", kind: "open" } });
  expect((await request(path, "POST", { path: "../escape", kind: "open" })).status).toBe(400);
  expect((await request(path, "POST", { path: "home.ui.json", kind: "feedback" })).status).toBe(400);
  await db.workspace.create({ data: { id: "other", name: "Other" } });
  expect((await request(`/apps/${await contentApp("other")}/ui-event`, "POST", { path: "README.md", kind: "open" })).status).toBe(404);
});
test("panel entries use engine declarations", async () => {
  const id = await contentApp(), base = `/apps/${id}`, content = service.forWorkspace("w").content;
  const props = { title: "Weight", data: "records.csv", fields: [{ key: "weight", label: "Weight", type: "number", required: true }], views: [{ kind: "table", columns: ["weight"] }] };
  await content.save(id, { path: "daily.ui.json", content: JSON.stringify({ root: "panel", elements: { panel: { type: "Panel", props, children: [] } } }), baseRevision: null });
  expect((await request(`${base}/panel-entry`, "POST", { dataPath: "records.csv", values: { weight: 70 } })).status).toBe(200);
  expect((await content.read(id, "records.csv")).content).toBe("weight\n70\n");
  expect((await request(`${base}/panel-entry`, "POST", { dataPath: "unknown.csv", values: { weight: 70 } })).status).toBe(400);
});
test("schedule and approval lifecycle", async () => {
  const module = await db.module.create({ data: { workspaceId: "w", name: "remind", builtin: true, status: "active", activeHash: "hash" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "hash", status: "active", intent: "fixture", source: "builtin", report: {}, manifest: { name: "remind", entry: "index.ts", tests: ["test.ts"], triggers: [], dynamicSchedules: true, effects: ["notify_user"], params: {}, data: { schema: 1 } } } });
  const response = await request("/schedules", "POST", { mode: "remind", rule: { kind: "daily", time: "09:00" }, text: "Remember" });
  expect(response.status).toBe(200); const schedule = await response.json();
  expect((await request(`/schedules/${schedule.id}`, "PATCH", { status: "paused" })).status).toBe(200);
  expect((await request("/schedules/missing", "PATCH", { status: "paused" })).status).toBe(404);
  expect((await request("/schedules", "POST", { mode: "wake", rule: { kind: "at", at: new Date().toISOString() }, text: "Work" })).status).toBe(400);
  const approval = await service.forWorkspace("w").approvals.create({ action: "send_external_message", title: "Send?", detail: "Draft", preview: "Hello", payload: { text: "Hello" } });
  expect((await request(`/approvals/${approval.id}/resolve`, "POST", { decision: "deny" })).status).toBe(200);
  expect((await request(`/approvals/${approval.id}/resolve`, "POST", { decision: "deny" })).status).toBe(409);
});

const reminderSandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
(reminderSandbox.health.available ? test : test.skip)("POST /schedules reminder fires through the built-in module without a Provider run", async () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, deliveries: [], chat: null,
    moduleBuiltinResources: join(import.meta.dirname, "../../../../../packages/engine/src/modules/steward/builtin"),
    sandbox: { available: true, runModule: reminderSandbox.runModule, startModule: reminderSandbox.startModule } };
  service = createStewardService(ports); app = createStewardRoutes(ports, service);
  try {
    await moduleSupervisor(ports).start();
    const response = await request("/schedules", "POST", { mode: "remind", rule: { kind: "at", at: now.toISOString() }, text: "Remember from HTTP" });
    expect(response.status).toBe(200);
    const schedule = await response.json();
    expect(await db.schedule.findUniqueOrThrow({ where: { id: schedule.id } })).toMatchObject({ mode: "module", payload: { text: "Remember from HTTP" } });
    expect((await service.forWorkspace("w").today()).upcoming).toContainEqual(expect.objectContaining({ scheduleId: schedule.id, label: "Remember from HTTP" }));
    expect(await service.forWorkspace("w").schedules.fireDue()).toBe(1);
    expect(await db.notification.findFirstOrThrow()).toMatchObject({ title: "提醒", body: "Remember from HTTP", moduleId: expect.any(String) });
    expect(await db.moduleRun.findFirstOrThrow()).toMatchObject({ exitCode: 0 });
    expect(await db.run.count()).toBe(0);
    expect(await service.forWorkspace("w").schedules.fireDue()).toBe(0);
  } finally { await moduleSupervisor(ports).stop(); }
}, 30_000);
