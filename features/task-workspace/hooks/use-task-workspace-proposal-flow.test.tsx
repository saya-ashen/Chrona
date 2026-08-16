import type { PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts";
import type { EditableTask, TaskData } from "../model/task-workspace-types";

const apiJson = vi.fn().mockResolvedValue({});
vi.mock("@shared/http", () => ({
	apiJson: (...args: unknown[]) => apiJson(...args),
}));

import { useTaskWorkspaceProposalFlow } from "./use-task-workspace-proposal-flow";

const editableTask: EditableTask = {
	title: "Original task",
	description: "Original description",
	priority: "Medium",
	dueAt: null,
	scheduledStartAt: null,
	scheduledEndAt: null,
	scheduleStatus: "Unscheduled",
	executionRuntime: "hermes",
	executionConfig: {},
	aiClientId: null,
	autoPlanGeneration: false,
	autoExecute: false,
	recurrenceRule: null,
};

const proposal: TaskWorkspaceUpdateProposal = {
	summary: "Update task title and priority",
	confidence: "high",
	requiresConfirmation: true,
	taskPatch: { title: "Proposed task", priority: "High" },
};

function wrapper({ children }: PropsWithChildren) {
	const client = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function setup() {
	let task = { id: "task-1", ...editableTask } as unknown as TaskData;
	const setTask = vi.fn((value: React.SetStateAction<TaskData>) => {
		task = typeof value === "function" ? value(task) : value;
	});
	const setSaveError = vi.fn();
	const fetchPlan = vi.fn().mockResolvedValue(undefined);
	const refreshWorkspace = vi.fn().mockResolvedValue(undefined);
	const hook = renderHook(
		() =>
			useTaskWorkspaceProposalFlow({
				task,
				plan: null,
				planHeadStateVersion: null,
				draftEditableTask: editableTask,
				setTask,
				setSaveError,
				fetchPlan,
				refreshWorkspace,
			}),
		{ wrapper },
	);
	return {
		...hook,
		currentTask: () => task,
		setTask,
		setSaveError,
		fetchPlan,
		refreshWorkspace,
	};
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("useTaskWorkspaceProposalFlow", () => {
	it("[TASK-010] previews and applies only confirmed task fields", async () => {
		const hook = setup();

		act(() => hook.result.current.handleProposal(proposal));
		expect(hook.result.current.currentProposal).toMatchObject({
			proposal,
			originalTask: editableTask,
		});

		await act(async () => hook.result.current.handleApplyProposal(proposal));

		expect(apiJson).toHaveBeenCalledWith("/api/tasks/task-1", {
			method: "PATCH",
			body: JSON.stringify({ title: "Proposed task", priority: "High" }),
		});
		expect(hook.currentTask()).toMatchObject({
			title: "Proposed task",
			description: "Original description",
			priority: "High",
		});
		await waitFor(() => expect(hook.result.current.currentProposal).toBeNull());
		expect(hook.fetchPlan).toHaveBeenCalledOnce();
		expect(hook.refreshWorkspace).toHaveBeenCalledOnce();
	});

	it("[TASK-011] cancels a proposal without changing task state", () => {
		const hook = setup();

		act(() => hook.result.current.handleProposal(proposal));
		expect(hook.result.current.currentProposal).not.toBeNull();
		act(() => hook.result.current.handleCancelProposal());

		expect(hook.result.current.currentProposal).toBeNull();
		expect(hook.currentTask()).toMatchObject(editableTask);
		expect(apiJson).not.toHaveBeenCalled();
		expect(hook.setTask).not.toHaveBeenCalled();
	});
});
