import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "../../../../../packages/engine/src/modules/steward/test-db";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { createStewardRoutes } from "../../routes/steward.routes";
let db: ReturnType<typeof testDb>, app: ReturnType<typeof createStewardRoutes>, service: ReturnType<typeof createStewardService>;
let savedKey: string | undefined;
beforeEach(async () => {
  savedKey = process.env.API_KEY; process.env.API_KEY = "test-owner";
  db = testDb(); await db.workspace.create({ data: { id: "w", name: "Test" } });
  const ports: StewardPorts = { db, dataDir: mkdtempSync(join(tmpdir(), "chrona-v4b-files-")), now: () => new Date(), publicUrl: null, deliveries: [], chat: null };
  service = createStewardService(ports); app = createStewardRoutes(ports, service);
});
afterEach(async () => { await db.$disconnect(); if (savedKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = savedKey; });
function request(path: string, method = "GET", body?: unknown) {
  return app.request(`http://localhost${path}${path.includes("?") ? "&" : "?"}workspaceId=w`, { method, headers: { authorization: "Bearer test-owner", ...(body instanceof FormData ? {} : { "content-type": "application/json" }) }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
}
async function affair() { return (await (await request("/affairs", "POST", { title: "Test", request: "Hello" })).json()).id as string; }
test("owner/workspace boundary and v3 projections", async () => {
  expect((await app.request("http://localhost/health?workspaceId=w")).status).toBe(401);
  expect((await app.request("http://localhost/health", { headers: { authorization: "Bearer test-owner" } })).status).toBe(400);
  expect((await app.request("http://localhost/health?workspaceId=absent", { headers: { authorization: "Bearer test-owner" } })).status).toBe(404);
  for (const path of ["/today", "/health", "/affairs", "/chat/messages", "/settings", "/grants", "/preferences", "/approvals", "/notifications"]) expect((await request(path)).status).toBe(200);
  expect((await request("/affairs", "POST", {})).status).toBe(400);
  expect((await request("/affairs/missing")).status).toBe(404);
  expect((await request("/affairs?status=nope")).status).toBe(400);
});
test("files save optimistic conflicts, revisions, upload and safe raw download", async () => {
  const id = await affair(), base = `/affairs/${id}`;
  const original = await (await request(`${base}/file?path=README.md`)).json();
  expect((await request(`${base}/file`, "PUT", { path: "README.md", content: "# Updated\n\n- [ ] task\n", baseRevision: original.revision })).status).toBe(200);
  expect((await request(`${base}/file`, "PUT", { path: "README.md", content: "stale", baseRevision: original.revision })).status).toBe(409);
  expect((await request(`${base}/file?path=absent.md`)).status).toBe(404);
  expect((await request(`${base}/file?path=../outside`)).status).toBe(400);
  const updated = await (await request(`${base}/file?path=README.md`)).json();
  expect((await request(`${base}/checkbox`, "POST", { path: "README.md", line: 3, checked: true, baseRevision: updated.revision })).status).toBe(200);
  const revisions = await (await request(`${base}/revisions`)).json();
  expect(revisions.items.length).toBeGreaterThan(1);
  expect((await request(`${base}/revisions/${revisions.items[0].sha}/diff`)).status).toBe(200);
  expect((await request(`${base}/revisions/bad/diff`)).status).toBe(400);
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
  for (const path of ["../outside", ".git/config", ".chrona/sessions/private"]) expect((await request(`${base}/raw?path=${encodeURIComponent(path)}`)).status).toBe(400);
  const directory = await (await service.forWorkspace("w").affairs.files(id)).directory();
  await symlink("README.md", join(directory, "link"));
  expect((await request(`${base}/raw?path=link`)).status).toBe(403);
});
test("schedule and approval lifecycle errors", async () => {
  const id = await affair();
  const response = await request(`/affairs/${id}/schedules`, "POST", { mode: "remind", rule: { kind: "daily", time: "09:00" }, text: "Remember" });
  expect(response.status).toBe(200); const schedule = await response.json();
  expect((await request(`/schedules/${schedule.id}`, "PATCH", { status: "paused" })).status).toBe(200);
  expect((await request("/schedules/missing", "PATCH", { status: "paused" })).status).toBe(404);
  expect((await request(`/schedules/${schedule.id}`, "PATCH", { status: "bad" })).status).toBe(400);
  const approval = await service.forWorkspace("w").approvals.create({ affairId: id, action: "send_external_message", title: "Send?", detail: "Draft", preview: "Hello", payload: { text: "Hello" } });
  expect((await request(`/approvals/${approval.id}/resolve`, "POST", { decision: "deny" })).status).toBe(200);
  expect((await request(`/approvals/${approval.id}/resolve`, "POST", { decision: "deny" })).status).toBe(409);
  expect((await request("/approvals/missing/resolve", "POST", { decision: "deny" })).status).toBe(404);
  expect((await request(`/approvals/${approval.id}/resolve`, "POST", { decision: "bad" })).status).toBe(400);
});
