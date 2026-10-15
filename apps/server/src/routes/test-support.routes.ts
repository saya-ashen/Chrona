import type { StewardService, StewardPorts } from "@chrona/engine";
import type { createScopedTestSource } from "../steward-test-source";
import type { createTestDelivery } from "@chrona/integrations/steward";
import { Hono } from "hono";
import { z } from "zod";
import { isLocalOwnerAuthorized } from "../middleware/auth";

// Describe the seam here rather than importing its runtime composition (a cycle).
type StewardTestRuntime = {
  ports: Pick<StewardPorts, "db">;
  localSource?: ReturnType<typeof createScopedTestSource>;
  delivery?: ReturnType<typeof createTestDelivery>;
  service: StewardService;
  setAvailable(value: boolean): void;
  installTestAgent(): void;
  driveTestTick(): Promise<unknown>;
};

function createStewardTestRoutes(runtime: StewardTestRuntime) {
  const router = new Hono();
  const { localSource, delivery } = runtime;
  if (!areE2eTestRoutesEnabled() || !localSource || !delivery) return router;
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!isLocalOwnerAuthorized(c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    const workspaceId = c.req.query("workspaceId")?.trim();
    if (!workspaceId) return c.json({ code: "WORKSPACE_REQUIRED" }, 400);
    if (!await runtime.ports.db.workspace.findUnique({ where: { id: workspaceId } })) return c.json({ code: "NOT_FOUND" }, 404);
    await next();
  });
  router.onError((error, c) => c.json({ code: error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REQUEST" : "TEST_SEAM_FAILED" }, error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500));
  router.post("/local-source/push", async c => {
    const { items } = z.object({ items: z.array(z.object({ externalId: z.string().min(1).max(500), title: z.string().max(500), body: z.string().max(8000), author: z.string().max(200).optional(), current: z.boolean().optional(), url: z.string().url().max(2048).nullable(), occurredAt: z.string().datetime({ offset: true }), threadId: z.string().optional() }).strict()).max(500) }).strict().parse(await c.req.json());
    localSource.push(items, c.req.query("workspaceId")!); return c.json({ ok: true });
  });
  router.post("/assessor", async c => { const input = z.object({ available: z.boolean() }).strict().parse(await c.req.json()); runtime.setAvailable(input.available); return c.json({ ok: true }); });
  router.post("/delivery/script", async c => {
    const { outcomes } = z.object({ outcomes: z.array(z.discriminatedUnion("outcome", [z.object({ outcome: z.literal("accepted"), receiptRef: z.string().nullable().optional() }).strict(), z.object({ outcome: z.literal("rejected"), error: z.string().max(500), retryable: z.boolean() }).strict(), z.object({ outcome: z.literal("uncertain"), error: z.string().max(500) }).strict()])).max(100) }).strict().parse(await c.req.json());
    delivery.script(outcomes); return c.json({ ok: true });
  });
  router.post("/agent/install", c => { runtime.installTestAgent(); return c.json({ ok: true }); });
  router.post("/reset", async c => {
    const workspaceId = c.req.query("workspaceId")!;
    const db = runtime.ports.db;
    if (await db.affairRun.count({ where: { workspaceId, status: "running" } })) return c.json({ code: "BUSY" }, 409);
    const where = { workspaceId };
    await db.$transaction(async tx => {
      await tx.notification.deleteMany({ where });
      await tx.chatMessage.deleteMany({ where });
      await tx.affair.deleteMany({ where });
      await tx.ask.deleteMany({ where });
      await tx.managedTool.deleteMany({ where });
      await tx.sourceConnection.deleteMany({ where });
      await tx.grant.deleteMany({ where });
      await tx.preference.deleteMany({ where });
      await tx.audit.deleteMany({ where });
      await tx.stewardState.deleteMany({ where });
      await tx.workspace.update({ where: { id: workspaceId }, data: { settings: {} } });
    });
    localSource.reset(workspaceId);
    return c.json({ ok: true });
  });
  router.get("/delivery/sent", async c => {
    const notifications = await runtime.ports.db.notification.findMany({ where: { workspaceId: c.req.query("workspaceId")! }, select: { idempotencyKey: true } });
    const keys = new Set(notifications.map(n => n.idempotencyKey));
    return c.json({ items: delivery.sent.filter(item => keys.has(item.idempotencyKey)) });
  });
  router.post("/tick", async c => {
    const workspaceId = c.req.query("workspaceId")?.trim();
    if (!workspaceId) return c.json({ code: "WORKSPACE_REQUIRED" }, 400);
    if (!await runtime.ports.db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })) return c.json({ code: "NOT_FOUND" }, 404);
    return c.json(await runtime.driveTestTick());
  });
  return router;
}

export function areE2eTestRoutesEnabled(): boolean {
  const value = process.env.CHRONA_E2E_TEST_ROUTES?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/** Test-only routes mounted only when {@link areE2eTestRoutesEnabled} is true. */
export function createTestSupportRoutes(steward: StewardTestRuntime) {
  const router = new Hono();
  if (areE2eTestRoutesEnabled()) router.route("/test/steward", createStewardTestRoutes(steward));
  return router;
}
