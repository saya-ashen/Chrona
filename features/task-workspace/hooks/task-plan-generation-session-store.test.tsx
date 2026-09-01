import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	apiJson: vi.fn(async () => ({ commandId: "command-1" })),
}));

vi.mock("@shared/http", () => ({ apiJson: mocks.apiJson }));

import {
	bindTaskPlanSessionToStateStore,
	startTaskPlanGenerationSession,
	stopTaskPlanGenerationSession,
	useTaskPlanGenerationSession,
} from "./task-plan-generation-session-store";

type SessionStateStore = Parameters<typeof bindTaskPlanSessionToStateStore>[2];

function createSessionStateStore(): SessionStateStore & {
	update: (updates: Record<string, unknown>) => void;
} {
	let snapshot: Record<string, unknown> = {};
	const listeners = new Set<() => void>();
	return {
		get: (path: string) => snapshot[path],
		getSnapshot: () => snapshot,
		set(path: string, value: unknown) {
			snapshot = { ...snapshot, [path]: value };
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		update(updates: Record<string, unknown>) {
			snapshot = { ...snapshot, ...updates };
			for (const listener of listeners) listener();
		},
	} as unknown as SessionStateStore & {
		update: (updates: Record<string, unknown>) => void;
	};
}

describe("task plan generation session store", () => {
	beforeEach(() => {
		mocks.apiJson.mockClear();
	});

	it("starts generation through workspace command and completes from workspace state", async () => {
		const taskId = "task-workspace-command";
		const store = createSessionStateStore();
		const unbind = bindTaskPlanSessionToStateStore(taskId, null, store);
		const { result, unmount } = renderHook(() =>
			useTaskPlanGenerationSession(taskId, { hydrate: false }),
		);

		await act(async () => {
			await startTaskPlanGenerationSession({
				taskId,
				forceRefresh: true,
				userInstruction: "Keep the plan concise",
				selectedNodeId: "node-1",
				idempotencyKey: "generation-1",
			});
		});

		expect(mocks.apiJson).toHaveBeenCalledWith(
			"/api/work/task-workspace-command/commands",
			{
				method: "POST",
				body: JSON.stringify({
					type: "plan.generate",
					forceRefresh: true,
					idempotencyKey: "generation-1",
					userInstruction: "Keep the plan concise",
					workBlockId: null,
					selectedNodeId: "node-1",
				}),
			},
		);
		expect(result.current.sessionStatus).toBe("running");

		act(() => {
			store.update({
				"/plan/status": "waiting_acceptance",
				"/plan/generation/status": "completed",
				"/plan/generation/phase": "done",
				"/plan/generation/is-running": false,
			});
		});

		expect(result.current.sessionStatus).toBe("completed");
		expect(result.current.isLoading).toBe(false);

		unmount();
		unbind();
	});

	it("clears the bound header generation action immediately when stopped", async () => {
		const taskId = "task-stop-generation";
		const store = createSessionStateStore();
		const unbind = bindTaskPlanSessionToStateStore(taskId, null, store);
		const { result, unmount } = renderHook(() =>
			useTaskPlanGenerationSession(taskId, { hydrate: false }),
		);
		act(() => {
			store.update({
				"/plan/status": "generating",
				"/plan/generation/status": "running",
				"/plan/generation/is-running": true,
				"/plan/generation/header-action-disabled": true,
			});
		});

		await act(async () => stopTaskPlanGenerationSession(taskId));

		expect(mocks.apiJson).toHaveBeenCalledWith(
			"/api/tasks/task-stop-generation/plan/generations/stop",
			{ method: "POST" },
		);
		expect(store.get("/plan/generation/is-running")).toBe(false);
		expect(store.get("/plan/generation/header-action-disabled")).toBe(false);
		expect(result.current.sessionStatus).toBe("cancelled");
		unmount();
		unbind();
	});
});
