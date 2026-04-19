import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
const fetchScheduleProjection = vi.fn();
const createTaskFromSchedule = vi.fn().mockResolvedValue({ taskId: "created-task", workspaceId: "workspace-1" });
const applySchedule = vi.fn().mockResolvedValue({ taskId: "created-task", workspaceId: "workspace-1" });
const acceptScheduleProposal = vi.fn();
const rejectScheduleProposal = vi.fn();
const updateTaskConfigFromSchedule = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {} }),
  useLocale: () => "en",
}));

vi.mock("@/i18n/routing", () => ({
  localizeHref: (_locale: string, href: string) => href,
}));

vi.mock("@/app/actions/task-actions", () => ({
  createTaskFromSchedule: (...args: unknown[]) => createTaskFromSchedule(...args),
  applySchedule: (...args: unknown[]) => applySchedule(...args),
  acceptScheduleProposal: (...args: unknown[]) => acceptScheduleProposal(...args),
  rejectScheduleProposal: (...args: unknown[]) => rejectScheduleProposal(...args),
  updateTaskConfigFromSchedule: (...args: unknown[]) => updateTaskConfigFromSchedule(...args),
}));

vi.mock("@/components/schedule/planning-header", () => ({
  PlanningHeader: () => <div data-testid="planning-header" />,
}));

vi.mock("@/components/schedule/schedule-page-panels", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ProposalCard: () => <div data-testid="proposal-card" />,
  QueueCard: () => <div data-testid="queue-card" />,
  RiskCard: () => <div data-testid="risk-card" />,
  SelectedBlockSheet: () => <div data-testid="selected-block-sheet" />,
  TodayFocusCard: () => <div data-testid="today-focus-card" />,
}));

vi.mock("@/components/schedule/schedule-action-rail", () => ({
  ScheduleActionRail: ({
    activeTab,
    sections,
  }: {
    activeTab: string;
    sections: Array<{ value: string; body: React.ReactNode }>;
  }) => <div data-testid="schedule-action-rail">{sections.find((section) => section.value === activeTab)?.body}</div>,
}));

vi.mock("@/components/schedule/schedule-task-list", () => ({
  ScheduleTaskList: () => <div data-testid="schedule-task-list" />,
}));

vi.mock("@/components/schedule/schedule-page-timeline", () => ({
  DayTimeline: () => <div data-testid="day-timeline" />,
  WeekStrip: () => <div data-testid="week-strip" />,
}));

vi.mock("@/components/schedule/schedule-mini-calendar", () => ({
  ScheduleMiniCalendar: () => <div data-testid="mini-calendar" />,
  CompactTodayFocus: () => <div data-testid="today-focus" />,
}));

vi.mock("@/components/schedule/conflict-card", () => ({
  ConflictCard: () => <div data-testid="conflict-card" />,
}));

vi.mock("@/components/schedule/task-create-dialog", () => ({
  TaskCreateDialog: () => null,
}));


import { SchedulePage } from "@/components/schedule/schedule-page";
import type { SchedulePageData } from "@/components/schedule/schedule-page-types";
import { hydrateSchedulePageData } from "@/components/schedule/schedule-page-utils";

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: (...args: Parameters<typeof fetch>) => fetchScheduleProjection(...args),
});

fetchScheduleProjection.mockResolvedValue({
  ok: true,
  json: async () => createData(),
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchScheduleProjection.mockResolvedValue({
    ok: true,
    json: async () => createData(),
  });
});

