import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "@chrona/db";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";
import type { ChronaEngine } from "@chrona/engine";
import { Hono } from "hono";
import { z } from "zod";
import type { StewardRuntime } from "../steward-runtime";
import { isLocalOwnerAuthorized } from "../middleware/auth";
import { internalServerError, json } from "../lib/http";

/**
 * Returns true only when the E2E test-support routes are explicitly enabled
 * via `CHRONA_E2E_TEST_ROUTES=1`. This flag is set ONLY by the Playwright
 * webServer command — never in production or normal dev.
 */
function createStewardTestRoutes(runtime: StewardRuntime) {
  const router = new Hono();
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!isLocalOwnerAuthorized(c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    await next();
  });
  router.onError((error, c) => c.json({ code: error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REQUEST" : "TEST_SEAM_FAILED" }, error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500));
  router.post("/local-source/push", async c => {
    const { items } = z.object({ items: z.array(z.object({ externalId: z.string().min(1).max(500), title: z.string().max(500), body: z.string().max(8000), author: z.string().max(200), url: z.string().url().max(2048).nullable(), occurredAt: z.string().datetime({ offset: true }), threadId: z.string().optional() }).strict()).max(500) }).strict().parse(await c.req.json());
    runtime.localSource.push(items); return c.json({ ok: true });
  });
  router.post("/assessor", async c => { const input = z.object({ available: z.boolean() }).strict().parse(await c.req.json()); runtime.setAvailable(input.available); return c.json({ ok: true }); });
  router.post("/delivery/script", async c => {
    const { outcomes } = z.object({ outcomes: z.array(z.discriminatedUnion("outcome", [z.object({ outcome: z.literal("accepted"), receiptRef: z.string().nullable().optional() }).strict(), z.object({ outcome: z.literal("rejected"), error: z.string().max(500), retryable: z.boolean() }).strict(), z.object({ outcome: z.literal("uncertain"), error: z.string().max(500) }).strict()])).max(100) }).strict().parse(await c.req.json());
    runtime.delivery.script(outcomes); return c.json({ ok: true });
  });
  router.get("/delivery/sent", c => c.json({ items: runtime.delivery.sent }));
  router.post("/tick", async c => {
    const workspaceId = c.req.query("workspaceId")?.trim();
    if (!workspaceId) return c.json({ code: "WORKSPACE_REQUIRED" }, 400);
    if (!await runtime.ports.db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })) return c.json({ code: "NOT_FOUND" }, 404);
    return c.json(await runtime.service(workspaceId).tick());
  });
  return router;
}

export function areE2eTestRoutesEnabled(): boolean {
	const value = process.env.CHRONA_E2E_TEST_ROUTES?.trim().toLowerCase();
	return value === "1" || value === "true";
}

/** Test-only routes mounted only when {@link areE2eTestRoutesEnabled} is true. */
export function createTestSupportRoutes(engine: ChronaEngine, steward?: StewardRuntime) {
	const router = new Hono();
	if (steward && areE2eTestRoutesEnabled()) router.route("/test/steward", createStewardTestRoutes(steward));
	return router
		.post("/test/orchestrator/tick", async (c) => {
			try {
				await engine.runtime.tickTaskOrchestrator();
				return json(c, { ok: true, tickedAt: new Date().toISOString() });
			} catch (cause) {
				return internalServerError(
					c,
					"POST /api/test/orchestrator/tick",
					cause,
					"Failed to run orchestrator tick",
				);
			}
		})
		.get("/test/tasks/:taskId/command-receipt", async (c) => {
			try {
				const taskId = c.req.param("taskId");
				const commandKey = c.req.query("commandKey")?.trim();
				if (!commandKey)
					return json(c, { error: "commandKey is required" }, 400);
				const receipt = await db.taskPlanCommandReceipt.findFirst({
					where: { commandKey, planRun: { taskId } },
					orderBy: { createdAt: "desc" },
					select: {
						commandKey: true,
						status: true,
						result: true,
						completedAt: true,
					},
				});
				if (!receipt)
					return json(c, { error: "Command receipt not found" }, 404);
				return json(c, { receipt });
			} catch (cause) {
				return internalServerError(
					c,
					"GET /api/test/tasks/:taskId/command-receipt",
					cause,
					"Failed to load E2E command receipt",
				);
			}
		})
		.post("/test/tasks/:taskId/artifact", async (c) => {
			try {
				const taskId = c.req.param("taskId");
				const task = await db.task.findUnique({
					where: { id: taskId },
					select: { id: true, workspaceId: true },
				});
				const run = await db.run.findFirst({
					where: { taskId, status: "Completed" },
					orderBy: { createdAt: "desc" },
					select: { id: true },
				});
				if (!task || !run) {
					return json(c, { error: "A completed task run is required" }, 400);
				}
				const artifactPath = join(
					getChronaGeneratedFilesDir(),
					run.id,
					"deterministic-lifecycle-report.md",
				);
				mkdirSync(dirname(artifactPath), { recursive: true });
				writeFileSync(
					artifactPath,
					"# Deterministic lifecycle report\n\nfindings, risks, and recommendations.",
					"utf8",
				);
				const artifact = await db.artifact.create({
					data: {
						workspaceId: task.workspaceId,
						taskId: task.id,
						runId: run.id,
						type: "report",
						title: "Deterministic lifecycle report",
						uri: `generated://${run.id}/deterministic-lifecycle-report.md`,
						contentPreview:
							"# Deterministic lifecycle report\n\nfindings, risks, and recommendations.",
					},
					select: { id: true, title: true, runId: true },
				});
				return json(c, { artifact });
			} catch (cause) {
				return internalServerError(
					c,
					"POST /api/test/tasks/:taskId/artifact",
					cause,
					"Failed to seed E2E Artifact",
				);
			}
		});
}
