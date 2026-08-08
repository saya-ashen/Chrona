import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "@chrona/db";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";
import type { ChronaEngine } from "@chrona/engine";
import { Hono } from "hono";
import { internalServerError, json } from "../lib/http";

/**
 * Returns true only when the E2E test-support routes are explicitly enabled
 * via `CHRONA_E2E_TEST_ROUTES=1`. This flag is set ONLY by the Playwright
 * webServer command — never in production or normal dev.
 */
export function areE2eTestRoutesEnabled(): boolean {
	const value = process.env.CHRONA_E2E_TEST_ROUTES?.trim().toLowerCase();
	return value === "1" || value === "true";
}

/** Test-only routes mounted only when {@link areE2eTestRoutesEnabled} is true. */
export function createTestSupportRoutes(engine: ChronaEngine) {
	return new Hono()
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
