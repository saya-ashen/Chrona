import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
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

import { DayTimeline } from "@/components/schedule/schedule-page-timeline";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";

function createScheduledItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    taskId: overrides.taskId ?? "task-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    title: overrides.title ?? "Task",
    description: overrides.description ?? null,
    priority: overrides.priority ?? "Medium",
    ownerType: overrides.ownerType ?? "human",
    assigneeAgentId: overrides.assigneeAgentId ?? null,
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
    runtimeAdapterKey: overrides.runtimeAdapterKey ?? "mock",
    runtimeInput: overrides.runtimeInput ?? {},
    runtimeInputVersion: overrides.runtimeInputVersion ?? "1",
    runtimeModel: overrides.runtimeModel ?? null,
    prompt: overrides.prompt ?? null,
    runtimeConfig: overrides.runtimeConfig ?? null,
    isRunnable: overrides.isRunnable ?? true,
    runnabilityState: overrides.runnabilityState ?? "ready",
    runnabilitySummary: overrides.runnabilitySummary ?? "Ready",
    parentTaskId: null,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DayTimeline", () => {
  it("shows a conflict preview when a dragged block overlaps an existing scheduled block", () => {
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
        runtimeAdapters={[]}
        defaultRuntimeAdapterKey="mock"
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

    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
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
        runtimeAdapters={[]}
        defaultRuntimeAdapterKey="mock"
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
        runtimeAdapters={[]}
        defaultRuntimeAdapterKey="mock"
        isPending={false}
        onScheduleDrop={vi.fn().mockResolvedValue(undefined)}
        onCreateTaskBlock={vi.fn().mockResolvedValue(undefined)}
        onScheduledDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/current time/i)).not.toBeInTheDocument();
  });

  it("resizes a scheduled block from its end handle and commits the new end time", async () => {
    const onScheduleDrop = vi.fn().mockResolvedValue(undefined);

    render(
      <DayTimeline
        items={[createScheduledItem({ title: "Resizable task" })]}
        dayDate={new Date(2026, 3, 15, 0, 0, 0, 0)}
        selectedDay="2026-04-15"
        draggedItem={null}
        runtimeAdapters={[]}
        defaultRuntimeAdapterKey="mock"
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
        runtimeAdapters={[]}
        defaultRuntimeAdapterKey="mock"
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

  it("does not commit a keyboard nudge when the adjusted slot conflicts with another block", async () => {
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
        runtimeAdapters={[]}
        defaultRuntimeAdapterKey="mock"
        isPending={false}
        onScheduleDrop={onScheduleDrop}
        onCreateTaskBlock={vi.fn().mockResolvedValue(undefined)}
        onScheduledDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    const block = screen.getByRole("link", { name: /selected task/i });
    fireEvent.keyDown(block, { key: "ArrowDown" });

    expect(onScheduleDrop).not.toHaveBeenCalled();
  });
});
