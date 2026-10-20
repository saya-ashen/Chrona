import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import * as s from "@chrona/contracts/steward";
import { createStewardService, StewardError, type StewardPorts, type StewardService } from "@chrona/engine";
import { declaredPanel } from "./steward-panel";
import { isLocalOwnerAuthorized } from "../middleware/auth";

export type StewardRoutePorts = StewardPorts;
type StewardVariables = { Variables: { steward: ReturnType<StewardService["forWorkspace"]> } };
function providerRoutes(router: Hono<StewardVariables>) {
  router.get("/provider/runs", async c => c.json({ items: (await c.get("steward").provider.list(z.string().min(1).max(128).optional().parse(c.req.query("affairId")))).map(item => s.providerRunViewSchema.parse(item)) }));
  router.post("/provider/interactions/:id/answer", async c => c.json(await c.get("steward").provider.answer(c.req.param("id"), s.providerAnswerSchema.parse(await c.req.json()))));
  router.post("/provider/runs/:id/cancel", async c => c.json(await c.get("steward").provider.cancel(c.req.param("id"))));
  router.patch("/affairs/:id", async c => {
    const id = c.req.param("id"), input = s.updateAffairSchema.parse(await c.req.json()), api = c.get("steward");
    const affair = await api.affairs.update(id, input);
    if (input.status && input.status !== "active") await api.provider.stopAffair(id);
    return c.json(affair);
  });
}
export function createStewardRoutes(ports: StewardPorts, service: StewardService = createStewardService(ports), wake: () => void = () => {}) {
  const router = new Hono<StewardVariables>();
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!isLocalOwnerAuthorized(c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    const workspaceId = c.req.query("workspaceId")?.trim();
    if (!workspaceId) return c.json({ code: "WORKSPACE_REQUIRED" }, 400);
    if (!await ports.db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })) return c.json({ code: "NOT_FOUND" }, 404);
    c.set("steward", service.forWorkspace(workspaceId));
    await next();
    if (c.req.method !== "GET" && c.res.ok) wake();
  });
  router.use("*", bodyLimit({ maxSize: 21 * 1024 * 1024 }));
  router.onError((error, c) => {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return c.json({ code: "INVALID_REQUEST" }, 400);
    if (error instanceof StewardError) return c.json({ code: error.code }, { not_found: 404, conflict: 409, invalid: 400, forbidden: 403 }[error.code] as 404 | 409 | 400 | 403);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return c.json({ code: "NOT_FOUND" }, 404);
    if (code === "EEXIST") return c.json({ code: "CONFLICT" }, 409);
    return c.json({ code: "INTERNAL_ERROR" }, 500);
  });
  router.get("/today", async c => c.json(s.todayViewSchema.parse(await c.get("steward").today())));
  router.get("/health", async c => c.json(s.healthSchema.parse(await c.get("steward").health())));
  providerRoutes(router);
  router.post("/chat", async c => c.json(s.chatReplySchema.parse(await c.get("steward").chat.handleMessage({ channel: "in_app", ...s.chatInputSchema.parse(await c.req.json()) }))));
  router.get("/chat/messages", async c => c.json({ items: await c.get("steward").chat.messages(z.coerce.number().int().min(1).max(100).optional().parse(c.req.query("limit"))) }));
  router.get("/affairs", async c => c.json({ items: await c.get("steward").affairs.list(z.enum(s.AFFAIR_STATUSES).optional().parse(c.req.query("status"))) }));
  router.post("/affairs", async c => c.json(await c.get("steward").affairs.create(s.createAffairSchema.parse(await c.req.json()))));
  router.get("/affairs/:id", async c => c.json(s.affairDetailSchema.parse(await c.get("steward").affairs.detail(c.req.param("id")))));
  router.get("/affairs/:id/file", async c => c.json(await (await c.get("steward").affairs.files(c.req.param("id"))).read(s.affairPathSchema.parse(c.req.query("path")))));
  router.put("/affairs/:id/file", async c => {
    const input = s.saveFileSchema.parse(await c.req.json());
    return c.json(await (await c.get("steward").affairs.files(c.req.param("id"))).save(input.path, input.content, input.baseRevision));
  });
  router.post("/affairs/:id/ui-event", async c => c.json(await c.get("steward").uiEvent(c.req.param("id"), s.uiEventSchema.parse(await c.req.json()))));
  router.post("/affairs/:id/checkbox", async c => {
    const input = s.toggleCheckboxSchema.parse(await c.req.json());
    return c.json(await (await c.get("steward").affairs.files(c.req.param("id"))).toggleCheckbox(input.path, input.line, input.checked, input.baseRevision));
  });
  router.post("/affairs/:id/panel-entry", async c => {
    const input = s.panelEntrySchema.parse(await c.req.json());
    const files = await c.get("steward").affairs.files(c.req.param("id"));
    for (const node of await files.tree()) {
      if (node.kind !== "file" || !/\.(md|ui\.json)$/.test(node.path)) continue;
      const panel = declaredPanel((await files.read(node.path)).content, node.path, input.dataPath);
      if (panel) {
        try { return c.json(await files.appendPanelEntry(input.dataPath, panel.fields, input.values)); }
        catch (error) { if (error instanceof StewardError) throw error; throw new StewardError("invalid", "Invalid panel entry"); }
      }
    }
    throw new StewardError("not_found", "Panel not found");
  });
  router.post("/affairs/:id/upload", async c => {
    const files = await c.get("steward").affairs.files(c.req.param("id"));
    let form: FormData;
    try { form = await c.req.formData(); } catch { throw new StewardError("invalid", "Invalid multipart body"); }
    const file = form.get("file"), directory = form.get("dir") ?? "";
    if (!(file instanceof File) || typeof directory !== "string" || form.getAll("file").length !== 1 || file.size > 20 * 1024 * 1024) throw new StewardError("invalid", "Invalid upload");
    return c.json(await files.upload(directory, file.name, new Uint8Array(await file.arrayBuffer())));
  });
  router.get("/affairs/:id/raw", async c => {
    const path = s.affairPathSchema.parse(c.req.query("path"));
    const bytes = await (await c.get("steward").affairs.files(c.req.param("id"))).raw(path);
    c.header("Content-Type", "application/octet-stream");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "sandbox; default-src 'none'");
    c.header("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(path.split("/").pop()!).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16)}`)}`);
    return c.body(bytes);
  });
  router.get("/affairs/:id/revisions", async c => c.json({ items: await (await c.get("steward").affairs.files(c.req.param("id"))).revisions(s.affairPathSchema.optional().parse(c.req.query("path"))) }));
  router.get("/affairs/:id/revisions/:sha/diff", async c => c.json({ diff: await (await c.get("steward").affairs.files(c.req.param("id"))).diff(c.req.param("sha")) }));
  router.post("/affairs/:id/revisions/:sha/revert", async c => c.json(await (await c.get("steward").affairs.files(c.req.param("id"))).revert(c.req.param("sha"))));
  router.get("/affairs/:id/schedules", async c => c.json({ items: await c.get("steward").schedules.list(c.req.param("id")) }));
  router.post("/affairs/:id/schedules", async c => c.json(await c.get("steward").schedules.create(c.req.param("id"), s.createScheduleSchema.parse(await c.req.json()))));
  router.patch("/schedules/:id", async c => c.json(await c.get("steward").schedules.update(c.req.param("id"), s.updateScheduleSchema.parse(await c.req.json()))));
  router.get("/approvals", async c => c.json({ items: await c.get("steward").approvals.list(z.enum(s.APPROVAL_STATUSES).optional().parse(c.req.query("status"))) }));
  router.post("/approvals/:id/resolve", async c => c.json((await c.get("steward").approvals.resolve(c.req.param("id"), s.resolveApprovalSchema.parse(await c.req.json()))).approval));
  router.get("/settings", async c => c.json(await c.get("steward").settings.get()));
  router.patch("/settings", async c => c.json(await c.get("steward").settings.update(s.updateSettingsSchema.parse(await c.req.json()))));
  router.get("/grants", async c => c.json({ items: await c.get("steward").grants.list() }));
  router.post("/grants", async c => c.json(await c.get("steward").grants.create(s.createGrantSchema.parse(await c.req.json()))));
  router.post("/grants/:id/revoke", async c => c.json(await c.get("steward").grants.revoke(c.req.param("id"))));
  router.get("/preferences", async c => c.json({ items: await c.get("steward").preferences.list() }));
  router.post("/preferences", async c => c.json(await c.get("steward").preferences.add(s.createPreferenceSchema.parse(await c.req.json()))));
  router.delete("/preferences/:id", async c => { await c.get("steward").preferences.delete(c.req.param("id")); return c.body(null, 204); });
  router.get("/notifications", async c => c.json({ items: await c.get("steward").notifications.list() }));
  router.post("/notifications/:id/feedback", async c => c.json(await c.get("steward").notifications.recordFeedback(c.req.param("id"), z.object({ feedback: z.enum(["useful", "not_useful"]) }).strict().parse(await c.req.json()).feedback)));
  router.post("/notifications/:id/retry", async c => c.json(await c.get("steward").notifications.retry(c.req.param("id"))));
  router.get("/connectors", async c => c.json({ items: await c.get("steward").connectors.list() }));
  router.post("/connectors", async c => c.json(await c.get("steward").connectors.create(s.createConnectorSchema.parse(await c.req.json()))));
  router.patch("/connectors/:id", async c => c.json(await c.get("steward").connectors.update(c.req.param("id"), s.updateConnectorSchema.parse(await c.req.json()))));
  router.post("/connectors/:id/test", async c => c.json(await c.get("steward").connectors.test(c.req.param("id"))));
  router.post("/connectors/:id/sync", async c => c.json(await c.get("steward").connectors.sync(c.req.param("id"))));
  router.get("/connectors/:id/items", async c => c.json({ items: await c.get("steward").connectors.items(c.req.param("id")) }));
  return router;
}