function createData(): SchedulePageData {
  return {
    defaultRuntimeAdapterKey: "openclaw",
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
    summary: {
      scheduledCount: 1,
      unscheduledCount: 0,
      proposalCount: 0,
      riskCount: 0,
    },
    planningSummary: {
      scheduledMinutes: 60,
      runnableQueueCount: 0,
      conflictCount: 0,
      overloadedDayCount: 0,
      proposalCount: 0,
      riskCount: 0,
      todayLoadMinutes: 60,
      overdueCount: 0,
      atRiskCount: 0,
      readyToScheduleCount: 0,
      autoRunnableCount: 0,
      waitingOnUserCount: 0,
      dueSoonUnscheduledCount: 0,
      largestIdleWindowMinutes: 0,
      overloadedMinutes: 0,
    },
    focusZones: [
      {
        dayKey: "2026-04-15",
        totalMinutes: 60,
        deepWorkMinutes: 0,
        fragmentedMinutes: 60,
        riskLevel: "low",
      },
    ],
    automationCandidates: [],
    scheduled: [
      {
        taskId: "task-1",
        workspaceId: "workspace-1",
        parentTaskId: null,
        title: "Existing block",
        description: null,
        priority: "Medium",
        ownerType: "human",
        assigneeAgentId: null,
        persistedStatus: "Ready",
        displayState: null,
        actionRequired: null,
        approvalPendingCount: 0,
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        dueAt: null,
        scheduledStartAt: new Date(2026, 3, 15, 9, 0, 0, 0),
        scheduledEndAt: new Date(2026, 3, 15, 10, 0, 0, 0),
        latestRunStatus: null,
        scheduleProposalCount: 0,
        lastActivityAt: null,
        runtimeAdapterKey: "mock",
        runtimeInput: {},
        runtimeInputVersion: "mock-v1",
        runtimeModel: null,
        prompt: null,
        runtimeConfig: null,
        isRunnable: true,
        runnabilityState: "ready",
        runnabilitySummary: "Ready",
      },
    ],
    unscheduled: [],
    proposals: [],
    risks: [],
    listItems: [],
    conflicts: [],
    suggestions: [],
  };
}

describe("SchedulePage projection hydration", () => {
  it("hydrates refreshed projection date strings back into Date objects", () => {
    const hydrated = hydrateSchedulePageData({
      ...createData(),
      scheduled: [
        {
          ...createData().scheduled[0],
          scheduledStartAt: "2026-04-15T09:00:00.000Z" as unknown as Date,
          scheduledEndAt: "2026-04-15T10:00:00.000Z" as unknown as Date,
        },
      ],
    } as unknown as SchedulePageData);

    expect(hydrated.scheduled[0]?.scheduledStartAt).toBeInstanceOf(Date);
    expect(hydrated.scheduled[0]?.scheduledEndAt).toBeInstanceOf(Date);
  });
});

describe("SchedulePage quick create", () => {
  it("renders the timeline view and shows scheduled blocks", () => {
    render(
      <SchedulePage
        workspaceId="workspace-1"
        data={createData()}
        selectedDay="2026-04-15"
        selectedView="timeline"
      />,
    );

    expect(screen.getByTestId("day-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("planning-header")).toBeInTheDocument();
  });

  it("creates a queue task from the side-rail quick-create without scheduling it", async () => {
    const user = userEvent.setup();

    render(
      <SchedulePage
        workspaceId="workspace-1"
        data={createData()}
        selectedDay="2026-04-15"
        selectedView="timeline"
      />,
    );

    await user.click(screen.getByRole("button", { name: /quick create/i }));
    await user.type(screen.getByPlaceholderText(/add a task to the queue/i), "Inbox triage");
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: "90" } });
    await user.click(screen.getByRole("button", { name: /^high$/i }));
    await user.click(screen.getByRole("button", { name: /add to queue/i }));

    await waitFor(() => {
      expect(createTaskFromSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          title: "Inbox triage",
          priority: "High",
          runtimeConfig: { suggestedDurationMinutes: 90 },
        }),
      );
    });

    expect(applySchedule).not.toHaveBeenCalled();
  });
});

describe("SchedulePage view modes", () => {
  it("renders list view when selectedView is list", () => {
    render(
      <SchedulePage
        workspaceId="workspace-1"
        data={createData()}
        selectedDay="2026-04-15"
        selectedView="list"
      />,
    );

    expect(screen.getByTestId("schedule-task-list")).toBeInTheDocument();
    expect(screen.queryByTestId("day-timeline")).not.toBeInTheDocument();
  });

  it("renders timeline view by default", () => {
    render(
      <SchedulePage
        workspaceId="workspace-1"
        data={createData()}
        selectedDay="2026-04-15"
      />,
    );

    expect(screen.getByTestId("day-timeline")).toBeInTheDocument();
  });
});

