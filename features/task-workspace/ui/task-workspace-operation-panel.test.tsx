import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveWorkStateView } from "@chrona/domain";
import { ExecutionFocusHeader } from "./task-workspace-execution-navigation";
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
const operationState =
  operationStateBase as unknown as TaskWorkspaceOperationState;

const commonProps = {
  taskId: "task-1",
  workBlockId: null,
  executionScope: null,
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
        workState={
          {
            ...deriveWorkStateView({
              taskStatus: "Failed",
              executionStatus: "Failed",
            }),
            blocker: {
              reason:
                "Provider timeout after an external write may have completed.",
              scope: "provider",
            },
          } as never
        }
      />,
    );

    expect(screen.getByText("Retained")).toBeInTheDocument();
    expect(screen.getByText("Retry from")).toBeInTheDocument();
    expect(screen.getByText("Before retrying")).toBeInTheDocument();
    expect(
      screen.getByText("Diagnostics").closest("details"),
    ).not.toHaveAttribute("open");
  });

  it.each([
    ["WaitingForInput", "Input needed"],
    ["WaitingForApproval", "Approval needed"],
    ["Blocked", "Blocked"],
    ["Failed", "Failed"],
    ["Cancelled", "Cancelled"],
  ])(
    "[RUN-011/CROSS-012] renders distinct %s recovery copy",
    (executionStatus, label) => {
      renderWithQueryClient(
        <TaskWorkspaceOperationPanel
          {...commonProps}
          workState={deriveWorkStateView({
            taskStatus: executionStatus,
            executionStatus,
          })}
        />,
      );

      expect(
        within(screen.getByTestId("current-operation-decision-card")).getByText(
          label,
        ),
      ).toBeInTheDocument();
    },
  );

  it.each([
    ["Completed", "Result ready"],
    ["Done", "Task done"],
  ])("[CROSS-012] renders distinct %s terminal copy", (taskStatus, label) => {
    render(
      <ExecutionFocusHeader
        view={
          {
            currentStep: null,
            progress: {
              total: 0,
              completed: 0,
              active: 0,
              waiting: 0,
              blocked: 0,
              remaining: 0,
            },
          } as never
        }
        workState={deriveWorkStateView({ taskStatus })}
        copy={{}}
      />,
    );

    expect(
      within(screen.getByTestId("execution-focus-header")).getByText(label),
    ).toBeInTheDocument();
  });

  it("offers a new draft after a completed task instead of only rerunning the accepted plan", async () => {
    const onRegeneratePlan = vi.fn();
    renderWithQueryClient(
      <TaskWorkspaceOperationPanel
        {...commonProps}
        state={
          {
            ...operationStateBase,
            status: "execution-completed",
            tone: "success",
            title: "Execution completed",
          } as never
        }
        workState={deriveWorkStateView({
          taskStatus: "Completed",
          executionStatus: "Completed",
        })}
        hasAcceptedPlan
        onRestartPlan={vi.fn()}
        onRegeneratePlan={onRegeneratePlan}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Generate a new plan" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Choose how to recover this task" }),
    ).toBeInTheDocument();
    const generateButtons = screen.getAllByRole("button", {
      name: /Generate a new plan/,
    });
    fireEvent.click(generateButtons[generateButtons.length - 1]!);
    await waitFor(() =>
      expect(onRegeneratePlan).toHaveBeenCalledWith(undefined),
    );
  });

  it("offers plan regeneration before the accepted plan has started", () => {
    renderWithQueryClient(
      <TaskWorkspaceOperationPanel
        {...commonProps}
        state={
          {
            ...operationStateBase,
            status: "plan-ready-to-run",
            tone: "neutral",
            title: "Plan ready",
            hasGraphExecutionStarted: false,
          } as never
        }
        workState={deriveWorkStateView({ taskStatus: "Planned" })}
        hasAcceptedPlan
        onRestartPlan={vi.fn()}
        onRegeneratePlan={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Generate a new plan" }),
    ).toBeInTheDocument();
  });
});
