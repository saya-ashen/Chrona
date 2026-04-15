import { cleanup, render, screen, waitFor, act, fireEvent } from "@testing-library/react";
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

vi.mock("@/hooks/use-ai", () => ({
  useAutoComplete: (...args: unknown[]) => mockUseAutoComplete(...args),
}));

import { ScheduleCommandBar } from "@/components/schedule/schedule-command-bar";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const defaultProps = {
  selectedDay: "2026-04-15",
  isPending: false,
  onSubmit: vi.fn().mockResolvedValue(undefined),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("ScheduleCommandBar – AI integration", () => {
  it("shows AI suggestion dropdown when typing >= 3 chars", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue({
      suggestions: [
        {
          title: "Write weekly report",
          description: "Summarize this week's progress",
          priority: "High",
          estimatedMinutes: 45,
          tags: ["writing"],
        },
        {
          title: "Write documentation",
          description: "Document new API endpoints",
          priority: "Medium",
          estimatedMinutes: 60,
          tags: ["docs"],
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(
      /task title/i,
    );
    await user.type(input, "Wri");

    // AI suggestion dropdown should appear
    await waitFor(() => {
      expect(screen.getByText("AI suggestions")).toBeInTheDocument();
    });

    // Both suggestions should be visible
    expect(screen.getByText("Write weekly report")).toBeInTheDocument();
    expect(screen.getByText("Write documentation")).toBeInTheDocument();

    // Descriptions should be shown
    expect(
      screen.getByText("Summarize this week's progress"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Document new API endpoints"),
    ).toBeInTheDocument();

    // Priority badges
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();

    // Estimated minutes
    expect(screen.getByText("45m")).toBeInTheDocument();
    expect(screen.getByText("60m")).toBeInTheDocument();
  });

  it("selecting AI suggestion triggers submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    mockUseAutoComplete.mockReturnValue({
      suggestions: [
        {
          title: "Write weekly report",
          description: "Summarize this week's progress",
          priority: "High",
          estimatedMinutes: 45,
          tags: ["writing"],
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<ScheduleCommandBar {...defaultProps} onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Wri");

    // Wait for dropdown
    await waitFor(() => {
      expect(screen.getByText("Write weekly report")).toBeInTheDocument();
    });

    // The component uses onMouseDown to prevent blur and trigger selection
    const suggestionButton = screen.getByText("Write weekly report")
      .closest("button")!;

    await act(async () => {
      fireEvent.mouseDown(suggestionButton);
    });

    // onSubmit should have been called with a draft containing the suggestion title and priority
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Write weekly report",
          priority: "High",
        }),
      );
    });
  });

  it("dropdown hides when no suggestions", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue({
      suggestions: [],
      isLoading: false,
      error: null,
    });

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Write something");

    // No dropdown should appear
    expect(screen.queryByText("AI suggestions")).not.toBeInTheDocument();
  });

  it("passes null to useAutoComplete when input is shorter than 3 chars", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue({
      suggestions: [],
      isLoading: false,
      error: null,
    });

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "ab");

    // The hook should have been called with null since "ab".length < 3
    const lastCall =
      mockUseAutoComplete.mock.calls[
        mockUseAutoComplete.mock.calls.length - 1
      ];
    expect(lastCall[0]).toBeNull();
  });

  it("limits AI suggestion dropdown to 5 items", async () => {
    const user = userEvent.setup();

    const manySuggestions = Array.from({ length: 8 }, (_, i) => ({
      title: `Suggestion item ${i + 1}`,
      description: `Description for item ${i + 1}`,
      priority: "Medium" as const,
      estimatedMinutes: 30,
      tags: [],
    }));

    mockUseAutoComplete.mockReturnValue({
      suggestions: manySuggestions,
      isLoading: false,
      error: null,
    });

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Sugg");

    await waitFor(() => {
      expect(screen.getByText("AI suggestions")).toBeInTheDocument();
    });

    // Only the first 5 should appear
    expect(screen.getByText("Suggestion item 1")).toBeInTheDocument();
    expect(screen.getByText("Suggestion item 5")).toBeInTheDocument();
    expect(
      screen.queryByText("Suggestion item 6"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Suggestion item 8"),
    ).not.toBeInTheDocument();
  });

  it("hides dropdown on Escape key", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue({
      suggestions: [
        {
          title: "Write weekly report",
          description: "Summary",
          priority: "Medium",
          estimatedMinutes: 30,
          tags: [],
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Wri");

    // Dropdown should be visible
    await waitFor(() => {
      expect(screen.getByText("AI suggestions")).toBeInTheDocument();
    });

    // Press Escape to hide dropdown
    await user.keyboard("{Escape}");

    // Dropdown should be hidden
    await waitFor(() => {
      expect(
        screen.queryByText("AI suggestions"),
      ).not.toBeInTheDocument();
    });
  });

  it("renders help hint text below the command bar", () => {
    mockUseAutoComplete.mockReturnValue({
      suggestions: [],
      isLoading: false,
      error: null,
    });

    render(<ScheduleCommandBar {...defaultProps} />);

    // The hint text from DEFAULT_SCHEDULE_PAGE_COPY.quickCreateHint
    expect(
      screen.getByText(/write weekly report/i),
    ).toBeInTheDocument();
  });
});
