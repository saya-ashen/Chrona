import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskWorkspaceInspector } from "./task-workspace-inspector";

vi.mock("./task-workspace-execution-overview", () => ({
  TaskWorkspaceExecutionOverview: () => <div data-testid="execution-results">Execution results</div>,
}));

afterEach(cleanup);

const consoleView = {
  progress: { completedSteps: 1, totalSteps: 2 },
  readiness: null,
  latestResult: null,
  attention: null,
  latestCompletedNode: null,
  graphPlan: { nodes: [] },
  artifacts: [],
  activity: [],
} as never;

const commonProps = {
  taskId: "task-1",
  consoleView,
  commandCenter: null,
  runtimeEvents: [],
  liveActivity: [],
  copy: {},
  onAction: vi.fn(),
};

describe("TaskWorkspaceInspector layout", () => {
  it("places result review after result content in result-first mode", () => {
    render(
      <TaskWorkspaceInspector
        {...commonProps}
        showHeader={false}
        operationPlacement="after"
        operationPanel={<div data-testid="result-review">Result review</div>}
      />,
    );

    expect(screen.queryByText("Task execution")).not.toBeInTheDocument();
    const results = screen.getByTestId("execution-results");
    const review = screen.getByTestId("result-review");
    expect(results.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps current operation before execution detail in workspace mode", () => {
    render(
      <TaskWorkspaceInspector
        {...commonProps}
        operationPanel={<div data-testid="current-operation">Current operation</div>}
      />,
    );

    expect(screen.getByText("Task execution")).toBeInTheDocument();
    const operation = screen.getByTestId("current-operation");
    const results = screen.getByTestId("execution-results");
    expect(operation.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("switches between checkpoint input and previous results", async () => {
    const { user } = await import("@testing-library/user-event").then(({ default: userEvent }) => ({ user: userEvent.setup() }));
    render(
      <TaskWorkspaceInspector
        {...commonProps}
        currentExecution={{ status: "waiting_for_user", checkpoint: { id: "checkpoint-1" } } as never}
        operationPanel={<div data-testid="checkpoint-form">Checkpoint form</div>}
        commandCenterCopy={{ outputTab: "Results" }}
      />,
    );

    expect(screen.getByTestId("checkpoint-form")).toBeVisible();
    expect(screen.queryByTestId("execution-results")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Results" }));
    expect(screen.getByTestId("execution-results")).toBeVisible();
    expect(screen.queryByTestId("checkpoint-form")).not.toBeInTheDocument();
  });
});
