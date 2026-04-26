import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {} }),
  useLocale: () => "en",
}));

const mockUseAutoComplete = vi.fn();
vi.mock("@/hooks/use-ai", () => ({
  useAutoComplete: (...args: unknown[]) => mockUseAutoComplete(...args),
}));

import { ScheduleCommandBar } from "@/components/schedule/schedule-command-bar";

function hookValue(overrides: Record<string, unknown> = {}) {
  return {
    structuredSuggestions: overrides.structuredSuggestions ?? [],
    suggestions: overrides.suggestions ?? [],
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
    phase: overrides.phase ?? "idle",
    statusMessage: overrides.statusMessage ?? null,
    toolCalls: overrides.toolCalls ?? [],
    toolResults: overrides.toolResults ?? [],
    partialText: overrides.partialText ?? "",
  };
}

describe("schedule quick create AI-only path", () => {
  const cryptoMock = { randomUUID: vi.fn(() => "trace-1") };

  beforeEach(() => {
    vi.stubGlobal("crypto", cryptoMock as unknown as Crypto);
    mockUseAutoComplete.mockReturnValue(hookValue());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("submits direct Chinese title using the current AI suggestion without truncation", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    mockUseAutoComplete.mockReturnValue(
      hookValue({
        structuredSuggestions: [
          {
            id: "s1",
            summary: "创建任务",
            action: {
              type: "create_task",
              title: "参加美国总统竞选",
              description: "",
              priority: "High",
              estimatedMinutes: 90,
              tags: [],
            },
          },
        ],
        phase: "done",
        statusMessage: "Done",
        toolCalls: [{ tool: "suggest_task_completions", input: { input: "参加美国总统竞选" } }],
        toolResults: [{ tool: "suggest_task_completions", result: "Generated 1 suggestion" }],
        partialText: "drafting...",
      }),
    );

    render(
      <ScheduleCommandBar selectedDay="2026-04-15" isPending={false} onSubmit={onSubmit} />,
    );

    await user.type(screen.getByPlaceholderText(/task title/i), "参加美国总统竞选");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "参加美国总统竞选", priority: "High" }));
  });

  it("returns explainable error when no AI suggestion is available instead of silently creating", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    mockUseAutoComplete.mockReturnValue(
      hookValue({ structuredSuggestions: [], phase: "done", error: null }),
    );

    render(
      <ScheduleCommandBar selectedDay="2026-04-15" isPending={false} onSubmit={onSubmit} />,
    );

    await user.type(screen.getByPlaceholderText(/task title/i), "参加美国总统竞选");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getAllByText(/AI 无法可靠理解该输入/i).length).toBeGreaterThan(0);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
