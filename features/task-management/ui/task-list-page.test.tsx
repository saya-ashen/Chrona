import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MemoryRouter,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { fallbackMessages as en } from "@chrona/i18n/messages";

import { TaskListPage, canCompleteTask } from "./task-list-page";
const copy = en as never;

afterEach(cleanup);

function task(
	id: string,
	title: string,
	state: "result_ready" | "done",
	executedAt: string,
) {
	return {
		id,
		workspaceId: "workspace-1",
		title,
		description: null,
		status: state === "done" ? "Done" : "Completed",
		priority: "Medium",
		kind: "task",
		recurrenceRule: "FREQ=DAILY",
		dueAt: null,
		updatedAt: executedAt,
		autoPlanGeneration: true,
		autoExecute: true,
		projection: null,
		result: {
			runId: `run-${id}`,
			runStatus: "Completed",
			provider: "debug",
			occurrenceId: `occurrence-${id}`,
			executedAt,
			artifact: {
				id: `artifact-${id}`,
				title: `${title} report`,
				type: "markdown",
				uri: `file://${id}.md`,
				runId: `run-${id}`,
				createdAt: executedAt,
			},
		},
		stateView: { state, label: state === "done" ? "Done" : "Result ready" },
		source: null,
	} as never;
}

function LocationProbe() {
	const location = useLocation();
	return (
		<output data-testid="location">
			{location.pathname}
			{location.search}
		</output>
	);
}

function ResultDetail() {
	const navigate = useNavigate();
	return (
		<button type="button" onClick={() => navigate(-1)}>
			Back to results
		</button>
	);
}

function renderResults(initialEntry = "/en/tasks?view=results") {
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<LocationProbe />
			<Routes>
				<Route
					path="/en/tasks"
					element={
						<TaskListPage
							tasks={[
								task("older", "Weekly report", "done", "2026-06-24T10:00:00.000Z"),
								task("newer", "Daily report", "result_ready", new Date().toISOString()),
							]}
							workspaceId="workspace-1"
							copy={copy}
							total={2}
							page={1}
							pageSize={20}
							pageCount={1}
							counts={{
								all: 2,
								needsMe: 1,
								ready: 0,
								running: 0,
								completed: 2,
								failed: 0,
							}}
						/>
					}
				/>
				<Route path="/en/tasks/:taskId" element={<ResultDetail />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("canCompleteTask", () => {
	it("only enables marking tasks complete when a completed run exists", () => {
		const task = {
			id: "task-1",
			workspaceId: "workspace-1",
			title: "Task",
			description: null,
			status: "Active",
			priority: "Medium",
			kind: "task",
			recurrenceRule: null,
			dueAt: null,
			updatedAt: "2026-08-06T00:00:00.000Z",
			autoPlanGeneration: false,
			autoExecute: false,
			stateView: { state: "ready", label: "Ready" },
			source: null,
			projection: { runStatus: null, isRunnable: false },
			result: null,
		} as unknown as Parameters<typeof canCompleteTask>[0];

		expect(canCompleteTask(task)).toBe(false);
		expect(
			canCompleteTask({
				...task,
				projection: { runStatus: "Completed", isRunnable: false },
			}),
		).toBe(true);
		expect(
			canCompleteTask({
				...task,
				result: {
					runId: "run-1",
					runStatus: "completed",
					provider: null,
					occurrenceId: null,
					executedAt: null,
					artifact: null,
				},
			}),
		).toBe(true);
	});
});

describe("TaskListPage results filters", () => {
	it("filters historical results by acceptance status", async () => {
		const user = userEvent.setup();
		renderResults();

		const resultFilters = screen.getByRole("group", { name: "Result filters" });
		expect(within(resultFilters).getAllByRole("combobox")).toHaveLength(2);
		expect(
			within(resultFilters).getByRole("combobox", { name: "Result date" }),
		).toBeInTheDocument();
		expect(
			within(resultFilters).getByRole("combobox", { name: "Result status" }),
		).toBeInTheDocument();

		expect(screen.getByText("Weekly report report")).toBeInTheDocument();
		expect(screen.getByText("Daily report report")).toBeInTheDocument();

		await user.click(screen.getByRole("combobox", { name: "Result status" }));
		await user.click(screen.getByRole("option", { name: "Awaiting acceptance" }));
		expect(screen.queryByText("Weekly report report")).not.toBeInTheDocument();
		expect(screen.getByText("Daily report report")).toBeInTheDocument();

		await user.click(screen.getByRole("combobox", { name: "Result status" }));
		await user.click(screen.getByRole("option", { name: "Accepted result" }));
		expect(screen.getByText("Weekly report report")).toBeInTheDocument();
		expect(screen.queryByText("Daily report report")).not.toBeInTheDocument();
	});

	it("[RESULT-014] preserves result filters and page context after returning", async () => {
		const user = userEvent.setup();
		const resultContext =
			"/en/tasks?view=results&resultStatus=needs-review&page=2&pageSize=1";
		renderResults(resultContext);

		expect(screen.getByText("Daily report report")).toBeInTheDocument();
		expect(screen.queryByText("Weekly report report")).not.toBeInTheDocument();
		await user.click(screen.getByRole("link", { name: "Open result" }));
		expect(screen.getByTestId("location")).toHaveTextContent("/en/tasks/newer");
		await user.click(screen.getByRole("button", { name: "Back to results" }));

		expect(screen.getByTestId("location")).toHaveTextContent(resultContext);
		expect(
			screen.getByRole("combobox", { name: "Result status" }),
		).toHaveTextContent("Awaiting acceptance");
		expect(screen.getByText("Daily report report")).toBeInTheDocument();
	});

	it("filters historical results by execution date", async () => {
		const user = userEvent.setup();
		renderResults();

		await user.click(screen.getByRole("combobox", { name: "Result date" }));
		await user.click(screen.getByRole("option", { name: "Last 7 days" }));

		expect(screen.queryByText("Weekly report report")).not.toBeInTheDocument();
		expect(screen.getByText("Daily report report")).toBeInTheDocument();
	});
});
