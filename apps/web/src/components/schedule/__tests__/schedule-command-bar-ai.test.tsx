import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const mockUseAutoComplete = vi.fn();
vi.mock("@/hooks/use-ai", () => ({
  useAutoComplete: (...args: unknown[]) => mockUseAutoComplete(...args),
}));

import { ScheduleCommandBar } from "@/components/schedule/schedule-command-bar";

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

  it("shows AI suggestion dropdown when typing >= 3 chars and auto suggestions are enabled", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue(
      hookReturn({
        structuredSuggestions: [
          suggestion({ id: "s1", title: "Write weekly report" }),
          suggestion({ id: "s2", title: "Write documentation", summary: "Docs summary", estimatedMinutes: 60, priority: "Medium", tags: ["docs"] }),
        ],
      }),
    );

    render(<ScheduleCommandBar {...defaultProps} autoSuggestionsEnabled />);
    await user.type(screen.getByPlaceholderText(/task title/i), "Wri");

    await waitFor(() => expect(screen.getByText("AI suggestions")).toBeInTheDocument());
    expect(screen.getByText("Write weekly report")).toBeInTheDocument();
    expect(screen.getByText("Write documentation")).toBeInTheDocument();
    expect(screen.getByText("45m")).toBeInTheDocument();
    expect(screen.getByText("60m")).toBeInTheDocument();
  });

  it("selecting AI suggestion triggers submit and keeps trace with final title", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    mockUseAutoComplete.mockReturnValue(
      hookReturn({
        structuredSuggestions: [suggestion({ id: "s1", title: "Write weekly report", priority: "High" })],
        toolCalls: [{ tool: "suggest_task_completions", input: { input: "Wri" } }],
        toolResults: [{ tool: "suggest_task_completions", result: "Generated 1 suggestion" }],
        partialText: "drafting",
      }),
    );

    render(<ScheduleCommandBar {...defaultProps} onSubmit={onSubmit} autoSuggestionsEnabled />);
    await user.type(screen.getByPlaceholderText(/task title/i), "Wri");
    await waitFor(() => expect(screen.getByText("Write weekly report")).toBeInTheDocument());
    await user.click(screen.getByText("Write weekly report").closest("button")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "Write weekly report", priority: "High" }));
    expect(screen.getByText(/finalSubmittedTitle: Write weekly report/i)).toBeInTheDocument();
    expect(screen.getAllByText(/suggest_task_completions/i).length).toBeGreaterThan(0);
  });

  it("renders process panel information from streaming state even outside dropdown lifecycle", async () => {
    const user = userEvent.setup();

    mockUseAutoComplete.mockReturnValue(
      hookReturn({
        structuredSuggestions: [suggestion()],
        isLoading: true,
        phase: "streaming",
        statusMessage: "Thinking",
        toolCalls: [{ tool: "suggest_task_completions", input: { input: "Write" } }],
        toolResults: [{ tool: "suggest_task_completions", result: "Generated 1 suggestion" }],
        partialText: "drafting...",
      }),
    );

    render(<ScheduleCommandBar {...defaultProps} autoSuggestionsEnabled />);
    await user.type(screen.getByPlaceholderText(/task title/i), "Write");

    expect(screen.getByText(/AI process panel/i)).toBeInTheDocument();
    expect(screen.getAllByText(/suggest_task_completions/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Generated 1 suggestion/i)).toBeInTheDocument();
    expect(screen.getByText(/drafting/i)).toBeInTheDocument();
  });
});
