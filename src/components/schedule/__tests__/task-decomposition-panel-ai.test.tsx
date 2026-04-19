import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const mockUseSmartDecomposition = vi.fn();

vi.mock("@/hooks/use-ai", () => ({
  useSmartDecomposition: (...args: unknown[]) =>
    mockUseSmartDecomposition(...args),
}));

import { TaskDecompositionPanel } from "@/components/schedule/task-decomposition-panel";
import type { TaskDecompositionResult } from "@/modules/ai/task-decomposer";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const defaultProps = {
  taskId: "task_1",
  title: "Review and update documentation",
  description: "Go through all docs and update them",
  priority: "High",
  dueAt: new Date(2026, 3, 20),
  estimatedMinutes: 120,
  onApply: vi.fn(),
};

const sampleDecompositionResult: TaskDecompositionResult = {
  subtasks: [
    {
      title: "Review existing documentation",
      description: "Read through all current docs and note outdated sections",
      estimatedMinutes: 40,
      priority: "High",
      order: 1,
      dependsOnPrevious: false,
    },
    {
      title: "Update API reference",
      description: "Refresh endpoint descriptions and examples",
      estimatedMinutes: 50,
      priority: "High",
      order: 2,
      dependsOnPrevious: true,
    },
    {
      title: "Update deployment guide",
      description: "Revise deployment steps for v2.1",
      estimatedMinutes: 30,
      priority: "Medium",
      order: 3,
      dependsOnPrevious: true,
    },
  ],
  totalEstimatedMinutes: 120,
  feasibilityScore: 80,
  warnings: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("TaskDecompositionPanel – opt-in behavior", () => {
  it("shows trigger button when not requested (default)", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    // Should show the trigger button
    expect(screen.getByText("AI 任务分解")).toBeInTheDocument();
    // Should pass null to hook (not requested yet)
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

    await user.click(screen.getByText("AI 任务分解"));

    // After clicking, should pass input to hook
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

    // Should NOT show trigger button
    expect(screen.queryByText("AI 任务分解")).not.toBeInTheDocument();
    // Should pass input to hook immediately
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

    expect(screen.getByText("AI 正在分解任务...")).toBeInTheDocument();
  });

  it("shows error state when error is set", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: "Network timeout",
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(
      screen.getByText("Failed to decompose: Network timeout"),
    ).toBeInTheDocument();
  });

  it("renders subtask list when result is available", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: sampleDecompositionResult,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("Task Decomposition")).toBeInTheDocument();
    expect(screen.getByText("80% feasible")).toBeInTheDocument();

    // Subtask titles
    expect(screen.getByText("Review existing documentation")).toBeInTheDocument();
    expect(screen.getByText("Update API reference")).toBeInTheDocument();
    expect(screen.getByText("Update deployment guide")).toBeInTheDocument();

    // Total time and count
    expect(screen.getByText("Total: 120 min")).toBeInTheDocument();
    expect(screen.getByText("(3 subtasks)")).toBeInTheDocument();

    // Apply button
    expect(
      screen.getByRole("button", { name: /apply decomposition/i }),
    ).toBeInTheDocument();
  });

  it("Apply button calls onApply with the result", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    mockUseSmartDecomposition.mockReturnValue({
      result: sampleDecompositionResult,
      isLoading: false,
      error: null,
    });

    render(
      <TaskDecompositionPanel {...defaultProps} autoRequest onApply={onApply} />,
    );

    await user.click(screen.getByRole("button", { name: /apply decomposition/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(sampleDecompositionResult);
  });

  it("renders warnings when present", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: {
        ...sampleDecompositionResult,
        warnings: ["Time exceeds available window"],
      },
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(
      screen.getByText("Time exceeds available window"),
    ).toBeInTheDocument();
  });

  it("shows estimated minutes per subtask", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: sampleDecompositionResult,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("40m")).toBeInTheDocument();
    expect(screen.getByText("50m")).toBeInTheDocument();
    expect(screen.getByText("30m")).toBeInTheDocument();
  });

  it("shows singular subtask count text", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: {
        subtasks: [
          {
            title: "Single task",
            estimatedMinutes: 60,
            priority: "Medium",
            order: 1,
            dependsOnPrevious: false,
          },
        ],
        totalEstimatedMinutes: 60,
        feasibilityScore: 50,
        warnings: [],
      },
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} autoRequest />);

    expect(screen.getByText("(1 subtask)")).toBeInTheDocument();
  });

  it("returns null when result is null and not loading (after autoRequest)", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
    });

    const { container } = render(
      <TaskDecompositionPanel {...defaultProps} autoRequest />,
    );

    expect(container.innerHTML).toBe("");
  });
});
