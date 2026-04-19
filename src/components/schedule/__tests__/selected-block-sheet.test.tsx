import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {}, t: (k: string) => k }),
  useLocale: () => "en",
}));

vi.mock("@/i18n/routing", () => ({
  localizeHref: (_locale: string, href: string) => href,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Mock the AI insights panel
vi.mock("@/components/schedule/ai-insights-panel", () => ({
  AiInsightsPanel: () => <div data-testid="ai-insights-panel" />,
}));

// Mock the schedule editor form
vi.mock("@/components/schedule/schedule-editor-form", () => ({
  ScheduleEditorForm: () => <div data-testid="schedule-editor-form" />,
}));

// Mock the task config form
vi.mock("@/components/schedule/task-config-form", () => ({
  TaskConfigForm: () => <div data-testid="task-config-form" />,
}));

// Mock the task context links
vi.mock("@/components/ui/task-context-links", () => ({
  TaskContextLinks: () => <div data-testid="task-context-links" />,
}));

// Mock fetch for subtasks
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => [],
});

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: (...args: Parameters<typeof fetch>) => mockFetch(...args),
});

import { SelectedBlockSheet } from "@/components/schedule/schedule-page-panels";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const mockItem: ScheduledItem = {
  taskId: "task-1",
  workspaceId: "ws-1",
  title: "Test task",
  description: "A description",
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

const defaultSheetProps = {
  item: mockItem,
  selectedDay: "2026-04-15",
  runtimeAdapters: [
    {
      key: "openclaw",
      label: "OpenClaw",
      spec: {
        adapterKey: "openclaw",
        version: "openclaw-v1",
        fields: [],
        runnability: { requiredPaths: [] },
      },
    },
  ],
  defaultRuntimeAdapterKey: "openclaw",
  isPending: false,
  onSaveTaskConfigAction: vi.fn(),
  onMutatedAction: vi.fn(),
  buildScheduleHref: (day: string, taskId?: string) =>
    taskId ? `/schedule/${day}/${taskId}` : `/schedule/${day}`,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("SelectedBlockSheet – layout order", () => {
  it("renders the title", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByText("Test task")).toBeInTheDocument();
  });

  it("renders schedule editor form (time adjustment)", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("schedule-editor-form")).toBeInTheDocument();
  });

  it("renders task config form", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-config-form")).toBeInTheDocument();
  });

  it("renders AI insights panel", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("ai-insights-panel")).toBeInTheDocument();
  });

  it("renders task context links", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(screen.getByTestId("task-context-links")).toBeInTheDocument();
  });

  it("renders sections in correct order: time → config → AI → links", () => {
    const { container } = render(<SelectedBlockSheet {...defaultSheetProps} />);

    const scheduleEditor = container.querySelector("[data-testid='schedule-editor-form']");
    const taskConfig = container.querySelector("[data-testid='task-config-form']");
    const aiInsights = container.querySelector("[data-testid='ai-insights-panel']");
    const contextLinks = container.querySelector("[data-testid='task-context-links']");

    // All should exist
    expect(scheduleEditor).toBeTruthy();
    expect(taskConfig).toBeTruthy();
    expect(aiInsights).toBeTruthy();
    expect(contextLinks).toBeTruthy();

    // Check order via DOM position
    const allElements = [scheduleEditor, taskConfig, aiInsights, contextLinks];
    for (let i = 0; i < allElements.length - 1; i++) {
      const pos = allElements[i]!.compareDocumentPosition(allElements[i + 1]!);
      // DOCUMENT_POSITION_FOLLOWING = 4
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("fetches subtasks for the task", async () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    expect(mockFetch).toHaveBeenCalledWith("/api/tasks/task-1/subtasks");
  });

  it("has a dialog with proper aria attributes", () => {
    render(<SelectedBlockSheet {...defaultSheetProps} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
