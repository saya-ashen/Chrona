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

function makeSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "sug-1",
    summary: overrides.summary ?? "Summary text",
    action: {
      type: "create_task",
      title: (overrides as Record<string, string>).title ?? "Write weekly report",
      description: (overrides as Record<string, string>).description ?? "Summarize this week's progress",
      priority: (overrides as Record<string, string>).priority ?? "High",
      estimatedMinutes: (overrides as Record<string, number>).estimatedMinutes ?? 45,
      tags: (overrides as Record<string, string[]>).tags ?? ["writing"],
    },
  };
}

function mockHookReturn(overrides: Record<string, unknown> = {}) {
  return {
    structuredSuggestions: overrides.structuredSuggestions ?? [],
    suggestions: overrides.suggestions ?? [],
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    phase: overrides.phase ?? "idle",
    statusMessage: overrides.statusMessage ?? "",
    toolCalls: overrides.toolCalls ?? [],
    toolResults: overrides.toolResults ?? [],
  };
}

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

    const s1 = makeSuggestion({ id: "s1", title: "Write weekly report", description: "Summarize this week's progress", priority: "High", estimatedMinutes: 45 });
    const s2 = makeSuggestion({ id: "s2", title: "Write documentation", summary: "Docs summary", description: "Document new API endpoints", priority: "Medium", estimatedMinutes: 60, tags: ["docs"] });

    mockUseAutoComplete.mockReturnValue(mockHookReturn({
      structuredSuggestions: [s1, s2],
    }));

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Wri");

    // AI suggestion dropdown should appear
    await waitFor(() => {
      expect(screen.getByText("AI suggestions")).toBeInTheDocument();
    });

    // Both suggestions should be visible (rendered via s.action.title)
    expect(screen.getByText("Write weekly report")).toBeInTheDocument();
    expect(screen.getByText("Write documentation")).toBeInTheDocument();

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

    const s1 = makeSuggestion({ id: "s1", title: "Write weekly report", priority: "High" });

    mockUseAutoComplete.mockReturnValue(mockHookReturn({
      structuredSuggestions: [s1],
    }));

    render(<ScheduleCommandBar {...defaultProps} onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Wri");

    await waitFor(() => {
      expect(screen.getByText("Write weekly report")).toBeInTheDocument();
    });

    const suggestionButton = screen.getByText("Write weekly report").closest("button")!;

    await act(async () => {
      fireEvent.mouseDown(suggestionButton);
    });

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

    mockUseAutoComplete.mockReturnValue(mockHookReturn({
      structuredSuggestions: [],
    }));

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Write something");

    expect(screen.queryByText("AI suggestions")).not.toBeInTheDocument();
  });

  it("passes null to useAutoComplete when input is shorter than 3 chars", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue(mockHookReturn());

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "ab");

    const lastCall =
      mockUseAutoComplete.mock.calls[
        mockUseAutoComplete.mock.calls.length - 1
      ];
    expect(lastCall[0]).toBeNull();
  });

  it("limits AI suggestion dropdown to 5 items", async () => {
    const user = userEvent.setup();

    const manySuggestions = Array.from({ length: 8 }, (_, i) =>
      makeSuggestion({ id: `s${i}`, title: `Suggestion item ${i + 1}`, priority: "Medium", estimatedMinutes: 30, tags: [] }),
    );

    mockUseAutoComplete.mockReturnValue(mockHookReturn({
      structuredSuggestions: manySuggestions,
    }));

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Sugg");

    await waitFor(() => {
      expect(screen.getByText("AI suggestions")).toBeInTheDocument();
    });

    // Only the first 5 should appear
    expect(screen.getByText("Suggestion item 1")).toBeInTheDocument();
    expect(screen.getByText("Suggestion item 5")).toBeInTheDocument();
    expect(screen.queryByText("Suggestion item 6")).not.toBeInTheDocument();
    expect(screen.queryByText("Suggestion item 8")).not.toBeInTheDocument();
  });

  it("hides dropdown on Escape key", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue(mockHookReturn({
      structuredSuggestions: [makeSuggestion()],
    }));

    render(<ScheduleCommandBar {...defaultProps} />);

    const input = screen.getByPlaceholderText(/task title/i);
    await user.type(input, "Wri");

    await waitFor(() => {
      expect(screen.getByText("AI suggestions")).toBeInTheDocument();
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByText("AI suggestions")).not.toBeInTheDocument();
    });
  });

  it("renders help hint text below the command bar", () => {
    mockUseAutoComplete.mockReturnValue(mockHookReturn());

    render(<ScheduleCommandBar {...defaultProps} />);

    expect(screen.getByText(/write weekly report/i)).toBeInTheDocument();
  });
});
