import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import * as s from "@chrona/contracts/steward";
import { testDb } from "@chrona/engine/test-support";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { createStewardRoutes } from "../../routes/steward.routes";

// One real-service HTTP walk: each method/path in the contract's HTTP map is exercised.
// Only external transports are faked; DB, policies, content and route handlers are real.
test("every contract HTTP route returns a successful, schema-valid response", async () => {
  const db = testDb(), savedKey = process.env.API_KEY;
  process.env.API_KEY = "test-owner";
  let stop: (() => void) | undefined;
  try {
    await db.workspace.create({ data: { id: "w", name: "HTTP walk" } });
    const ports: StewardPorts = {
      db, dataDir: mkdtempSync(join(tmpdir(), "chrona-http-map-")), now: () => new Date(), publicUrl: null, deliveries: [], chat: null, chatTimeoutMs: 3000,
      connectors: [{ kind: "email", coverageNote: "Offline fixture", test: async () => ({ ok: true }), poll: async () => ({ items: [], cursor: null }) }],
      provider: { name: "offline", health: async () => ({ available: true, sandboxed: false, error: null }), start(input) {
        const stopped = new Promise<void>(resolve => { stop = resolve; });
        return { inject: async () => {}, abort: async () => { stop?.(); }, done: (async () => {
          if (input.prompt.includes("Ask fixture")) {
            await input.events!.question({ method: "confirm", title: "Continue?", message: "Offline question", options: [], timeoutMs: 10000 }, new AbortController().signal);
            await stopped;
          } else await service.tools.call(input.token, "chrona_reply", { text: "Fixture reply" });
          return { outcome: "finished" as const, sessionId: null, error: null };
        })() };
      } },
    };
    const service = createStewardService(ports), api = service.forWorkspace("w"), app = createStewardRoutes(ports, service);
    const list = <T,>(schema: z.ZodType<T>) => z.object({ items: schema.array() }).strict();
    const ok = z.object({ ok: z.literal(true) }).strict();
    const request = (path: string, method = "GET", body?: unknown) => app.request(`http://localhost${path}${path.includes("?") ? "&" : "?"}workspaceId=w`, {
      method, headers: { authorization: "Bearer test-owner", ...(body instanceof FormData ? {} : { "content-type": "application/json" }) },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    async function walk<T>(path: string, schema: z.ZodType<T>, method = "GET", body?: unknown): Promise<T> {
      const response = await request(path, method, body);
      expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(200);
      expect(response.status, `${method} ${path}`).toBeLessThan(300);
      return schema.parse(await response.json());
    }

    const chat = await walk("/chat", s.chatReplySchema, "POST", { text: "Hello", key: "web:walk" });
    expect(chat.messages[0]?.text).toBe("Fixture reply");
    const sessionPath = `/sessions/${chat.sessionId}`;
    expect((await walk("/sessions?source=web&status=active", list(s.sessionSchema))).items.map(x => x.id)).toContain(chat.sessionId);
    expect((await walk(sessionPath, s.sessionSchema)).key).toBe("web:walk");
    expect((await walk(sessionPath, s.sessionSchema, "PATCH", { title: "Renamed" })).title).toBe("Renamed");
    expect((await walk(`${sessionPath}/messages?limit=2`, list(s.messageSchema))).items).toHaveLength(2);
    expect((await walk(sessionPath, s.sessionSchema, "PATCH", { status: "ended" })).endedAt).not.toBeNull();
    const next = await walk("/chat", s.chatReplySchema, "POST", { text: "Again", key: "web:walk" });
    expect(next.sessionId).not.toBe(chat.sessionId);
    expect((await walk("/sessions/new", s.sessionSchema, "POST", { key: "web:walk" })).status).toBe("ended");
    for (const { query, ids } of [
      { query: "source=web&status=active", ids: [] },
      { query: "source=web&status=ended", ids: [chat.sessionId, next.sessionId] },
      { query: "source=mcp&status=ended", ids: [] },
    ]) expect((await walk(`/sessions?${query}`, list(s.sessionSchema))).items.map(x => x.id).sort()).toEqual(ids.sort());
    for (const path of ["/sessions?source=invalid", `${sessionPath}/messages?limit=0`]) expect((await request(path)).status).toBe(400);
    await db.workspace.create({ data: { id: "other", name: "Other" } });
    const foreign = await db.session.create({ data: { workspaceId: "other", key: "web:other", source: "web" } });
    for (const [path, method, body] of [[`/sessions/${foreign.id}`, "GET", undefined], [`/sessions/${foreign.id}`, "PATCH", { title: "No" }], [`/sessions/${foreign.id}/messages`, "GET", undefined], ["/sessions/new", "POST", { key: foreign.key }]] as const) expect((await request(path, method, body)).status).toBe(404);

    const module = await db.module.create({ data: { workspaceId: "w", name: "files", builtin: true, status: "paused", activeHash: "fixture" } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: "fixture", status: "active", intent: "fixture", source: "builtin", report: {}, manifest: { name: "files", description: "Documents", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], content: true } } });
    const base = `/apps/${module.id}`;
    expect((await walk("/apps", list(s.appSchema))).items[0]).toMatchObject({ id: module.id, entry: null, content: true, builtin: true });
    let file = await walk(`${base}/file`, s.fileContentSchema, "PUT", { path: "README.md", content: "# Files\n\n- [ ] task\n", baseRevision: null });
    expect((await walk("/apps", list(s.appSchema))).items[0]?.entry).toBe("README.md");
    expect((await walk(`${base}/file?path=README.md`, s.fileContentSchema)).content).toBe(file.content);
    file = await walk(`${base}/checkbox`, s.fileContentSchema, "POST", { path: "README.md", line: 3, checked: true, baseRevision: file.revision });
    expect(file.content).toContain("- [x]");
    await walk(`${base}/file`, s.fileContentSchema, "PUT", { path: ".chrona/entry", content: "daily.ui.json\n", baseRevision: null });
    expect((await walk("/apps", list(s.appSchema))).items[0]?.entry).toBe("daily.ui.json");
    expect((await walk(`${base}/tree`, list(s.fileNodeSchema))).items.some(x => x.path === "README.md")).toBe(true);
    await walk(`${base}/ui-event`, ok, "POST", { path: "README.md", kind: "open" });
    await walk(`${base}/file`, s.fileContentSchema, "PUT", { path: "daily.ui.json", baseRevision: null, content: JSON.stringify({ root: "panel", elements: { panel: { type: "Panel", props: { title: "Weight", data: "records.csv", fields: [{ key: "weight", label: "Weight", type: "number", required: true }], views: [{ kind: "table", columns: ["weight"] }] }, children: [] } } }) });
    expect((await walk(`${base}/panel-entry`, s.fileContentSchema, "POST", { dataPath: "records.csv", values: { weight: 70 } })).content).toContain("70");
    const form = new FormData(); form.set("file", new File(["fixture bytes"], "fixture.txt")); form.set("dir", "uploads");
    await walk(`${base}/upload`, s.fileNodeSchema, "POST", form);
    const raw = await request(`${base}/raw?path=uploads/fixture.txt`);
    expect(raw.status).toBe(200); expect(await raw.text()).toBe("fixture bytes");
    await db.module.update({ where: { id: module.id }, data: { status: "active" } });
    expect((await walk("/today", s.todayViewSchema)).apps).toEqual(expect.arrayContaining([expect.objectContaining({ id: module.id, status: "active", entry: "daily.ui.json" })]));
    await db.module.update({ where: { id: module.id }, data: { status: "paused" } });

    const schedule = await walk("/schedules", s.scheduleSchema, "POST", { mode: "remind", rule: { kind: "daily", time: "09:00" }, text: "Remember" });
    await walk("/schedules", list(s.scheduleSchema));
    await walk(`/schedules/${schedule.id}`, s.scheduleSchema, "PATCH", { status: "paused" });
    const approval = await api.approvals.create({ action: "send_external_message", title: "Send?", detail: "Fixture", preview: "Offline", payload: {} });
    await walk("/approvals?status=open", list(s.approvalSchema));
    await walk(`/approvals/${approval.id}/resolve`, s.approvalSchema, "POST", { decision: "deny" });
    await walk("/settings", s.settingsSchema);
    await walk("/settings", s.settingsSchema, "PATCH", { notifications: {} });
    await walk("/grants", list(s.grantSchema));
    const grant = await walk("/grants", s.grantSchema, "POST", { action: "send_external_message", mode: "preapproved", scope: { kind: "global" } });
    await walk(`/grants/${grant.id}/revoke`, s.grantSchema, "POST");
    await walk("/preferences", list(s.preferenceSchema));
    const preference = await walk("/preferences", s.preferenceSchema, "POST", { text: "Fixture preference" });
    const deleted = await request(`/preferences/${preference.id}`, "DELETE"); expect(deleted.status).toBe(204); expect(await deleted.text()).toBe("");
    const notification = await api.notifications.enqueue({ level: "digest", title: "Fixture", body: "Update", dedupeKey: "walk" });
    await walk("/notifications", list(s.notificationSchema));
    await walk(`/notifications/${notification.id}/feedback`, s.notificationSchema, "POST", { feedback: "useful" });
    await db.notification.update({ where: { id: notification.id }, data: { status: "failed" } });
    await walk(`/notifications/${notification.id}/retry`, s.notificationSchema, "POST");
    await walk("/connectors", list(s.connectorSchema));
    const connector = await walk("/connectors", s.connectorSchema, "POST", { kind: "email", label: "Offline" });
    await walk(`/connectors/${connector.id}`, s.connectorSchema, "PATCH", { label: "Renamed offline" });
    await walk(`/connectors/${connector.id}/test`, ok, "POST");
    await walk(`/connectors/${connector.id}/sync`, z.object({ received: z.number().int().nonnegative() }).strict(), "POST");
    await walk(`/connectors/${connector.id}/items`, list(s.inboundItemSchema));

    const pendingChat = request("/chat", "POST", { text: "Ask fixture", key: "web:question" });
    let active: z.infer<typeof s.providerRunViewSchema> | undefined;
    for (let i = 0; i < 200; i++) {
      active = (await walk("/provider/runs", list(s.providerRunViewSchema))).items.find(x => x.interactions.some(q => q.status === "pending"));
      if (active) break;
      await Bun.sleep(5);
    }
    expect(active).toBeDefined();
    expect((await walk(`/sessions/${active!.sessionId}`, s.sessionSchema)).running).toBe(true);
    const interaction = active!.interactions.find(x => x.status === "pending")!;
    await walk(`/provider/runs?sessionId=${active!.sessionId}`, list(s.providerRunViewSchema));
    await walk(`/provider/interactions/${interaction.id}/answer`, ok, "POST", { decision: "submit", value: true });
    await walk(`/provider/runs/${active!.id}/cancel`, ok, "POST");
    const completed = await pendingChat; expect(completed.status).toBe(200); s.chatReplySchema.parse(await completed.json());
    expect((await walk(`/sessions/${active!.sessionId}`, s.sessionSchema)).running).toBe(false);
    await walk("/health", s.healthSchema);
  } finally {
    stop?.();
    await db.$disconnect();
    if (savedKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = savedKey;
  }
}, 20000);
