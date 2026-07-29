import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveWorkStateView } from "@chrona/domain";
import { TaskWorkspaceOperationPanel } from "./task-workspace-operation-panel";
import type { TaskWorkspaceOperationState } from "../model/task-workspace-operation-machine";

vi.mock("@features/task-workspace", () => ({
  SpecRenderer: () => null,
}));
vi.mock("@features/execution-monitoring", () => ({
  ProviderApprovalBanner: () => null,
}));

afterEach(() => cleanup());

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const operationStateBase = {
  status: "execution-failed",
  tone: "critical",
  title: "Execution failed",
  description: "Review the failure before retrying.",
  statusLabel: "Failed",
  runtimeEvents: [],
  action: null,
  currentOperation: null,
  selectedNode: null,
  currentNode: null,
};
const operationState = operationStateBase as unknown as TaskWorkspaceOperationState;

const commonProps = {
  taskId: "task-1",
  state: operationState,
  copy: {},
  onGeneratePlan: vi.fn(),
  onStartPlan: vi.fn(),
  revisionPanel: null,
  hasAcceptedPlan: false,
};

describe("TaskWorkspaceOperationPanel recovery", () => {
  it("keeps technical detail collapsed while explaining retained progress and retry risk", () => {
    renderWithQueryClient(
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
    const { rerender } = renderWithQueryClient(
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

  it("offers a new draft after a completed task instead of only rerunning the accepted plan", async () => {
    const onRegeneratePlan = vi.fn();
    renderWithQueryClient(
      <TaskWorkspaceOperationPanel
        {...commonProps}
        state={{
          ...operationStateBase,
          status: "execution-completed",
          tone: "success",
          title: "Execution completed",
        } as never}
        workState={deriveWorkStateView({
          taskStatus: "Completed",
          executionStatus: "Completed",
        })}
        hasAcceptedPlan
        onRestartPlan={vi.fn()}
        onRegeneratePlan={onRegeneratePlan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate a new plan" }));
    expect(screen.getByRole("dialog", { name: "Choose how to recover this task" })).toBeInTheDocument();
    const generateButtons = screen.getAllByRole("button", { name: /Generate a new plan/ });
    fireEvent.click(generateButtons[generateButtons.length - 1]!);
    await waitFor(() => expect(onRegeneratePlan).toHaveBeenCalledWith(undefined));
  });

  it("offers plan regeneration before the accepted plan has started", () => {
    renderWithQueryClient(
      <TaskWorkspaceOperationPanel
        {...commonProps}
        state={{
          ...operationStateBase,
          status: "plan-ready-to-run",
          tone: "neutral",
          title: "Plan ready",
          hasGraphExecutionStarted: false,
        } as never}
        workState={deriveWorkStateView({ taskStatus: "Planned" })}
        hasAcceptedPlan
        onRestartPlan={vi.fn()}
        onRegeneratePlan={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Generate a new plan" })).toBeInTheDocument();
  });
});
