import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";
import { createTaskResultRoutes } from "./result.routes";

describe("task result finalization retry route", () => {
	it("[RESULT-002] retries failed finalization and returns the new ready result", async () => {
		const retryFinalization = mock(async ({ taskId }: { taskId: string }) => ({
			taskId,
			finalizedResult: {
				sourceRevision: 3,
				finalizedAt: "2026-08-16T00:00:00.000Z",
				manifest: { sourceRevision: 3 },
				spec: { root: "result", elements: {} },
			},
			finalization: {
				status: "Ready",
				sourceRevision: 3,
				attempt: 2,
				finalizedAt: "2026-08-16T00:00:00.000Z",
			},
		}));
		const engine = {
			tasks: { result: { retryFinalization } },
		} as unknown as ChronaEngine;
		const app = new Hono().route("/api", createTaskResultRoutes(engine));

		const response = await app.request(
			"http://local/api/tasks/task-finalization/result/finalization/retry",
			{ method: "POST" },
		);

		expect(response.status).toBe(200);
		expect(retryFinalization).toHaveBeenCalledWith({
			taskId: "task-finalization",
		});
		expect(await response.json()).toMatchObject({
			taskId: "task-finalization",
			finalizedResult: { sourceRevision: 3 },
			finalization: { status: "Ready", attempt: 2 },
		});
	});
});
