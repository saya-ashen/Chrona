import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const mockUseSmartDecomposition = vi.fn();
const mockUseSmartAutomation = vi.fn();

vi.mock("@/hooks/use-ai", () => ({
  useSmartDecomposition: (...args: unknown[]) => mockUseSmartDecomposition(...args),
  useSmartAutomation: (...args: unknown[]) => mockUseSmartAutomation(...args),
}));

import { TaskDecompositionPanel } from "@/components/schedule/task-decomposition-panel";
import type { TaskPlanGraphResponse } from "@/modules/ai/types";

const defaultProps = {
  taskId: "task_1",
  title: "Review and update documentation",
  description: "Go through all docs and update them",
  priority: "High",
  dueAt: new Date(2026, 3, 20),
  estimatedMinutes: 120,
  onApply: vi.fn(),
};

const samplePlanResponse: TaskPlanGraphResponse = {
  source: "saved",
  planGraph: {
    id: "plan-1",
    taskId: "task_1",
    status: "draft",
    revision: 2,
    source: "ai",
    generatedBy: "decompose-task",
    prompt: null,
    summary: "3 planned nodes",
    changeSummary: null,
    createdAt: "2026-04-20T09:00:00.000Z",
    updatedAt: "2026-04-20T09:05:00.000Z",
    nodes: [
      {
        id: "node-1",
        type: "step",
        title: "Review existing documentation",
        objective: "Read through all current docs and note outdated sections",
        description: "Read through all current docs and note outdated sections",
        status: "in_progress",
        phase: "execution",
        estimatedMinutes: 40,
        priority: "High",
        executionMode: "child_task",
        linkedTaskId: null,
        needsUserInput: false,
        metadata: {
          feasibilityScore: 80,
          warnings: [],
        },
      },
      {
        id: "node-2",
        type: "deliverable",
        title: "Update API reference",
        objective: "Refresh endpoint descriptions and examples",
        description: "Refresh endpoint descriptions and examples",
        status: "pending",
        phase: "delivery",
        estimatedMinutes: 50,
        priority: "High",
        executionMode: "child_task",
        linkedTaskId: null,
        needsUserInput: false,
        metadata: null,
      },
      {
        id: "node-3",
        type: "checkpoint",
        title: "Update deployment guide",
        objective: "Revise deployment steps for v2.1",
        description: "Revise deployment steps for v2.1",
        status: "pending",
        phase: "review",
        estimatedMinutes: 30,
        priority: "Medium",
        executionMode: "none",
        linkedTaskId: null,
        needsUserInput: false,
        metadata: null,
      },
    ],
    edges: [
      { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "sequential", metadata: null },
      { id: "edge-2", fromNodeId: "node-2", toNodeId: "node-3", type: "depends_on", metadata: null },
    ],
  },
  savedPlan: {
    id: "plan-1",
    status: "draft",
    prompt: null,
    revision: 2,
    summary: "3 planned nodes",
    updatedAt: "2026-04-20T09:05:00.000Z",
  },
};

beforeEach(() => {
  mockUseSmartAutomation.mockReturnValue({
    suggestion: {
      executionMode: "manual",
      reminderStrategy: {
        advanceMinutes: 30,
        frequency: "once",
        channels: ["push"],
      },
      preparationSteps: ["Review task description"],
      contextSources: [],
      confidence: "medium",
    },
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDecompositionPanel – opt-in behavior", () => {
  it("shows trigger button when not requested (default)", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    expect(screen.getByText("AI 任务规划")).toBeInTheDocument();
    expect(mockUseSmartDecomposition).toHaveBeenCalledWith(null);
  });

  it("requests decomposition after clicking trigger button", async () => {
    const user = userEvent.setup();
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    await user.click(screen.getByText("AI 任务规划"));

    expect(mockUseSmartDecomposition).toHaveBeenCalledWith({
      taskId: "task_1",
      title: "Review and update documentation",
      description: "Go through all docs and update them",
      priority: "High",
      dueAt: new Date(2026, 3, 20),
      estimatedMinutes: 120,
    });
  });
});

describe("TaskDecompositionPanel – autoRequest mode", () => {
  it("immediately requests decomposition with autoRequest=true", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.queryByText("AI 任务规划")).not.toBeInTheDocument();
    expect(mockUseSmartDecomposition).toHaveBeenCalledWith({
      taskId: "task_1",
      title: "Review and update documentation",
      description: "Go through all docs and update them",
      priority: "High",
      dueAt: new Date(2026, 3, 20),
      estimatedMinutes: 120,
    });
  });

  it("shows loading skeleton when isLoading is true", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("AI 正在规划任务...")).toBeInTheDocument();
  });

  it("shows error state when error is set", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: "Network timeout",
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("Failed to plan task: Network timeout")).toBeInTheDocument();
  });

  it("renders graph-only planning UI when result is available", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("AI Task Plan")).toBeInTheDocument();
    expect(screen.getByText("80% feasible")).toBeInTheDocument();
    expect(screen.getByLabelText("任务计划图")).toBeInTheDocument();
    expect(screen.getAllByText("Review existing documentation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Update API reference").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Update deployment guide").length).toBeGreaterThan(0);
    expect(screen.getByText("Total: 120 min")).toBeInTheDocument();
    expect(screen.getByText("3 planned nodes")).toBeInTheDocument();
    expect(screen.getByText("manual execution")).toBeInTheDocument();
    expect(screen.queryByText("Review task description")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply plan/i })).toBeInTheDocument();
  });

  it("Apply button calls onApply with the graph response", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest onApply={onApply} />);

    await user.click(screen.getByRole("button", { name: /apply plan/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(samplePlanResponse);
  });

  it("renders warnings when present", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: {
        ...samplePlanResponse,
        planGraph: {
          ...samplePlanResponse.planGraph,
          nodes: [
            {
              ...samplePlanResponse.planGraph.nodes[0]!,
              metadata: {
                feasibilityScore: 80,
                warnings: ["Due date is soon", "Requires stakeholder review"],
              },
            },
            ...samplePlanResponse.planGraph.nodes.slice(1),
          ],
        },
      },
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("Due date is soon")).toBeInTheDocument();
    expect(screen.getByText("Requires stakeholder review")).toBeInTheDocument();
  });

  it("reports saved-plan metadata through onPlanLoaded", async () => {
    const onPlanLoaded = vi.fn();

    mockUseSmartDecomposition.mockReturnValue({
      result: samplePlanResponse,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest onPlanLoaded={onPlanLoaded} />);

    await waitFor(() => {
      expect(onPlanLoaded).toHaveBeenCalledWith({
        ...samplePlanResponse.savedPlan,
        plan: samplePlanResponse.planGraph,
      });
    });
  });
});
