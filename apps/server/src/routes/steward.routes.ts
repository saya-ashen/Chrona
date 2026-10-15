import { Hono } from "hono";
import { z } from "zod";
import * as s from "@chrona/contracts/steward";
import { createStewardService, StewardError, type StewardPorts, type StewardService } from "@chrona/engine";
import { isLocalOwnerAuthorized } from "../middleware/auth";

export type StewardRoutePorts = StewardPorts;

export function createStewardRoutes(ports: StewardRoutePorts, service: StewardService = createStewardService(ports), wake: () => void = () => {}) {
  const router = new Hono<{ Variables: { steward: ReturnType<StewardService["forWorkspace"]> } }>();
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
  router.onError((error, c) => {
    if (error instanceof SyntaxError) return c.json({ code: "INVALID_REQUEST" }, 400);
    if (error instanceof StewardError) return c.json({ code: error.code, message: error.message }, { not_found: 404, conflict: 409, invalid: 400, forbidden: 403 }[error.code] as 404 | 409 | 400 | 403);
    return c.json({ code: "INTERNAL_ERROR" }, 500);
  });
  const request = <T extends z.ZodType>(schema: T) => ({ parse(raw: unknown): z.output<T> {
    const result = schema.safeParse(raw);
    if (!result.success) throw new StewardError("invalid", "Invalid request");
    return result.data;
  } });
  const items = <T extends z.ZodType>(schema: T) => z.object({ items: z.array(schema) });
  router.get("/tools", async c => c.json(items(s.toolSchema).parse({ items: await c.get("steward").tools.list() })));
  router.post("/tools/:id/transition", async c => c.json(s.toolSchema.parse(await c.get("steward").tools.transition(c.req.param("id"), request(s.toolTransitionSchema).parse(await c.req.json())))));
  router.get("/tools/:id", async c => c.json(s.toolDetailSchema.parse(await c.get("steward").tools.getTool(c.req.param("id")))));
  router.post("/tools/:id/entries", async c => c.json(s.panelEntrySchema.parse(await c.get("steward").tools.addEntry(c.req.param("id"), request(s.addPanelEntrySchema).parse(await c.req.json()).values))));
  router.delete("/tools/:id/entries/:entryId", async c => { await c.get("steward").tools.deleteEntry(c.req.param("id"), c.req.param("entryId")); return c.body(null, 204); });
  router.get("/today", async c => c.json(s.todayViewSchema.parse(await c.get("steward").today())));
  router.get("/health", async c => c.json(s.healthSchema.parse(await c.get("steward").health())));
  router.post("/chat", async c => c.json(s.chatReplySchema.parse(await c.get("steward").chat.handleMessage({ channel: "in_app", ...request(s.chatInputSchema).parse(await c.req.json()) }))));
  router.get("/chat/messages", async c => c.json(items(s.chatMessageSchema).parse({ items: await c.get("steward").chat.messages(request(z.coerce.number().int().min(1).max(100).optional()).parse(c.req.query("limit"))) })));
  router.get("/affairs", async c => c.json(items(s.affairSchema).parse({ items: await c.get("steward").affairs.list({ status: request(z.enum(s.AFFAIR_STATUSES).optional()).parse(c.req.query("status")) }) })));
  router.post("/affairs", async c => c.json(s.affairSchema.parse(await c.get("steward").affairs.create(request(s.createAffairSchema).parse(await c.req.json())))));
  router.get("/affairs/:id", async c => c.json(s.affairDetailSchema.parse(await c.get("steward").affairs.detail(c.req.param("id")))));
  router.patch("/affairs/:id", async c => c.json(s.affairSchema.parse(await c.get("steward").affairs.update(c.req.param("id"), request(s.updateAffairSchema).parse(await c.req.json())))));
  router.post("/affairs/:id/entries", async c => c.json(s.entrySchema.parse(await c.get("steward").affairs.addEntry(c.req.param("id"), request(s.addEntrySchema).parse(await c.req.json())))));
  router.get("/affairs/:id/results/:version", async c => c.json(s.resultSchema.parse(await c.get("steward").affairs.getResult(c.req.param("id"), request(z.coerce.number().int().positive()).parse(c.req.param("version"))))));
  router.post("/asks/:id/resolve", async c => c.json(s.askSchema.parse(await c.get("steward").asks.resolve(c.req.param("id"), request(s.resolveAskSchema).parse(await c.req.json())))));
  router.get("/settings", async c => c.json(s.settingsSchema.parse(await c.get("steward").settings.get())));
  router.patch("/settings", async c => c.json(s.settingsSchema.parse(await c.get("steward").settings.update(request(s.updateSettingsSchema).parse(await c.req.json())))));
  router.get("/grants", async c => c.json(items(s.grantSchema).parse({ items: await c.get("steward").grants.list() })));
  router.post("/grants", async c => c.json(s.grantSchema.parse(await c.get("steward").grants.create(request(s.createGrantSchema).parse(await c.req.json())))));
  router.post("/grants/:id/revoke", async c => c.json(s.grantSchema.parse(await c.get("steward").grants.revoke(c.req.param("id")))));
  router.get("/preferences", async c => c.json(items(s.preferenceSchema).parse({ items: await c.get("steward").preferences.list() })));
  router.post("/preferences", async c => c.json(s.preferenceSchema.parse(await c.get("steward").preferences.add(request(s.createPreferenceSchema).parse(await c.req.json())))));
  router.delete("/preferences/:id", async c => { await c.get("steward").preferences.delete(c.req.param("id")); return c.body(null, 204); });
  router.get("/notifications", async c => c.json(items(s.notificationSchema).parse({ items: await c.get("steward").notifications.list() })));
  router.post("/notifications/:id/feedback", async c => c.json(s.notificationSchema.parse(await c.get("steward").notifications.recordFeedback(c.req.param("id"), request(s.notificationFeedbackSchema).parse(await c.req.json()).feedback))));
  router.post("/notifications/:id/retry", async c => c.json(s.notificationSchema.parse(await c.get("steward").notifications.retry(c.req.param("id")))));
  router.get("/connections", async c => c.json(items(s.connectionSchema).parse({ items: await c.get("steward").connections.list() })));
  router.post("/connections", async c => c.json(s.connectionSchema.parse(await c.get("steward").connections.create(request(s.createConnectionSchema).parse(await c.req.json())))));
  router.post("/connections/:id/transition", async c => c.json(s.connectionSchema.parse(await c.get("steward").connections.transition(c.req.param("id"), request(s.connectionTransitionSchema).parse(await c.req.json())))));
  router.post("/connections/:id/sync", async c => { const connections = c.get("steward").connections; await connections.syncConnection(c.req.param("id")); return c.json(s.connectionSchema.parse((await connections.detail(c.req.param("id"))).connection)); });
  return router;
}
