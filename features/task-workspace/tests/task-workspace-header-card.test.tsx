import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStateStore } from "@json-render/core";
import { MemoryRouter } from "react-router-dom";
import { createHeaderSpecFixture } from "@features/task-workspace/test";
import { TaskWorkspaceHeaderCard } from "../ui/task-workspace-header-card";
import type { TaskData } from "./task-workspace-model";
type ChildrenProps = { children?: React.ReactNode };

vi.mock("@/components/ui/button", () => ({
	Button: ({
		children,
		...props
	}: ChildrenProps & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));
vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children }: ChildrenProps) => <div>{children}</div>,
	DialogContent: ({ children }: ChildrenProps) => <div>{children}</div>,
	DialogDescription: ({ children }: ChildrenProps) => <p>{children}</p>,
	DialogFooter: ({ children }: ChildrenProps) => <div>{children}</div>,
	DialogHeader: ({ children }: ChildrenProps) => <div>{children}</div>,
	DialogTitle: ({ children }: ChildrenProps) => <h2>{children}</h2>,
}));

const task = {
	id: "task-1",
	workspaceId: "ws-1",
	title: "Scheduled draft task",
	description: null,
	executionRuntime: "hermes",
	executionConfig: {},
	autoPlanGeneration: false,
	autoExecute: false,
	autoPlanGenerationTiming: "at_start",
	autoExecuteTiming: "at_start",
	status: "Draft",
	priority: "Medium",
	dueAt: null,
	scheduledStartAt: "2026-05-27T04:30:00.000Z",
	scheduledEndAt: "2026-05-27T05:30:00.000Z",
	scheduleStatus: "Scheduled",
	scheduleSource: "human",
	isRunnable: true,
	runnabilitySummary: "Ready to run",
	runnabilityState: "ready_to_run",
	savedPlan: null,
	executionSummary: null,
	graphNodeStates: [],
	aiPlanGenerationStatus: "accepted",
	blockReason: null,
	dependencies: [],
} satisfies TaskData;
function renderHeader(
	spec = createHeaderSpecFixture({
		title: task.title,
		priority: "Medium",
		progressLabel: "1 steps · 0 accepted · 0%",
		occurrenceLabel: "Occurrence · Wed, May 27 04:30 AM-05:30 AM",
		actions: [
			{ id: "edit", label: "Edit" },
			{ id: "delete", label: "Delete Task" },
		],
	}),
	state: Record<string, unknown> = {},
	onAction = vi.fn(),
	onStopPlanGeneration = vi.fn(),
	rebuild: {
		open?: boolean;
		pending?: boolean;
		onConfirm?: () => void;
		onCancel?: () => void;
	} = {},
	deletion: { open?: boolean; pending?: boolean; onConfirm?: () => void } = {},
) {
	const store = createStateStore(spec.state ?? {});
	store.update(state);
	return render(
		<MemoryRouter initialEntries={["/en/tasks/task-1"]}>
			<TaskWorkspaceHeaderCard
				task={task}
				spec={spec}
				store={store}
				onAction={onAction}
				onAcceptPlan={vi.fn()}
				onGeneratePlan={vi.fn()}
				onStopPlanGeneration={onStopPlanGeneration}
				onRestartPlan={vi.fn()}
				onEdit={vi.fn()}
				showRebuildConfirm={rebuild.open ?? false}
				isRebuilding={rebuild.pending ?? false}
				onStartRebuildConfirm={vi.fn()}
				onCancelRebuildConfirm={rebuild.onCancel ?? vi.fn()}
				onRebuild={rebuild.onConfirm ?? vi.fn()}
				showDeleteConfirm={deletion.open ?? false}
				deleteImpact={
					deletion.open
						? {
								taskIds: ["task-1"],
								taskCount: 1,
								assets: [
									{ id: "asset-1", label: "导师申请清单", goalId: "goal-1" },
								],
							}
						: null
				}
				isLoadingDeleteImpact={false}
				deleteImpactError={null}
				isDeleting={deletion.pending ?? false}
				onStartDeleteConfirm={vi.fn()}
				onCancelDeleteConfirm={vi.fn()}
				onDelete={deletion.onConfirm ?? vi.fn()}
				onRecoveryRetry={vi.fn()}
				onRecoveryEditInstruction={vi.fn()}
				onRecoveryCancel={vi.fn()}
			/>
		</MemoryRouter>,
	);
}

