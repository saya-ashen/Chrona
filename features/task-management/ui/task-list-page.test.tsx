import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import en from "@chrona/i18n/messages/en.json";

import { TaskListPage, canCompleteTask } from "./task-list-page";
const copy = en as never;

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

function renderResults() {
  render(
    <MemoryRouter initialEntries={["/en/tasks?view=results"]}>
      <TaskListPage
        tasks={[
          task("older", "Weekly report", "done", "2026-06-24T10:00:00.000Z"),
          task(
            "newer",
            "Daily report",
            "result_ready",
            new Date().toISOString(),
          ),
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
    expect(canCompleteTask({
      ...task,
      projection: { runStatus: "Completed", isRunnable: false },
    })).toBe(true);
    expect(canCompleteTask({
      ...task,
      result: {
        runId: "run-1",
        runStatus: "completed",
        provider: null,
        occurrenceId: null,
        executedAt: null,
        artifact: null,
      },
    })).toBe(true);
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
    await user.click(
      screen.getByRole("option", { name: "Awaiting acceptance" }),
    );
    expect(screen.queryByText("Weekly report report")).not.toBeInTheDocument();
    expect(screen.getByText("Daily report report")).toBeInTheDocument();
  });
});
