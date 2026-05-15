import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
import { TaskWorkspaceExecutionOverview } from "./task-workspace-execution-overview";

describe("TaskWorkspaceExecutionOverview", () => {
  it("renders latest result, attention, artifacts, and activity from the workspace view", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);
    const onAction = vi.fn();

    render(
      <TaskWorkspaceExecutionOverview
        readiness={view.readiness}
        latestResult={view.latestResult}
        attention={view.attention}
        artifacts={view.artifacts}
        activity={view.activity}
        onAction={onAction}
      />,
    );

    expect(screen.getByLabelText("Execution overview")).toBeInTheDocument();
    expect(screen.getByText("Execution result overview")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(screen.getByText("Latest result")).toBeInTheDocument();
    expect(screen.getAllByText("Needs handling").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Approve result").length).toBeGreaterThan(0);
    expect(screen.getByText("Artifacts (0)")).toBeInTheDocument();
    expect(screen.getByText("Execution activity", { selector: "p" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resolve in node panel" }));
    expect(onAction).toHaveBeenCalledWith("approval");
  });

  it("renders artifact source links with artifact-backed overview data", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.artifactPresent);
    const onAction = vi.fn();

    render(
      <TaskWorkspaceExecutionOverview
        readiness={view.readiness}
        latestResult={view.latestResult}
        attention={view.attention}
        artifacts={view.artifacts}
        activity={view.activity}
        onAction={onAction}
      />,
    );

    expect(screen.getAllByText("No execution result yet.").length).toBeGreaterThan(0);
    expect(screen.getByText("done output 1", { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(onAction).toHaveBeenCalledWith("done");
  });

  it("renders empty and stale workspace overview states", () => {
    const emptyView = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);
    const staleView = createTaskWorkspaceExecutionConsoleView({
      ...taskWorkspaceStateFixtures.staleError,
      pageData: {
        ...taskWorkspaceStateFixtures.staleError.pageData,
        latestRunSummary: { id: "run-1", status: "Running", startedAt: null, syncStatus: "stale" },
      },
    });

    const { rerender } = render(
      <TaskWorkspaceExecutionOverview
        readiness={emptyView.readiness}
        latestResult={emptyView.latestResult}
        attention={emptyView.attention}
        artifacts={emptyView.artifacts}
        activity={emptyView.activity}
      />,
    );

    expect(screen.getAllByText("No execution result yet.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No approval, input, or blocker needs attention.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No artifacts yet.").length).toBeGreaterThan(0);
    expect(screen.getByText("Activity will appear after planning or execution starts.")).toBeInTheDocument();

    rerender(
      <TaskWorkspaceExecutionOverview
        readiness={staleView.readiness}
        latestResult={staleView.latestResult}
        attention={staleView.attention}
        artifacts={staleView.artifacts}
        activity={staleView.activity}
      />,
    );

    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Run is Running").length).toBeGreaterThan(0);
  });
});
