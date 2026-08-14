import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeAll(() => {
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

vi.mock("@chrona/i18n/react", async () => {
	const { fallbackMessages } = await import("@chrona/i18n/messages");
	return {
		useI18n: () => ({ messages: fallbackMessages, t: (key: string) => key }),
		useLocale: () => "en",
	};
});

import { TaskPlanGenerationPanel } from "@features/task-workspace";
import type { TaskPlanReadModel } from "@chrona/contracts";

const defaultProps = {
	taskId: "task_1",
	title: "Review and update documentation",
	description: "Go through all docs and update them",
	priority: "High",
	dueAt: new Date(2026, 3, 20),
	estimatedMinutes: 120,
	onApply: vi.fn(),
	activeAcceptedPlanId: null,
};

const sampleCompiledPlan = {
	id: "compiled-plan-1",
	editablePlanId: "plan-1",
	sourceVersion: 2,
	title: "Test Plan",
	goal: "Test goal",
	assumptions: [],
	nodes: [
		{
			id: "node-1",
			localId: "node-1",
			type: "task" as const,
			title: "Review existing documentation",
			description: "Read through all current docs and note outdated sections",
			priority: "High" as const,
			config: { expectedOutput: "Review existing documentation" },
			dependencies: [] as string[],
			dependents: ["node-2"] as string[],
			executor: "ai" as const,
			mode: "auto" as const,
			estimatedMinutes: 40,
		},
		{
			id: "node-2",
			localId: "node-2",
			type: "task" as const,
			title: "Update API reference",
			description: "Refresh endpoint descriptions and examples",
			priority: "High" as const,
			config: { expectedOutput: "Update API reference" },
			dependencies: ["node-1"] as string[],
			dependents: ["node-3"] as string[],
			executor: "ai" as const,
			mode: "auto" as const,
			estimatedMinutes: 50,
		},
		{
			id: "node-3",
			localId: "node-3",
			type: "checkpoint" as const,
			title: "Update deployment guide",
			description: "Revise deployment steps for v2.1",
			priority: "Medium" as const,
			config: {
				checkpointType: "confirm",
				prompt: "Review deployment steps",
				required: true,
			},
			dependencies: ["node-2"] as string[],
			dependents: [] as string[],
			executor: "user" as const,
			mode: "manual" as const,
			estimatedMinutes: 30,
		},
	],
	edges: [
		{ id: "edge-1", from: "node-1", to: "node-2", label: "sequential" },
		{ id: "edge-2", from: "node-2", to: "node-3", label: "depends_on" },
	],
	entryNodeIds: ["node-1"] as string[],
	terminalNodeIds: ["node-3"] as string[],
	topologicalOrder: ["node-1", "node-2", "node-3"] as string[],
	completionPolicy: { type: "all_tasks_completed" as const },
	validationWarnings: [] as Array<{ path: string; message: string }>,
};

const sampleReadModel: TaskPlanReadModel = {
	id: "plan-1",
	status: "draft",
	revision: 2,
	prompt: null,
	summary: "3 planned nodes",
	updatedAt: "2026-04-20T09:05:00.000Z",
	generatedBy: "generate-task-plan",
	blueprint: {
		title: "Test Plan",
		goal: "Test goal",
		assumptions: [],
		nodes: [],
		edges: [],
	},
	compiledPlan: sampleCompiledPlan,
	effectivePlan: {
		graphId: "graph-1",
		basePlanId: "compiled-plan-1",
		resolvedAt: "2026-04-20T09:05:00.000Z",
		resolvedVersion: 1,
		nodes: [],
		edges: [],
		entryNodeIds: ["node-1"],
		terminalNodeIds: ["node-3"],
		readyNodeIds: [],
		blockedNodeIds: [],
		waitingNodeIds: [],
		waitingForUserNodeIds: [],
		waitingForApprovalNodeIds: [],
		degradedNodeIds: [],
		skippedNodeIds: [],
		cancelledNodeIds: [],
		completedNodeIds: [],
		runningNodeIds: [],
		invalidatedNodeIds: [],
		failedNodeIds: [],
		pendingNodeIds: ["node-1", "node-2", "node-3"],
	},
};

function createJsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterAll(() => {
	vi.unstubAllGlobals();
});

describe("TaskPlanGenerationPanel", () => {
	it("shows empty state and does not request a plan when autoRequest is disabled", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

		render(<TaskPlanGenerationPanel {...defaultProps} />);

		expect(screen.getByText(/No plan yet/i)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Generate plan/i }),
		).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalledWith(
			"/api/tasks/task_1/plan/generations",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("renders an incoming saved plan without requesting generation", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

		render(
			<TaskPlanGenerationPanel
				{...defaultProps}
				savedPlan={{
					...sampleReadModel,
					status: "draft",
				}}
			/>,
		);

		expect(screen.queryByText(/No plan yet/i)).not.toBeInTheDocument();
		expect(await screen.findByLabelText("Task plan graph")).toBeInTheDocument();
		expect(
			screen.getAllByText("Review existing documentation").length,
		).toBeGreaterThan(0);
		expect(screen.getByText("120 min")).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalledWith(
			"/api/tasks/task_1/plan/generations",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("shows generation state from the task while a backend job is active", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

		render(
			<TaskPlanGenerationPanel
				{...defaultProps}
				generationStatus="generating"
			/>,
		);

		expect(screen.getByText(/AI is planning task/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalledWith(
			"/api/tasks/task_1/plan/generations",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("starts the canonical generation session on click", async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

			if (url === "/api/work/task_1/commands") {
				return Promise.resolve(
					createJsonResponse({ commandId: "command-1" }, 202),
				);
			}

			throw new Error(`Unexpected request: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

		const user = userEvent.setup();
		render(<TaskPlanGenerationPanel {...defaultProps} />);

		await user.click(screen.getByRole("button", { name: /Generate plan/i }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/work/task_1/commands",
				expect.objectContaining({
					method: "POST",
					body: expect.stringMatching(/^\{.+\}$/),
				}),
			);
		});

		const generationCall = fetchMock.mock.calls.find(([input]) => {
			const url = typeof input === "string" ? input : input.toString();
			return url === "/api/work/task_1/commands";
		});
		expect(JSON.parse(String(generationCall?.[1]?.body))).toMatchObject({
			type: "plan.generate",
			forceRefresh: true,
			workBlockId: null,
			userInstruction: null,
			selectedNodeId: null,
			idempotencyKey: expect.any(String),
		});

		expect(await screen.findByText(/AI is planning task/i)).toBeInTheDocument();
	});

	it("stops an active generation job", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(createJsonResponse({ stopped: true }));
		vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
		const user = userEvent.setup();

		render(
			<TaskPlanGenerationPanel
				{...defaultProps}
				generationStatus="generating"
			/>,
		);

		await user.click(screen.getByRole("button", { name: /stop/i }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/tasks/task_1/plan/generations/stop",
				expect.objectContaining({ method: "POST" }),
			);
		});
	});
});
