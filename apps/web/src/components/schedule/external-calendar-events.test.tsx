import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DayTimeline } from "@/components/schedule/timeline/schedule-page-timeline";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import type { PlanningBusyBlock } from "@chrona/domain";

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ messages: {} }),
  useLocale: () => "en",
}));

function createScheduledItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    taskId: overrides.taskId ?? "task-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    title: overrides.title ?? "Existing block",
    description: overrides.description ?? null,
    priority: overrides.priority ?? "Medium",
    persistedStatus: overrides.persistedStatus ?? "Ready",
    displayState: overrides.displayState ?? null,
    actionRequired: overrides.actionRequired ?? null,
    approvalPendingCount: overrides.approvalPendingCount ?? 0,
    scheduleStatus: overrides.scheduleStatus ?? "Scheduled",
    scheduleSource: overrides.scheduleSource ?? "human",
    dueAt: overrides.dueAt ?? null,
    scheduledStartAt: overrides.scheduledStartAt ?? new Date(2026, 3, 15, 9, 0, 0, 0),
    scheduledEndAt: overrides.scheduledEndAt ?? new Date(2026, 3, 15, 10, 0, 0, 0),
    latestRunStatus: overrides.latestRunStatus ?? null,
    scheduleProposalCount: overrides.scheduleProposalCount ?? 0,
    lastActivityAt: overrides.lastActivityAt ?? null,
    executionRuntime: overrides.executionRuntime ?? "hermes",
    executionConfig: overrides.executionConfig ?? {},
    autoPlanGeneration: overrides.autoPlanGeneration ?? false,
    autoExecute: overrides.autoExecute ?? false,
    autoPlanGenerationTiming: overrides.autoPlanGenerationTiming ?? "at_start",
    autoExecuteTiming: overrides.autoExecuteTiming ?? "at_start",
    isRunnable: overrides.isRunnable ?? true,
    runnabilityState: overrides.runnabilityState ?? "ready",
    runnabilitySummary: overrides.runnabilitySummary ?? "Ready",
    parentTaskId: null,
  };
}

function renderTimeline(externalEvents: PlanningBusyBlock[]) {
  render(
    <DayTimeline
      items={[createScheduledItem()]}
      externalEvents={externalEvents}
      dayDate={new Date(2026, 3, 15, 0, 0, 0, 0)}
      selectedDay="2026-04-15"
      draggedItem={null}
      executionRuntimes={[]}
      defaultExecutionRuntime="hermes"
      isPending={false}
      onScheduleDrop={vi.fn().mockResolvedValue(undefined)}
      onCreateTaskBlock={vi.fn().mockResolvedValue(undefined)}
      onScheduledDragStart={vi.fn()}
      onDragEnd={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("external calendar events", () => {
  it("renders imported event title, source label, color marker, and read-only marker", () => {
    renderTimeline([
      {
        id: "event-1",
        calendarSourceId: "source-1",
        sourceName: "Team Calendar",
        sourceColor: "#0f766e",
        title: "Design review",
        startsAt: new Date(2026, 3, 15, 9, 30, 0, 0),
        endsAt: new Date(2026, 3, 15, 10, 0, 0, 0),
        isAllDay: false,
        readOnly: true,
        overlapsScheduledTask: false,
      },
    ]);

    expect(screen.getAllByText("Design review").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Team Calendar/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Read-only/).length).toBeGreaterThan(0);
    expect(document.querySelector('[style*="rgb(15, 118, 110)"]')).toBeTruthy();
  });

  it("distinguishes imported events that overlap scheduled task blocks", () => {
    renderTimeline([
      {
        id: "event-1",
        calendarSourceId: "source-1",
        sourceName: "Team Calendar",
        sourceColor: "#0f766e",
        title: "Overlapping review",
        startsAt: new Date(2026, 3, 15, 9, 30, 0, 0),
        endsAt: new Date(2026, 3, 15, 10, 0, 0, 0),
        isAllDay: false,
        readOnly: true,
        overlapsScheduledTask: true,
      },
    ]);

    expect(screen.getAllByText(/Overlaps task/).length).toBeGreaterThan(0);
  });

  it("keeps external events available in the responsive schedule region", () => {
    renderTimeline([
      {
        id: "event-1",
        calendarSourceId: "source-1",
        sourceName: "Mobile Calendar",
        sourceColor: "#2563eb",
        title: "Mobile standup",
        startsAt: new Date(2026, 3, 15, 11, 0, 0, 0),
        endsAt: new Date(2026, 3, 15, 11, 30, 0, 0),
        isAllDay: false,
        readOnly: true,
        overlapsScheduledTask: false,
      },
    ]);

    expect(screen.getByRole("region", { name: /schedule drop zone/i })).toHaveClass("overflow-hidden");
    expect(screen.getAllByText(/Mobile standup/).length).toBeGreaterThan(0);
  });
});
