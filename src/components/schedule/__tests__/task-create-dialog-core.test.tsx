import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const mockUseAutoComplete = vi.fn(() => ({ suggestions: [], isLoading: false, phase: "idle", statusMessage: null, toolCalls: [] }));
const mockUseSmartAutomation = vi.fn(() => ({ suggestion: null, isLoading: false }));
const mockUseSmartDecomposition = vi.fn(() => ({ result: null, isLoading: false, error: null }));

vi.mock("@/hooks/use-ai", () => ({
  useAutoComplete: () => mockUseAutoComplete(),
  useSmartAutomation: () => mockUseSmartAutomation(),
  useSmartDecomposition: () => mockUseSmartDecomposition(),
}));

vi.mock("@/components/schedule/automation-suggestion-panel", () => ({
  AutomationSuggestionPanel: () => null,
}));

import { TaskCreateDialog } from "@/components/schedule/task-create-dialog";
import type { TaskDecompositionResult } from "@/modules/ai/task-decomposer";

const defaultProps = {
  isOpen: true,
  initialTitle: "",
  initialStartAt: new Date(2026, 3, 15, 9, 0, 0, 0),
  initialEndAt: new Date(2026, 3, 15, 10, 0, 0, 0),
  isPending: false,
  onClose: vi.fn(),
  onSubmit: vi.fn().mockResolvedValue(undefined),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUseAutoComplete.mockImplementation(() => ({ suggestions: [], isLoading: false, phase: "idle", statusMessage: null, toolCalls: [] }));
  mockUseSmartAutomation.mockImplementation(() => ({ suggestion: null, isLoading: false }));
  mockUseSmartDecomposition.mockImplementation(() => ({ result: null, isLoading: false, error: null }));
});

describe("TaskCreateDialog – Core functionality", () => {
  it("returns null when not open", () => {
    const { container } = render(<TaskCreateDialog {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders dialog with title 'Add task' when open", () => {
    render(<TaskCreateDialog {...defaultProps} />);
    expect(screen.getByText("Add task")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add title")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add description")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onClose when backdrop clicked", async () => {
    const onClose = vi.fn();
    render(<TaskCreateDialog {...defaultProps} onClose={onClose} />);
    // The backdrop is the first div with bg-black/10
    const backdrop = document.querySelector(".fixed.inset-0")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when X button clicked", async () => {
    const onClose = vi.fn();
    render(<TaskCreateDialog {...defaultProps} onClose={onClose} />);
    const closeButton = screen.getByLabelText("Close");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on ESC key", () => {
    const onClose = vi.fn();
    render(<TaskCreateDialog {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("save button disabled when title empty", () => {
    render(<TaskCreateDialog {...defaultProps} />);
    const saveButton = screen.getByText("Save");
    expect(saveButton).toBeDisabled();
  });

  it("priority buttons change priority", async () => {
    const user = userEvent.setup();
    render(<TaskCreateDialog {...defaultProps} />);

    const highButton = screen.getByRole("button", { name: "High" });
    const mediumButton = screen.getByRole("button", { name: "Medium" });

    // Medium is default active
    expect(mediumButton.className).toContain("bg-primary");

    await user.click(highButton);

    // High should now be active
    expect(highButton.className).toContain("bg-primary");
    // Medium should no longer be active
    expect(mediumButton.className).not.toContain("bg-primary");
  });

  it("successful form submission with correct data", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<TaskCreateDialog {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);

    const titleInput = screen.getByPlaceholderText("Add title");
    await user.type(titleInput, "My task");

    const descInput = screen.getByPlaceholderText("Add description");
    await user.type(descInput, "Some description");

    // Click High priority
    await user.click(screen.getByRole("button", { name: "High" }));

    const saveButton = screen.getByText("Save");
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const call = onSubmit.mock.calls[0][0];
    expect(call.title).toBe("My task");
    expect(call.description).toBe("Some description");
    expect(call.priority).toBe("High");
    expect(call.dueAt).toBeNull();
    expect(call.scheduledStartAt).toBeInstanceOf(Date);
    expect(call.scheduledEndAt).toBeInstanceOf(Date);

    // onClose called after successful submit
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("exposes merged AI planning UI only when handler is provided and preserves priorities on apply", async () => {
    const user = userEvent.setup();
    const onApplyDecomposition = vi.fn().mockResolvedValue(undefined);
    const decompositionResult: TaskDecompositionResult = {
      subtasks: [
        {
          title: "Draft legal filing checklist",
          description: "Collect filing requirements",
          estimatedMinutes: 30,
          priority: "High",
          order: 1,
          dependsOnPrevious: false,
        },
        {
          title: "Confirm state deadlines",
          description: "Check every target state",
          estimatedMinutes: 45,
          priority: "Urgent",
          order: 2,
          dependsOnPrevious: true,
        },
      ],
      totalEstimatedMinutes: 75,
      feasibilityScore: 82,
      warnings: [],
    };

    mockUseSmartDecomposition.mockImplementation((() => ({
      result: decompositionResult,
      isLoading: false,
      error: null,
    })) as any);

    const { rerender } = render(<TaskCreateDialog {...defaultProps} initialTitle="Campaign setup" />);

    rerender(
      <TaskCreateDialog
        {...defaultProps}
        initialTitle="Campaign setup"
        onApplyDecomposition={onApplyDecomposition}
      />,
    );

    expect(screen.getByText("AI 任务规划")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /apply plan/i }));

    expect(onApplyDecomposition).toHaveBeenCalledWith(decompositionResult);
    expect(onApplyDecomposition.mock.calls[0]?.[0]?.subtasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priority: "High" }),
        expect.objectContaining({ priority: "Urgent" }),
      ]),
    );
  });

  it("shows 'Saving...' when isPending", () => {
    render(<TaskCreateDialog {...defaultProps} isPending={true} initialTitle="test" />);
    expect(screen.getByText("Saving...")).toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
  });

  it("all fields disabled when isPending", () => {
    render(<TaskCreateDialog {...defaultProps} isPending={true} initialTitle="test" />);

    expect(screen.getByPlaceholderText("Add title")).toBeDisabled();
    expect(screen.getByPlaceholderText("Add description")).toBeDisabled();

    // Priority buttons disabled
    for (const p of ["Low", "Medium", "High", "Urgent"]) {
      expect(screen.getByRole("button", { name: p })).toBeDisabled();
    }

    // Cancel button disabled
    expect(screen.getByText("Cancel")).toBeDisabled();

    // Save/Saving button disabled
    expect(screen.getByText("Saving...")).toBeDisabled();
  });
});
