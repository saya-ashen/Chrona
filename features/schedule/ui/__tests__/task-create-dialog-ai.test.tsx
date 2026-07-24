import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const mockUseAutoComplete = vi.fn();
const mockUseSmartAutomation = vi.fn();

vi.mock("../use-auto-complete", () => ({
  useAutoComplete: (...args: unknown[]) => mockUseAutoComplete(...args),
}));
vi.mock("../panels/automation-suggestion-panel", () => ({
  useSmartAutomation: (...args: unknown[]) => mockUseSmartAutomation(...args),
}));

import { TaskCreateDialog } from "../dialogs/task-create-dialog";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("TaskCreateDialog – AI integration", () => {
  it("requests and displays auto-complete only when explicitly enabled", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue({
      suggestions: [
        {
          title: "Write weekly report",
          description: "Summarize progress for the week",
          priority: "High",
          estimatedMinutes: 45,
          tags: ["writing"],
        },
      ],
      isLoading: false,
      error: null,
    });
    mockUseSmartAutomation.mockReturnValue({
      suggestion: null,
      isLoading: false,
      error: null,
    });

    render(<TaskCreateDialog {...defaultProps} autoSuggestionsEnabled />);

    await user.type(screen.getByPlaceholderText("Add title"), "Write");

    expect(mockUseAutoComplete).toHaveBeenLastCalledWith("Write");
    expect(screen.getByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.getByText("Write weekly report")).toBeInTheDocument();
  });


  it("does not show task planning UI inside the create dialog", () => {
    mockUseAutoComplete.mockReturnValue({
      suggestions: [],
      isLoading: false,
      error: null,
    });
    mockUseSmartAutomation.mockReturnValue({
      suggestion: null,
      isLoading: false,
      error: null,
    });

    render(
      <TaskCreateDialog
        {...defaultProps}
        initialTitle="Write weekly report"
      />,
    );

    expect(screen.queryByText("AI Task Planning")).not.toBeInTheDocument();
  });

  it("handles empty suggestions gracefully", () => {
    mockUseAutoComplete.mockReturnValue({
      suggestions: [],
      isLoading: false,
      error: null,
    });
    mockUseSmartAutomation.mockReturnValue({
      suggestion: null,
      isLoading: false,
      error: null,
    });

    render(<TaskCreateDialog {...defaultProps} autoSuggestionsEnabled />);

    // No AI dropdown should appear
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();

    // The dialog should still render normally
    expect(screen.getByText("Add task")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add title")).toBeInTheDocument();
  });

  it("does not show dialog content when isOpen is false", () => {
    mockUseAutoComplete.mockReturnValue({
      suggestions: [],
      isLoading: false,
      error: null,
    });
    mockUseSmartAutomation.mockReturnValue({
      suggestion: null,
      isLoading: false,
      error: null,
    });

    render(<TaskCreateDialog {...defaultProps} isOpen={false} />);

    expect(screen.queryByText("Add task")).not.toBeInTheDocument();
  });


});
