import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { deriveWorkStateView } from "@chrona/domain";
import { TaskWorkspaceOperationPanel } from "./task-workspace-operation-panel";

vi.mock("@features/task-workspace/ui/catalog/spec-renderer", () => ({
  SpecRenderer: () => null,
}));
vi.mock("../../../../../../../features/execution-monitoring/ui/provider-approval-banner", () => ({
  ProviderApprovalBanner: () => null,
}));

const operationState = {
  status: "execution-failed",
  tone: "critical",
  title: "Execution failed",
  description: "Review the failure before retrying.",
  statusLabel: "Failed",
  runtimeEvents: [],
  action: null,
  currentOperation: null,
} as never;

const commonProps = {
  taskId: "task-1",
  state: operationState,
  copy: {},
  onGeneratePlan: vi.fn(),
  onStartPlan: vi.fn(),
  revisionPanel: null,
};

describe("TaskWorkspaceOperationPanel recovery", () => {
  it("keeps technical detail collapsed while explaining retained progress and retry risk", () => {
    render(
      <TaskWorkspaceOperationPanel
        {...commonProps}
        workState={{
          ...deriveWorkStateView({
            taskStatus: "Failed",
            executionStatus: "Failed",
          }),
          blocker: {
            reason: "Provider timeout after an external write may have completed.",
            scope: "provider",
          },
        } as never}
      />,
    );

    expect(screen.getByText("Retained")).toBeInTheDocument();
    expect(screen.getByText("Retry from")).toBeInTheDocument();
    expect(screen.getByText("Before retrying")).toBeInTheDocument();
    expect(screen.getByText("Diagnostics").closest("details")).not.toHaveAttribute("open");
  });

  it("distinguishes input from approval recovery", () => {
    const { rerender } = render(
      <TaskWorkspaceOperationPanel
        {...commonProps}
        workState={deriveWorkStateView({
          taskStatus: "InProgress",
          executionStatus: "WaitingForInput",
        })}
      />,
    );
    expect(screen.getByText("input")).toBeInTheDocument();

    rerender(
      <TaskWorkspaceOperationPanel
        {...commonProps}
        workState={deriveWorkStateView({
          taskStatus: "InProgress",
          executionStatus: "WaitingForApproval",
        })}
      />,
    );
    expect(screen.getByText("approval")).toBeInTheDocument();
  });
});
