import { Hono } from "hono";
import { z } from "zod";
import * as s from "@chrona/contracts/steward";
import { createStewardService, type StewardPorts, type StewardService } from "@chrona/engine";
import { toolSpecSchema } from "@chrona/domain/steward/tool-spec";
import { isLocalOwnerAuthorized } from "../middleware/auth";

export type StewardRoutePorts = Omit<StewardPorts, "authorize">;

export function createStewardRoutes(ports: StewardRoutePorts) {
  const router = new Hono<{ Variables: { steward: StewardService } }>();
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!isLocalOwnerAuthorized(c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    const workspaceId = c.req.query("workspaceId")?.trim();
    if (!workspaceId) return c.json({ code: "WORKSPACE_REQUIRED" }, 400);
    if (!await ports.db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })) return c.json({ code: "NOT_FOUND" }, 404);
    c.set("steward", createStewardService({ ...ports, authorize: async () => ({ workspaceId, actorKey: "owner:local", canWrite: true }) }));
    await next();
  });
  router.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ code: "INVALID_REQUEST" }, 400);
    const code = "code" in error ? String(error.code) : error.name === "ToolTransitionError" ? "INVALID_TRANSITION" : "INTERNAL_ERROR";
    const status = code === "NOT_FOUND" || code === "TOOL_NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : ["REVISION_CONFLICT", "SYNC_REFUSED", "INVALID_TRANSITION", "TOOL_CONFLICT", "TOOL_NOT_ENABLED", "TOOL_NOT_PERMITTED", "TOOL_RUN_FAILED"].includes(code) ? 409 : 500;
    return c.json({ code }, status);
  });
  const items = <T extends z.ZodType>(schema: T) => z.object({ items: z.array(schema) });
  router.get("/today", async c => c.json(s.todayViewSchema.parse(await c.get("steward").today())));
  router.get("/health", async c => c.json(s.stewardHealthSchema.parse(await c.get("steward").health())));
  router.get("/affairs", async c => c.json(items(s.affairSchema).parse({ items: await c.get("steward").affairs.list() })));
  router.post("/affairs", async c => c.json(s.affairSchema.parse(await c.get("steward").affairs.create(s.createAffairSchema.parse(await c.req.json())))));
  router.get("/affairs/:id", async c => c.json(s.affairDetailSchema.parse(await c.get("steward").affairs.detail(c.req.param("id")))));
  router.patch("/affairs/:id", async c => c.json(s.affairSchema.parse(await c.get("steward").affairs.update(c.req.param("id"), s.updateAffairSchema.parse(await c.req.json())))));
  router.get("/connections", async c => c.json(items(s.connectionSchema).parse({ items: await c.get("steward").connections.list() })));
  router.post("/connections", async c => c.json(s.connectionSchema.parse(await c.get("steward").connections.create(s.createConnectionSchema.parse(await c.req.json())))));
  router.post("/connections/:id/transition", async c => c.json(s.connectionSchema.parse(await c.get("steward").connections.transition(c.req.param("id"), s.connectionTransitionSchema.parse(await c.req.json())))));
  router.post("/connections/:id/sync", async c => c.json(s.syncResultSchema.parse(await c.get("steward").syncConnection(c.req.param("id")))));
  router.get("/delegations", async c => c.json(items(s.delegationSchema).parse({ items: await c.get("steward").delegations.list() })));
  router.post("/delegations", async c => c.json(s.delegationSchema.parse(await c.get("steward").delegations.propose(s.proposeDelegationSchema.parse(await c.req.json())))));
  router.post("/delegations/:id/transition", async c => c.json(s.delegationSchema.parse(await c.get("steward").delegations.transition(c.req.param("id"), s.delegationTransitionSchema.parse(await c.req.json())))));
  router.get("/attention", async c => c.json(items(s.attentionItemSchema).parse({ items: await c.get("steward").attention.list(z.enum(s.ATTENTION_STATUSES).optional().parse(c.req.query("status"))) })));
  router.post("/attention/:id/decision", async c => c.json(s.attentionItemSchema.parse(await c.get("steward").attention.decide(c.req.param("id"), s.attentionDecisionSchema.parse(await c.req.json())))));
  router.get("/events", async c => c.json(items(s.inboundEventSchema).parse({ items: await c.get("steward").events.list({ status: z.enum(s.EVENT_STATUSES).optional().parse(c.req.query("status")), connectionId: c.req.query("connectionId") }) })));
  router.post("/events/:id/link", async c => c.json(s.inboundEventSchema.parse(await c.get("steward").linkEvent(c.req.param("id"), s.eventLinkSchema.parse(await c.req.json())))));
  router.get("/notifications", async c => c.json(items(s.notificationSchema).parse({ items: await c.get("steward").notifications.list() })));
  router.post("/notifications/:id/acknowledge", async c => c.json(s.notificationSchema.parse(await c.get("steward").notifications.acknowledge(c.req.param("id")))));
  router.post("/notifications/:id/retry", async c => c.json(s.notificationSchema.parse(await c.get("steward").notifications.retry(c.req.param("id")))));
  router.post("/follow-ups/:id/complete", async c => c.json(s.followUpSchema.parse(await c.get("steward").followUps.complete(c.req.param("id")))));
  router.post("/follow-ups/:id/cancel", async c => c.json(s.followUpSchema.parse(await c.get("steward").followUps.cancel(c.req.param("id")))));
  router.get("/tools", async c => c.json(items(s.managedToolSchema).parse({ items: await c.get("steward").tools.list() })));
  router.post("/tools", async c => {
    const input = s.generateToolSchema.parse(await c.req.json());
    const spec = toolSpecSchema.safeParse(input.spec);
    if (!spec.success) return c.json({ code: "INVALID_REQUEST", message: `Invalid tool spec: ${spec.error.issues.map(issue => `${issue.path.join(".") || "spec"}: ${issue.message}`).join("; ")}` }, 400);
    return c.json(s.generatedToolSchema.parse(await c.get("steward").tools.generate({ ...input, spec: spec.data })));
  });
  router.post("/tools/:id/transition", async c => c.json(s.managedToolSchema.parse(await c.get("steward").tools.transition(c.req.param("id"), s.toolTransitionSchema.parse(await c.req.json())))));
  router.post("/tools/:id/run", async c => c.json(s.toolRunResultSchema.parse(await c.get("steward").tools.run(c.req.param("id"), s.runToolSchema.parse(await c.req.json())))));
  router.get("/schedule", async c => {
    const from = z.string().datetime({ offset: true }).parse(c.req.query("from"));
    const to = z.string().datetime({ offset: true }).parse(c.req.query("to"));
    if (Date.parse(from) > Date.parse(to)) return c.json({ code: "INVALID_REQUEST" }, 400);
    return c.json(items(s.scheduleItemSchema).parse({ items: await c.get("steward").schedule(from, to) }));
  });
  return router;
}
