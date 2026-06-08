import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
import { taskWorkspaceStateFixtures } from "../test-support/task-workspace-test-fixtures";
import { TaskWorkspaceExecutionOverview } from "./task-workspace-execution-overview";

function renderOverview(
  view: ReturnType<typeof createTaskWorkspaceExecutionConsoleView>,
  extra: Partial<React.ComponentProps<typeof TaskWorkspaceExecutionOverview>> = {},
) {
  return render(
    <TaskWorkspaceExecutionOverview
      progress={view.progress}
      readiness={view.readiness}
      latestResult={view.latestResult}
      attention={view.attention}
      latestCompletedNode={view.latestCompletedNode}
      artifacts={view.artifacts}
      activity={view.activity}
      {...extra}
    />,
  );
}

describe("TaskWorkspaceExecutionOverview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the now, output, and trail tabs", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);
    const onAction = vi.fn();

    renderOverview(view, { onAction });

    expect(screen.getAllByLabelText("Execution overview").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Now" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Output" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trail" })).toBeInTheDocument();
    // Now tab shows the current operation status card from attention/readiness.
    expect(screen.getByText("Current operation")).toBeInTheDocument();
  });

  it("renders live runtime events in the now tab", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);

    renderOverview(view, {
      runtimeEvents: [{
        type: "runtime_event",
        action: "start_manual",
        nodeId: "execute",
        nodeTitle: "execute",
        runtimeName: "hermes",
        provider: "hermes",
        runId: "run-1",
        sequence: 1,
        timestamp: "2026-05-12T10:01:00.000Z",
        event: { type: "tool_started", toolName: "chrona_plan_read", label: "正在读取计划" },
      }, {
        type: "runtime_event",
        action: "start_manual",
        nodeId: "execute",
        nodeTitle: "execute",
        runtimeName: "hermes",
        provider: "hermes",
        runId: "run-1",
        sequence: 2,
        timestamp: "2026-05-12T10:01:01.000Z",
        event: { type: "assistant_text_delta", text: "Runtime " },
      }, {
        type: "runtime_event",
        action: "start_manual",
        nodeId: "execute",
        nodeTitle: "execute",
        runtimeName: "hermes",
        provider: "hermes",
        runId: "run-1",
        sequence: 3,
        timestamp: "2026-05-12T10:01:01.500Z",
        event: { type: "assistant_text_delta", text: "answer" },
      }, {
        type: "runtime_event",
        action: "start_manual",
        nodeId: "execute",
        nodeTitle: "execute",
        runtimeName: "hermes",
        provider: "hermes",
        runId: "run-1",
        sequence: 4,
        timestamp: "2026-05-12T10:01:02.000Z",
        event: { type: "reasoning_delta", text: "Runtime reasoning" },
      }],
    });

    // Live event content surfaces directly in the Now tab. Raw (unmerged)
    // events are rendered individually with a kind label prefix.
    expect(screen.getByText("Tool: 正在读取计划")).toBeInTheDocument();
    expect(screen.getByText("Assistant: Runtime")).toBeInTheDocument();
    expect(screen.getByText("Assistant: answer")).toBeInTheDocument();
    expect(screen.getByText("Reasoning: Runtime reasoning")).toBeInTheDocument();
  });

  it("renders the latest completed node result and artifacts in the output tab", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.artifactPresent);
    const onAction = vi.fn();

    renderOverview(view, { onAction });

    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    expect(screen.getByText("summary")).toBeInTheDocument();
    expect(screen.queryByText(/runtimeRunRef/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Locate source node" }));
    expect(onAction).toHaveBeenCalledWith("done");
    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByText("file://report.md")).toBeInTheDocument();
  });

  it("renders a command center primary action in the now tab", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);
    const onClick = vi.fn();

    renderOverview(view, {
      primaryAction: {
        kind: "generate",
        label: "Generate plan",
        description: "Create an execution plan before starting task work.",
        statusLabel: "idle",
        tone: "info",
        onClick,
      },
    });

    expect(screen.getByText("Current operation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders an empty output state when no node has completed", () => {
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.empty);

    renderOverview(view);

    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    expect(screen.getByText("No execution result yet.")).toBeInTheDocument();
  });

  it("auto-switches to the now tab when attention first appears", () => {
    const calm = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.running);
    const attentive = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);

    const { rerender } = render(
      <TaskWorkspaceExecutionOverview
        progress={calm.progress}
        readiness={calm.readiness}
        latestResult={calm.latestResult}
        attention={null}
        latestCompletedNode={calm.latestCompletedNode}
        artifacts={calm.artifacts}
        activity={calm.activity}
      />,
    );

    // User moves to the Trail tab while nothing needs attention.
    fireEvent.click(screen.getByRole("tab", { name: "Trail" }));
    expect(screen.getByRole("tab", { name: "Trail" })).toHaveAttribute("aria-selected", "true");

    // Attention appears: the console pulls focus back to Now exactly once.
    rerender(
      <TaskWorkspaceExecutionOverview
        progress={attentive.progress}
        readiness={attentive.readiness}
        latestResult={attentive.latestResult}
        attention={attentive.attention}
        latestCompletedNode={attentive.latestCompletedNode}
        artifacts={attentive.artifacts}
        activity={attentive.activity}
      />,
    );
    expect(screen.getByRole("tab", { name: "Now" })).toHaveAttribute("aria-selected", "true");
  });

  it("lets the user leave the now tab while attention persists", () => {
    // Regression: a blocked/attention state must not trap the user on Now.
    const view = createTaskWorkspaceExecutionConsoleView(taskWorkspaceStateFixtures.approvalNeeded);

    renderOverview(view);

    expect(screen.getByRole("tab", { name: "Now" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Trail" }));
    expect(screen.getByRole("tab", { name: "Trail" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    expect(screen.getByRole("tab", { name: "Output" })).toHaveAttribute("aria-selected", "true");
  });
});