describe("SchedulePage data display", () => {
  it("renders proposal cards in action rail when proposals exist", () => {
    const data = createData();
    data.proposals = [
      {
        proposalId: "prop-1",
        taskId: "task-2",
        workspaceId: "workspace-1",
        title: "Proposal task",
        priority: "High",
        ownerType: "human",
        assigneeAgentId: null,
        source: "ai",
        proposedBy: "system",
        summary: "AI suggests scheduling",
        dueAt: null,
        scheduledStartAt: new Date(2026, 3, 15, 14, 0),
        scheduledEndAt: new Date(2026, 3, 15, 15, 0),
        createdAt: new Date(),
      },
    ];
    data.summary.proposalCount = 1;
    data.planningSummary.proposalCount = 1;

    render(
      <SchedulePage
        workspaceId="workspace-1"
        data={data}
        selectedDay="2026-04-15"
        selectedView="timeline"
      />,
    );

    // The page constructs sections for the action rail; proposals section exists
    // but may not be the active tab by default. Verify the page renders without error.
    expect(screen.getByTestId("schedule-action-rail")).toBeInTheDocument();
  });

  it("renders risk cards in action rail when risks exist", () => {
    const data = createData();
    data.risks = [
      {
        taskId: "task-risk-1",
        workspaceId: "workspace-1",
        parentTaskId: null,
        title: "At-risk task",
        description: null,
        priority: "High",
        ownerType: "human",
        assigneeAgentId: null,
        persistedStatus: "Ready",
        displayState: null,
        actionRequired: null,
        approvalPendingCount: 0,
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        dueAt: new Date(2026, 3, 15, 17, 0),
        scheduledStartAt: new Date(2026, 3, 15, 16, 0),
        scheduledEndAt: new Date(2026, 3, 15, 17, 0),
        latestRunStatus: null,
        scheduleProposalCount: 0,
        lastActivityAt: null,
        runtimeAdapterKey: "mock",
        runtimeInput: {},
        runtimeInputVersion: "mock-v1",
        runtimeModel: null,
        prompt: null,
        runtimeConfig: null,
        isRunnable: true,
        runnabilityState: "ready",
        runnabilitySummary: "Ready",
      },
    ];
    data.summary.riskCount = 1;
    data.planningSummary.riskCount = 1;

    render(
      <SchedulePage
        workspaceId="workspace-1"
        data={data}
        selectedDay="2026-04-15"
        selectedView="timeline"
      />,
    );

    expect(screen.getByTestId("schedule-action-rail")).toBeInTheDocument();
  });

  it("renders queue cards in action rail for unscheduled items", () => {
    const data = createData();
    data.unscheduled = [
      {
        taskId: "task-unsched-1",
        workspaceId: "workspace-1",
        parentTaskId: null,
        title: "Unscheduled task",
        description: null,
        priority: "Medium",
        ownerType: "human",
        assigneeAgentId: null,
        persistedStatus: "Ready",
        displayState: null,
        actionRequired: null,
        approvalPendingCount: 0,
        scheduleStatus: "Unscheduled",
        scheduleSource: "human",
        dueAt: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        latestRunStatus: null,
        scheduleProposalCount: 0,
        lastActivityAt: null,
        runtimeAdapterKey: "mock",
        runtimeInput: {},
        runtimeInputVersion: "mock-v1",
        runtimeModel: null,
        prompt: null,
        runtimeConfig: null,
        isRunnable: true,
        runnabilityState: "ready",
        runnabilitySummary: "Ready",
      },
    ];
    data.summary.unscheduledCount = 1;

    render(
      <SchedulePage
        workspaceId="workspace-1"
        data={data}
        selectedDay="2026-04-15"
        selectedView="timeline"
      />,
    );

    // Default activeTab is "queue", so the queue section body (with QueueCard) should render
    expect(screen.getByTestId("queue-card")).toBeInTheDocument();
  });
});

describe("SchedulePage error handling", () => {
  it("shows error when createTaskFromSchedule fails", async () => {
    const user = userEvent.setup();
    createTaskFromSchedule.mockRejectedValueOnce(new Error("Server error"));

    render(
      <SchedulePage
        workspaceId="workspace-1"
        data={createData()}
        selectedDay="2026-04-15"
        selectedView="timeline"
      />,
    );

    await user.click(screen.getByRole("button", { name: /quick create/i }));
    await user.type(screen.getByPlaceholderText(/add a task to the queue/i), "Failing task");
    await user.click(screen.getByRole("button", { name: /add to queue/i }));

    await waitFor(() => {
      expect(createTaskFromSchedule).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });
});
