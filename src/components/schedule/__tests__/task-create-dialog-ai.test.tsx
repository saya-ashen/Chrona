import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const mockUseAutoComplete = vi.fn();
const mockUseSmartAutomation = vi.fn();

vi.mock("@/hooks/use-ai", () => ({
  useAutoComplete: (...args: unknown[]) => mockUseAutoComplete(...args),
  useSmartAutomation: (...args: unknown[]) => mockUseSmartAutomation(...args),
}));

import { TaskCreateDialog } from "@/components/schedule/task-create-dialog";

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
  it("renders auto-complete dropdown when suggestions are available", async () => {
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
        {
          title: "Write unit tests",
          description: "Cover edge cases for auth module",
          priority: "Medium",
          estimatedMinutes: 60,
          tags: ["testing"],
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

    render(<TaskCreateDialog {...defaultProps} />);

    // Type enough characters to trigger auto-complete (>= 3 chars)
    const titleInput = screen.getByPlaceholderText("Add title");
    await user.type(titleInput, "Wri");

    // The dropdown should appear with "AI Suggestions" header
    await waitFor(() => {
      expect(screen.getByText("AI Suggestions")).toBeInTheDocument();
    });

    // Both suggestions should be rendered
    expect(screen.getByText("Write weekly report")).toBeInTheDocument();
    expect(screen.getByText("Write unit tests")).toBeInTheDocument();

    // Priority badges should be shown (note: "High" also appears as a priority button)
    const highElements = screen.getAllByText("High");
    expect(highElements.length).toBeGreaterThanOrEqual(1);

    // Estimated minutes should be shown
    expect(screen.getByText("~45m")).toBeInTheDocument();
    expect(screen.getByText("~60m")).toBeInTheDocument();

    // Descriptions should be shown
    expect(
      screen.getByText("Summarize progress for the week"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cover edge cases for auth module"),
    ).toBeInTheDocument();
  });

  it("selecting auto-complete suggestion fills in title, description, and priority", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue({
      suggestions: [
        {
          title: "Prepare deployment checklist",
          description: "Steps to deploy v2.1 to production",
          priority: "Urgent",
          estimatedMinutes: 30,
          tags: ["ops"],
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

    render(<TaskCreateDialog {...defaultProps} />);

    const titleInput = screen.getByPlaceholderText("Add title");
    await user.type(titleInput, "Prep");

    // Wait for dropdown to appear
    await waitFor(() => {
      expect(screen.getByText("AI Suggestions")).toBeInTheDocument();
    });

    // Click the suggestion
    const suggestionBtn = screen.getByText("Prepare deployment checklist").closest("button")!;
    await user.click(suggestionBtn);

    // Title should be filled
    expect(titleInput).toHaveValue("Prepare deployment checklist");

    // Description textarea should be filled
    const descriptionTextarea = screen.getByPlaceholderText("Add description");
    expect(descriptionTextarea).toHaveValue(
      "Steps to deploy v2.1 to production",
    );

    // Priority should be set to Urgent
    // The Urgent button should now have the active styling
    const urgentButton = screen.getByRole("button", { name: "Urgent" });
    expect(urgentButton.className).toContain("bg-primary");
  });

  it("automation suggestion panel shows when AI returns data", () => {
    mockUseAutoComplete.mockReturnValue({
      suggestions: [],
      isLoading: false,
      error: null,
    });
    mockUseSmartAutomation.mockReturnValue({
      suggestion: {
        executionMode: "scheduled",
        reminderStrategy: {
          advanceMinutes: 15,
          frequency: "once",
          channels: ["push"],
        },
        preparationSteps: ["Review last week notes", "Gather metrics"],
        contextSources: [],
        confidence: "high",
      },
      isLoading: false,
      error: null,
    });

    render(
      <TaskCreateDialog {...defaultProps} initialTitle="Write weekly report" />,
    );

    // AutomationSuggestionPanel should render with AI data
    expect(screen.getByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.getByText("high confidence")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText(/15min before/)).toBeInTheDocument();
    expect(screen.getByText("Review last week notes")).toBeInTheDocument();
    expect(screen.getByText("Gather metrics")).toBeInTheDocument();
  });

  it("automation panel shows loading state", () => {
    mockUseAutoComplete.mockReturnValue({
      suggestions: [],
      isLoading: false,
      error: null,
    });
    mockUseSmartAutomation.mockReturnValue({
      suggestion: null,
      isLoading: true,
      error: null,
    });

    render(
      <TaskCreateDialog
        {...defaultProps}
        initialTitle="Write weekly report"
      />,
    );

    // The loading state of AutomationSuggestionPanel shows this text
    expect(
      screen.getByText("AI is analyzing your task..."),
    ).toBeInTheDocument();
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

    render(<TaskCreateDialog {...defaultProps} />);

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

  it("passes null to useAutoComplete when title is shorter than 3 chars", async () => {
    const user = userEvent.setup();

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

    render(<TaskCreateDialog {...defaultProps} />);

    const titleInput = screen.getByPlaceholderText("Add title");
    await user.type(titleInput, "ab");

    // useAutoComplete should have been called with null (title < 3 chars)
    // The last call should be with null since "ab".length < 3
    const lastCall =
      mockUseAutoComplete.mock.calls[
        mockUseAutoComplete.mock.calls.length - 1
      ];
    expect(lastCall[0]).toBeNull();

    // No dropdown should appear
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
  });

  it("limits auto-complete dropdown to 5 suggestions", async () => {
    const user = userEvent.setup();

    const manySuggestions = Array.from({ length: 8 }, (_, i) => ({
      title: `Suggestion ${i + 1}`,
      description: `Description ${i + 1}`,
      priority: "Medium" as const,
      estimatedMinutes: 30,
      tags: [],
    }));

    mockUseAutoComplete.mockReturnValue({
      suggestions: manySuggestions,
      isLoading: false,
      error: null,
    });
    mockUseSmartAutomation.mockReturnValue({
      suggestion: null,
      isLoading: false,
      error: null,
    });

    render(<TaskCreateDialog {...defaultProps} />);

    const titleInput = screen.getByPlaceholderText("Add title");
    await user.type(titleInput, "Sugg");

    // Wait for dropdown to appear
    await waitFor(() => {
      expect(screen.getByText("AI Suggestions")).toBeInTheDocument();
    });

    // Only first 5 suggestions should be rendered
    expect(screen.getByText("Suggestion 1")).toBeInTheDocument();
    expect(screen.getByText("Suggestion 5")).toBeInTheDocument();
    expect(screen.queryByText("Suggestion 6")).not.toBeInTheDocument();
    expect(screen.queryByText("Suggestion 8")).not.toBeInTheDocument();
  });
});
