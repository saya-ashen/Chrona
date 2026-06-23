import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ messages: {} }),
  useLocale: () => "en",
}));

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

import { DayTimeline } from "@/components/schedule/timeline/schedule-page-timeline";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

function createScheduledItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    taskId: overrides.taskId ?? "task-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    title: overrides.title ?? "Task",
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
    sourceManaged: overrides.sourceManaged ?? null,
    autoStartEligible: overrides.autoStartEligible,
    autoStartReason: overrides.autoStartReason,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DayTimeline", () => {
  it("shows a normal placement preview when a dragged block overlaps an existing scheduled block", async () => {
    render(
      <DayTimeline
        items={[createScheduledItem()]}
        dayDate={new Date(2026, 3, 15, 0, 0, 0, 0)}
        selectedDay="2026-04-15"
        draggedItem={{
          kind: "queue",
          taskId: "queue-1",
          title: "Dragged task",
          dueAt: null,
          durationMinutes: 60,
        }}
        executionRuntimes={[]}
        defaultExecutionRuntime="hermes"
        isPending={false}
        onScheduleDrop={vi.fn().mockResolvedValue(undefined)}
        onCreateTaskBlock={vi.fn().mockResolvedValue(undefined)}
        onScheduledDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    const dropZone = screen.getByRole("region", { name: /schedule drop zone/i });
    fireEvent.dragOver(dropZone, {
      clientY: 36,
      dataTransfer: { dropEffect: "move" },
    });

    await waitFor(() => {
      expect(screen.getByText(/drop to schedule/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/conflict/i)).not.toBeInTheDocument();
  });

  it("shows a current-time marker when the selected day is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15, 9, 45, 0, 0));

    render(
      <DayTimeline
        items={[createScheduledItem()]}
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

    expect(screen.getByLabelText(/current time/i)).toBeInTheDocument();
  });

  it("does not show a current-time marker for a non-today day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15, 9, 45, 0, 0));

    render(
      <DayTimeline
        items={[createScheduledItem()]}
        dayDate={new Date(2026, 3, 16, 0, 0, 0, 0)}
        selectedDay="2026-04-16"
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

    expect(screen.queryByLabelText(/current time/i)).not.toBeInTheDocument();
  });

  it("marks source-managed calendar tasks with source name and color", async () => {
    const { container } = render(
      <DayTimeline
        items={[
          createScheduledItem({
            title: "Synced calendar task",
            sourceManaged: {
              source: "external_calendar",
              eventId: "event-1",
              sourceName: "Product Calendar",
              sourceColor: "#0f766e",
              description: "Imported event",
              immutableFields: ["title", "scheduledStartAt", "scheduledEndAt"],
            },
          }),
        ]}
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

    await waitFor(() => {
      expect(screen.getAllByText("Product Calendar").length).toBeGreaterThan(0);
    });
    const taskLink = screen.getByRole("link", {
      name: /Synced calendar task.*Product Calendar.*Read-only/i,
    });
    expect(taskLink).toBeInTheDocument();
    const sourceCard = Array.from(container.querySelectorAll("[style]")).find(
      (element): element is HTMLDivElement =>
        element instanceof HTMLDivElement &&
        ["#0f766e", "rgb(15, 118, 110)"].includes(element.style.borderColor),
    );
    expect(sourceCard).toHaveStyle({
      borderColor: "#0f766e",
    });
  });

  it("resizes a scheduled block from its end handle and commits the new end time", async () => {
    const onScheduleDrop = vi.fn().mockResolvedValue(undefined);

    render(
      <DayTimeline
        items={[createScheduledItem({ title: "Resizable task" })]}
        dayDate={new Date(2026, 3, 15, 0, 0, 0, 0)}
        selectedDay="2026-04-15"
        draggedItem={null}
        executionRuntimes={[]}
        defaultExecutionRuntime="hermes"
        isPending={false}
        onScheduleDrop={onScheduleDrop}
        onCreateTaskBlock={vi.fn().mockResolvedValue(undefined)}
        onScheduledDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    const dropZone = screen.getByRole("region", { name: /schedule drop zone/i });
    vi.spyOn(dropZone, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 578,
      width: 800,
      height: 578,
      toJSON: () => ({}),
    });

    const handle = screen.getByRole("button", { name: /resize resizable task/i });
    fireEvent.mouseDown(handle, { clientY: 270 });
    fireEvent.mouseMove(window, { clientY: 281 });
    fireEvent.mouseUp(window, { clientY: 281 });

    expect(onScheduleDrop).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", kind: "scheduled" }),
      new Date(2026, 3, 15, 9, 0, 0, 0),
      new Date(2026, 3, 15, 9, 30, 0, 0),
    );
  });

  it("nudges the selected scheduled block down by one slot when ArrowDown is pressed", async () => {
    const onScheduleDrop = vi.fn().mockResolvedValue(undefined);

    render(
      <DayTimeline
        items={[createScheduledItem({ title: "Keyboard task" })]}
        dayDate={new Date(2026, 3, 15, 0, 0, 0, 0)}
        selectedDay="2026-04-15"
        selectedTaskId="task-1"
        draggedItem={null}
        executionRuntimes={[]}
        defaultExecutionRuntime="hermes"
        isPending={false}
        onScheduleDrop={onScheduleDrop}
        onCreateTaskBlock={vi.fn().mockResolvedValue(undefined)}
        onScheduledDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    const block = screen.getByRole("link", { name: /keyboard task/i });
    fireEvent.keyDown(block, { key: "ArrowDown" });

    expect(onScheduleDrop).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", kind: "scheduled" }),
      new Date(2026, 3, 15, 9, 30, 0, 0),
      new Date(2026, 3, 15, 10, 30, 0, 0),
    );
  });

  it("commits a keyboard nudge even when the adjusted slot overlaps another block", async () => {
    const onScheduleDrop = vi.fn().mockResolvedValue(undefined);

    render(
      <DayTimeline
        items={[
          createScheduledItem({
            taskId: "task-1",
            title: "Selected task",
            scheduledStartAt: new Date(2026, 3, 15, 9, 0, 0, 0),
            scheduledEndAt: new Date(2026, 3, 15, 10, 0, 0, 0),
          }),
          createScheduledItem({
            taskId: "task-2",
            title: "Blocking task",
            scheduledStartAt: new Date(2026, 3, 15, 10, 0, 0, 0),
            scheduledEndAt: new Date(2026, 3, 15, 11, 0, 0, 0),
          }),
        ]}
        dayDate={new Date(2026, 3, 15, 0, 0, 0, 0)}
        selectedDay="2026-04-15"
        selectedTaskId="task-1"
        draggedItem={null}
        executionRuntimes={[]}
        defaultExecutionRuntime="hermes"
        isPending={false}
        onScheduleDrop={onScheduleDrop}
        onCreateTaskBlock={vi.fn().mockResolvedValue(undefined)}
        onScheduledDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    const block = screen.getByRole("link", { name: /selected task/i });
    fireEvent.keyDown(block, { key: "ArrowDown" });

    expect(onScheduleDrop).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", kind: "scheduled" }),
      new Date(2026, 3, 15, 9, 30, 0, 0),
      new Date(2026, 3, 15, 10, 30, 0, 0),
    );
  });

  const autoStartReasonCases: Array<{ reason: string; copy: RegExp }> = [
    { reason: "no_accepted_plan", copy: /No accepted plan/i },
    { reason: "no_runtime_config", copy: /No execution runtime configured/i },
    { reason: "invalid_task_status", copy: /Task status can't auto-start/i },
    { reason: "already_running", copy: /Already running/i },
    { reason: "requires_human_input", copy: /Waiting for your input/i },
    { reason: "requires_approval", copy: /Waiting for approval/i },
    { reason: "runtime_unsupported", copy: /Runtime doesn't support auto-start/i },
    { reason: "not_scheduled", copy: /Not on a schedule block yet/i },
  ];

  for (const { reason, copy } of autoStartReasonCases) {
    it(`shows mapped auto-start copy for ${reason}`, async () => {
      render(
        <DayTimeline
          items={[
            createScheduledItem({
              title: "Auto-start blocked task",
              autoStartEligible: false,
              autoStartReason: reason,
            }),
          ]}
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

      await waitFor(() => {
        expect(screen.getByText(copy)).toBeInTheDocument();
      });
    });
  }

  it("suppresses the not_due auto-start reason from the timeline card", async () => {
    render(
      <DayTimeline
        items={[
          createScheduledItem({
            title: "Future block",
            autoStartEligible: false,
            autoStartReason: "not_due",
          }),
        ]}
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

    await waitFor(() => {
      expect(screen.getAllByText(/Future block/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Scheduled, not due yet/i)).not.toBeInTheDocument();
  });

  it("does not show an auto-start reason when the block is eligible", async () => {
    render(
      <DayTimeline
        items={[
          createScheduledItem({
            title: "Eligible block",
            autoStartEligible: true,
            autoStartReason: null,
          }),
        ]}
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

    await waitFor(() => {
      expect(screen.getAllByText(/Eligible block/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/No accepted plan/i)).not.toBeInTheDocument();
  });
});
