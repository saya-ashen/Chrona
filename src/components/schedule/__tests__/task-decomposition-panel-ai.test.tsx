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

describe("TaskDecompositionPanel – AI integration", () => {
  it("shows loading skeleton when isLoading is true", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    // The loading state shows this text
    expect(
      screen.getByText("AI is decomposing your task..."),
    ).toBeInTheDocument();
  });

  it("shows error state when error is set", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: "Network timeout — please retry",
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    // Error header
    expect(
      screen.getByText("Failed to decompose task"),
    ).toBeInTheDocument();

    // Error message
    expect(
      screen.getByText("Network timeout — please retry"),
    ).toBeInTheDocument();
  });

  it("renders subtask list when result is available", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: sampleDecompositionResult,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    // Header should show "AI Decomposition"
    expect(screen.getByText("AI Decomposition")).toBeInTheDocument();

    // Feasibility score
    expect(screen.getByText("80% feasibility")).toBeInTheDocument();

    // Subtask titles
    expect(
      screen.getByText("Review existing documentation"),
    ).toBeInTheDocument();
    expect(screen.getByText("Update API reference")).toBeInTheDocument();
    expect(screen.getByText("Update deployment guide")).toBeInTheDocument();

    // Subtask descriptions
    expect(
      screen.getByText(
        "Read through all current docs and note outdated sections",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Refresh endpoint descriptions and examples"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Revise deployment steps for v2.1"),
    ).toBeInTheDocument();

    // Order numbers
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    // Total estimated time
    expect(screen.getByText("Total: 120 min")).toBeInTheDocument();
    expect(screen.getByText("(3 subtasks)")).toBeInTheDocument();

    // Apply button
    expect(
      screen.getByRole("button", { name: /apply decomposition/i }),
    ).toBeInTheDocument();
  });

  it("renders empty state when no subtasks (returns null)", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: {
        subtasks: [],
        totalEstimatedMinutes: 0,
        feasibilityScore: 0,
        warnings: [],
      },
      isLoading: false,
      error: null,
    });

    const { container } = render(
      <TaskDecompositionPanel {...defaultProps} />,
    );

    // Component returns null when result has empty subtasks
    expect(container.innerHTML).toBe("");
  });

  it("returns null when result is null and not loading", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
    });

    const { container } = render(
      <TaskDecompositionPanel {...defaultProps} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("Apply button calls onApply callback with the decomposition result", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    mockUseSmartDecomposition.mockReturnValue({
      result: sampleDecompositionResult,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} onApply={onApply} />);

    const applyButton = screen.getByRole("button", {
      name: /apply decomposition/i,
    });
    await user.click(applyButton);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(sampleDecompositionResult);
  });

  it("renders warnings when present in the result", () => {
    const resultWithWarnings: TaskDecompositionResult = {
      ...sampleDecompositionResult,
      warnings: [
        "Total estimated time (120 min) exceeds available time before due date",
        "2 subtask(s) estimated under 5 minutes — consider merging them",
      ],
    };

    mockUseSmartDecomposition.mockReturnValue({
      result: resultWithWarnings,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    expect(
      screen.getByText(
        "Total estimated time (120 min) exceeds available time before due date",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 subtask(s) estimated under 5 minutes — consider merging them",
      ),
    ).toBeInTheDocument();
  });

  it("displays correct priority styling for subtasks", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: sampleDecompositionResult,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    // Priority labels for subtasks should be visible
    const highLabels = screen.getAllByText("High");
    expect(highLabels.length).toBeGreaterThanOrEqual(2); // Two "High" priority subtasks

    const mediumLabels = screen.getAllByText("Medium");
    expect(mediumLabels.length).toBeGreaterThanOrEqual(1); // One "Medium" priority subtask
  });

  it("renders estimated minutes for each subtask", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: sampleDecompositionResult,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    // Each subtask should show its estimated time
    expect(screen.getByText("40m")).toBeInTheDocument();
    expect(screen.getByText("50m")).toBeInTheDocument();
    expect(screen.getByText("30m")).toBeInTheDocument();
  });

  it("displays singular subtask count text correctly", () => {
    const singleSubtaskResult: TaskDecompositionResult = {
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
    };

    mockUseSmartDecomposition.mockReturnValue({
      result: singleSubtaskResult,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

    // Should say "subtask" (singular) not "subtasks"
    expect(screen.getByText("(1 subtask)")).toBeInTheDocument();
  });

  it("passes the correct input to useSmartDecomposition", () => {
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: false,
      error: null,
    });

    render(<TaskDecompositionPanel {...defaultProps} />);

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
