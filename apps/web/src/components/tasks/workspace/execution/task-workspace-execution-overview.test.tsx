import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
import { TaskWorkspaceExecutionOverview } from "./task-workspace-execution-overview";

describe("TaskWorkspaceExecutionOverview", () => {
  afterEach(() => {
    cleanup();
  });

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

    expect(screen.getAllByLabelText("Execution overview").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Needs handling").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Approve result").length).toBeGreaterThan(0);
    expect(screen.queryByText("Current operation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "结果" }));
    expect(screen.getByText("Latest result")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("tab", { name: "产物" })[0]);
    expect(screen.getByText("Artifacts (0)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "活动" }));
    expect(screen.getByText("Execution activity", { selector: "p" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "操作" }));

    fireEvent.click(screen.getByRole("button", { name: "Resolve in node panel" }));
    expect(onAction).toHaveBeenCalledWith("approval");
  });

  it("renders live provider runtime events in the activity tab", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);

    render(
      <TaskWorkspaceExecutionOverview
        readiness={view.readiness}
        latestResult={view.latestResult}
        attention={view.attention}
        artifacts={view.artifacts}
        activity={view.activity}
        runtimeEvents={[{
          type: "runtime_event",
          action: "start_manual",
          nodeId: "execute",
          nodeTitle: "execute",
          runtimeName: "openclaw",
          provider: "openclaw",
          runId: "run-1",
          sequence: 1,
          timestamp: "2026-05-12T10:01:00.000Z",
          event: { type: "tool_started", toolName: "chrona_plan_read", label: "正在读取计划" },
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "活动" }));
    expect(screen.getByText("Tool started")).toBeInTheDocument();
    expect(screen.getByText("正在读取计划")).toBeInTheDocument();
  });

  it("renders full latest result and expandable artifact content", () => {
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

    fireEvent.click(screen.getByRole("tab", { name: "结果" }));
    expect(screen.getByText("summary")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View full result ->" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Locate result node" }));
    expect(onAction).toHaveBeenCalledWith("done");

    fireEvent.click(screen.getAllByRole("tab", { name: "产物" })[0]);
    expect(screen.getByText("done output 1", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("summary")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Locate source node" }));
    expect(onAction).toHaveBeenCalledWith("done");
  });

  it("renders a command center primary action", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);
    const onClick = vi.fn();

    render(
      <TaskWorkspaceExecutionOverview
        readiness={view.readiness}
        latestResult={view.latestResult}
        attention={view.attention}
        artifacts={view.artifacts}
        activity={view.activity}
        primaryAction={{
          label: "Generate plan",
          description: "Create an execution plan before starting task work.",
          statusLabel: "idle",
          tone: "info",
          onClick,
        }}
      />,
    );

    expect(screen.getByText("Current operation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(onClick).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getAllByRole("tab", { name: "产物" })[0]);
    expect(screen.getAllByText("No artifacts yet.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "活动" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "操作" }));
    expect(screen.getAllByText("Run is Running").length).toBeGreaterThan(0);
  });

  it("exposes blocked status, retry progress, and accessible action names", () => {
    const view = createTaskWorkspaceExecutionConsoleView({
      ...taskWorkspaceStateFixtures.staleError,
      pageData: {
        ...taskWorkspaceStateFixtures.staleError.pageData,
        task: {
          ...taskWorkspaceStateFixtures.staleError.pageData.task,
          isRunnable: true,
        },
      },
    });
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

    expect(screen.getAllByLabelText("Execution overview").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/blocked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Retry refresh").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open action controls").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Open action controls" }));
    expect(onAction).toHaveBeenCalledWith("blocked");
  });
});