describe("TaskWorkspaceHeaderCard", () => {
	afterEach(() => cleanup());

	it("renders server-provided status without stale persisted task state", () => {
		renderHeader();

		expect(screen.getByText("Waiting")).toBeInTheDocument();
		expect(screen.queryByText("Draft")).not.toBeInTheDocument();
	});
	it("renders one server-provided execution status", () => {
		renderHeader(
			createHeaderSpecFixture({
				title: task.title,
				status: "running",
				priority: "Medium",
				progressLabel: "1 steps · 0 accepted · 0%",
				actions: [
					{ id: "pause", label: "Pause" },
					{ id: "stop", label: "Stop" },
				],
			}),
		);

		expect(screen.getByText("Running")).toBeInTheDocument();
		expect(screen.queryByText("Running now")).not.toBeInTheDocument();
	});

	it("renders server-provided occurrence label", () => {
		renderHeader();

		expect(screen.getByText(/Occurrence ·/)).toBeInTheDocument();
		expect(screen.getByText(/May 27/)).toBeInTheDocument();
	});

	it("shows Accept plan while header state marks generated plan unaccepted", () => {
		renderHeader(undefined, {
			"/execution/show-accept-plan": true,
			"/execution/show-generate-plan": false,
			"/execution/can-start": false,
			"/execution/can-pause": false,
			"/execution/can-stop": false,
		});

		expect(
			screen.getByRole("button", { name: "Accept plan" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Start" }),
		).not.toBeInTheDocument();
	});

	it("shows Stop generation in header actions while plan generation runs", async () => {
		const onStopPlanGeneration = vi.fn().mockResolvedValue(undefined);
		renderHeader(
			undefined,
			{
				"/execution/show-accept-plan": false,
				"/execution/show-generate-plan": true,
				"/execution/can-start": false,
				"/execution/can-pause": false,
				"/execution/can-stop": false,
				"/plan/generation/is-running": true,
				"/plan/generation/header-action-disabled": true,
				"/plan/generation/stop-disabled": false,
			},
			vi.fn(),
			onStopPlanGeneration,
		);

		expect(
			screen.getByRole("button", { name: "Generate plan" }),
		).toBeDisabled();
		const stop = screen.getByRole("button", { name: "Stop generation" });
		expect(stop).toBeEnabled();
		fireEvent.click(stop);

		await waitFor(() => expect(onStopPlanGeneration).toHaveBeenCalledTimes(1));
	});

	it("switches from Accept plan to enabled Start after accepted-plan state", () => {
		renderHeader(undefined, {
			"/execution/show-accept-plan": false,
			"/execution/show-generate-plan": false,
			"/execution/can-start": true,
			"/execution/start-disabled": false,
			"/execution/start-disabled-reason": null,
			"/execution/can-pause": false,
			"/execution/can-stop": false,
			"/execution/status": "started",
		});

		const start = screen.getByRole("button", { name: "Start" });
		expect(start).toBeInTheDocument();
		expect(start).toBeEnabled();
		expect(
			screen.queryByRole("button", { name: "Accept plan" }),
		).not.toBeInTheDocument();
	});

	it("hides Start and shows running controls after post-start state", () => {
		renderHeader(undefined, {
			"/execution/show-accept-plan": false,
			"/execution/show-generate-plan": false,
			"/execution/can-start": false,
			"/execution/can-pause": true,
			"/execution/can-stop": true,
			"/execution/status": "running",
		});

		expect(
			screen.queryByRole("button", { name: "Start" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
	});

	it("requires destructive confirmation before rebuilding the Task", () => {
		const onConfirm = vi.fn();
		renderHeader(undefined, {}, vi.fn(), vi.fn(), { open: true, onConfirm });

		expect(
			screen.getByRole("heading", {
				name: "Rebuild task with latest Goal assets?",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/current Task, plan, execution history, artifacts, results, and child Tasks/i,
			),
		).toBeInTheDocument();
		const confirm = screen.getByRole("button", { name: "Rebuild Task" });
		fireEvent.click(confirm);
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("[GOAL-029] cancels rebuilding a Task with latest Goal assets", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		renderHeader(undefined, {}, vi.fn(), vi.fn(), {
			open: true,
			onConfirm,
			onCancel,
		});

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onCancel).toHaveBeenCalledOnce();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("requires a second confirmation and lists corresponding Goal assets", () => {
		const onConfirm = vi.fn();
		renderHeader(
			undefined,
			{},
			vi.fn(),
			vi.fn(),
			{},
			{ open: true, onConfirm },
		);

		expect(screen.queryByText("导师申请清单")).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "Review what will be deleted" }),
		);

		expect(
			screen.getByText(
				"This will delete 1 task(s) and 1 corresponding Goal asset(s).",
			),
		).toBeInTheDocument();
		expect(
			screen.getByRole("list", { name: "Goal assets that will be deleted" }),
		).toHaveTextContent("导师申请清单");
		expect(onConfirm).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Permanently delete" }));
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("announces sent action without adding visible header height", async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		renderHeader(
			createHeaderSpecFixture({
				title: task.title,
				status: "waiting",
				priority: "Medium",
				progressLabel: "1 steps · 0 accepted · 0%",
				actions: [{ id: "start", label: "Start" }],
			}),
			{
				"/execution/show-accept-plan": false,
				"/execution/show-generate-plan": false,
				"/execution/can-start": true,
				"/execution/start-disabled": false,
			},
			onAction,
		);

		fireEvent.click(screen.getByRole("button", { name: "Start" }));

		const status = await screen.findByRole("status");
		await waitFor(() =>
			expect(status).toHaveTextContent("Start request sent."),
		);
		expect(status).toHaveClass("sr-only");
	});
});
