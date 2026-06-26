import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@chrona/i18n/react", async () => {
  const { fallbackMessages } = await import("@chrona/i18n/messages");
  return {
    useI18n: () => ({ messages: fallbackMessages, t: (key: string) => key }),
    useLocale: () => "en",
  };
});

const taskDecompositionPanelProps = vi.fn();
vi.mock("@/components/tasks/ai/task-plan-generation-panel", () => ({
  TaskPlanGenerationPanel: (props: unknown) => {
    taskDecompositionPanelProps(props);
    return <div data-testid="task-decomposition-panel" />;
  },
}));

import { AiInsightsPanel } from "@/components/schedule/panels/ai-insights-panel";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

const mockItem: ScheduledItem = {
  taskId: "task-1",
  workspaceId: "ws-1",
  parentTaskId: null,
  title: "Test task",
  description: "A test task",
  priority: "Medium",
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
  executionRuntime: "hermes",
  executionConfig: {},
  autoPlanGeneration: false,
  autoExecute: false,
  autoPlanGenerationTiming: "at_start",
  autoExecuteTiming: "at_start",
  isRunnable: true,
  runnabilityState: "ready",
  runnabilitySummary: "Ready",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiInsightsPanel", () => {
  it("renders the merged AI task plan panel directly", () => {
    render(
      <AiInsightsPanel item={mockItem} planResult={null} onPlanLoaded={vi.fn()} onApplyDecomposition={vi.fn()} />,
    );

    expect(screen.getByTestId("task-decomposition-panel")).toBeInTheDocument();
  });

  it("passes task context into the merged task plan panel without auto-requesting on open", () => {
    const onApplyDecomposition = vi.fn();

    render(
      <AiInsightsPanel item={mockItem} planResult={null} onPlanLoaded={vi.fn()} onApplyDecomposition={onApplyDecomposition} />,
    );

    expect(taskDecompositionPanelProps).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        title: "Test task",
        description: "A test task",
        priority: "Medium",
        dueAt: mockItem.dueAt,
        autoRequest: false,
        onApply: onApplyDecomposition,
      }),
    );
  });
});
