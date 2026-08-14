import { afterEach, describe, expect, it, vi } from "vitest";
import {
	startTaskPlanGenerationSession,
	stopTaskPlanGenerationSession,
} from "@features/task-workspace";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("task plan generation session store", () => {
	it("sends workBlockId when starting recurring occurrence generation", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ generationId: "generation-1" }), {
				status: 202,
				headers: { "Content-Type": "application/json" },
			}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await startTaskPlanGenerationSession({
			taskId: "task_1",
			workBlockId: "block_1",
			forceRefresh: true,
			idempotencyKey: "generation-session-1",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/work/task_1/commands",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					type: "plan.generate",
					forceRefresh: true,
					idempotencyKey: "generation-session-1",
					userInstruction: null,
					workBlockId: "block_1",
					selectedNodeId: null,
				}),
			}),
		);
	});

	it("sends workBlockId query when stopping recurring occurrence generation", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ stopped: true }), { status: 200 }),
			);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await stopTaskPlanGenerationSession("task_1", "block_1");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/tasks/task_1/plan/generations/stop?workBlockId=block_1",
			expect.objectContaining({ method: "POST" }),
		);
	});
});
