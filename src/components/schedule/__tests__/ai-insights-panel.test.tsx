import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const mockUseSmartAutomation = vi.fn().mockReturnValue({
  suggestion: null,
  isLoading: false,
});

const mockUseSmartDecomposition = vi.fn().mockReturnValue({
  result: null,
  isLoading: false,
  error: null,
});

vi.mock("@/hooks/use-ai", () => ({
  useSmartAutomation: (...args: unknown[]) => mockUseSmartAutomation(...args),
  useSmartDecomposition: (...args: unknown[]) => mockUseSmartDecomposition(...args),
}));

import { AiInsightsPanel } from "@/components/schedule/ai-insights-panel";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const mockItem: ScheduledItem = {
  taskId: "task-1",
  workspaceId: "ws-1",
  title: "Test task",
  description: "A test task",
  priority: "Medium",
  ownerType: "human",
  assigneeAgentId: null,
  persistedStatus: "Ready",
  displayState: null,
  actionRequired: null,
  approvalPendingCount: 0,
  scheduleStatus: "Scheduled",
  scheduleSource: "human",
  dueAt: new Date(2026, 3, 20),
  scheduledStartAt: new Date(2026, 3, 15, 9, 0),
  scheduledEndAt: new Date(2026, 3, 15, 10, 0),
  latestRunStatus: null,
  scheduleProposalCount: 0,
  lastActivityAt: null,
  runtimeAdapterKey: "openclaw",
  runtimeInput: {},
  runtimeInputVersion: "openclaw-v1",
  runtimeModel: null,
  prompt: null,
  runtimeConfig: null,
  isRunnable: true,
  runnabilityState: "ready",
  runnabilitySummary: "Ready",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUseSmartAutomation.mockReturnValue({ suggestion: null, isLoading: false });
  mockUseSmartDecomposition.mockReturnValue({ result: null, isLoading: false, error: null });
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("AiInsightsPanel", () => {
  it("renders two tab buttons", () => {
    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={vi.fn()} />,
    );

    expect(screen.getByText("AI 建议")).toBeInTheDocument();
    expect(screen.getByText("任务分解")).toBeInTheDocument();
  });

  it("shows no content by default (no tab selected)", () => {
    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={vi.fn()} />,
    );

    // Neither automation nor decomposition content should be visible
    expect(screen.queryByText("AI is analyzing your task...")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 正在分解任务...")).not.toBeInTheDocument();
  });

  it("clicking AI 建议 tab triggers automation request", async () => {
    const user = userEvent.setup();
    mockUseSmartAutomation.mockReturnValue({ suggestion: null, isLoading: true });

    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={vi.fn()} />,
    );

    await user.click(screen.getByText("AI 建议"));

    // Should show loading after clicking
    expect(screen.getByText("AI is analyzing your task...")).toBeInTheDocument();
  });

  it("clicking 任务分解 tab shows decomposition panel", async () => {
    const user = userEvent.setup();
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
    });

    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={vi.fn()} />,
    );

    await user.click(screen.getByText("任务分解"));

    expect(screen.getByText("AI 正在分解任务...")).toBeInTheDocument();
  });

  it("clicking same tab again hides content (toggle)", async () => {
    const user = userEvent.setup();
    mockUseSmartAutomation.mockReturnValue({ suggestion: null, isLoading: true });

    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={vi.fn()} />,
    );

    const tab = screen.getByText("AI 建议");

    // First click: show
    await user.click(tab);
    expect(screen.getByText("AI is analyzing your task...")).toBeInTheDocument();

    // Second click: hide
    await user.click(tab);
    expect(screen.queryByText("AI is analyzing your task...")).not.toBeInTheDocument();
  });

  it("switching tabs shows only the active panel", async () => {
    const user = userEvent.setup();
    mockUseSmartAutomation.mockReturnValue({ suggestion: null, isLoading: true });
    mockUseSmartDecomposition.mockReturnValue({
      result: null,
      isLoading: true,
      error: null,
    });

    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={vi.fn()} />,
    );

    // Click automation tab
    await user.click(screen.getByText("AI 建议"));
    expect(screen.getByText("AI is analyzing your task...")).toBeInTheDocument();

    // Click decomposition tab
    await user.click(screen.getByText("任务分解"));
    expect(screen.queryByText("AI is analyzing your task...")).not.toBeInTheDocument();
    expect(screen.getByText("AI 正在分解任务...")).toBeInTheDocument();
  });

  it("shows automation suggestion content when available", async () => {
    const user = userEvent.setup();
    mockUseSmartAutomation.mockReturnValue({
      suggestion: {
        executionMode: "scheduled",
        confidence: "high",
        reminderStrategy: {
          advanceMinutes: 15,
          frequency: "once",
          channels: ["email"],
        },
        preparationSteps: ["Prepare notes"],
      },
      isLoading: false,
    });

    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={vi.fn()} />,
    );

    await user.click(screen.getByText("AI 建议"));

    expect(screen.getByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.getByText("high confidence")).toBeInTheDocument();
  });
});
