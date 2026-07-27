import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@chrona/i18n/react", async () => {
  const { fallbackMessages } = await import("@chrona/i18n/messages");
  return {
    useI18n: () => ({ messages: fallbackMessages, t: (key: string) => key }),
    useLocale: () => "en",
  };
});

const mockUseAutoComplete = vi.fn();
vi.mock("../use-auto-complete", () => ({
  useAutoComplete: (...args: unknown[]) => mockUseAutoComplete(...args),
}));

import { ScheduleCommandBar } from "../schedule-command-bar";

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "sug-1",
    summary: overrides.summary ?? "Summary text",
    action: {
      type: "create_task",
      title: (overrides.title as string) ?? "Write weekly report",
      description: (overrides.description as string) ?? "Summarize this week's progress",
      priority: (overrides.priority as string) ?? "High",
      estimatedMinutes: (overrides.estimatedMinutes as number) ?? 45,
      tags: (overrides.tags as string[]) ?? ["writing"],
    },
  };
}

function hookReturn(overrides: Record<string, unknown> = {}) {
  return {
    structuredSuggestions: overrides.structuredSuggestions ?? [],
    suggestions: overrides.suggestions ?? [],
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    phase: overrides.phase ?? "idle",
    statusMessage: overrides.statusMessage ?? "",
    toolCalls: overrides.toolCalls ?? [],
    toolResults: overrides.toolResults ?? [],
    partialText: overrides.partialText ?? "",
  };
}

const defaultProps = {
  selectedDay: "2026-04-15",
  isPending: false,
  onSubmit: vi.fn().mockResolvedValue(undefined),
};

describe("ScheduleCommandBar – AI integration", () => {
  beforeEach(() => {
    mockUseAutoComplete.mockReturnValue(hookReturn());
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "trace-1") } as unknown as Crypto);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not auto-request suggestions by default while the user types", async () => {
    const user = userEvent.setup();

    render(<ScheduleCommandBar {...defaultProps} />);
    await user.type(screen.getByPlaceholderText(/task title/i), "Wri");

    expect(mockUseAutoComplete).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText("AI suggestions")).not.toBeInTheDocument();
  });

  it("requests suggestions only after explicit enablement", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue(
      hookReturn({
        structuredSuggestions: [
          suggestion({ id: "s1", title: "Write weekly report" }),
        ],
      }),
    );

    render(<ScheduleCommandBar {...defaultProps} autoSuggestionsEnabled />);
    await user.type(screen.getByPlaceholderText(/task title/i), "Write");

    expect(mockUseAutoComplete).toHaveBeenLastCalledWith("Write");
    expect(screen.getByText("Write weekly report")).toBeInTheDocument();
  });


});
