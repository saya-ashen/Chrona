import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

const taskDecompositionPanelProps = vi.fn();
vi.mock("@/components/schedule/task-decomposition-panel", () => ({
  TaskDecompositionPanel: (props: unknown) => {
    taskDecompositionPanelProps(props);
    return <div data-testid="task-decomposition-panel" />;
  },
}));

import { AiInsightsPanel } from "@/components/schedule/ai-insights-panel";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

const mockItem: ScheduledItem = {
  taskId: "task-1",
  workspaceId: "ws-1",
  parentTaskId: null,
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
});

describe("AiInsightsPanel", () => {
  it("renders the merged AI task plan panel directly", () => {
    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={vi.fn()} />,
    );

    expect(screen.getByTestId("task-decomposition-panel")).toBeInTheDocument();
  });

  it("passes task context into the merged task plan panel", () => {
    const onApplyDecomposition = vi.fn();

    render(
      <AiInsightsPanel item={mockItem} onApplyDecomposition={onApplyDecomposition} />,
    );

    expect(taskDecompositionPanelProps).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        title: "Test task",
        description: "A test task",
        priority: "Medium",
        dueAt: mockItem.dueAt,
        autoRequest: true,
        onApply: onApplyDecomposition,
      }),
    );
  });
});
