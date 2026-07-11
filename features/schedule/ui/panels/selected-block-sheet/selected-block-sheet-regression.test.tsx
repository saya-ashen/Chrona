import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SelectedBlockSheet } from "./selected-block-sheet";
import type { ScheduleRecord } from "../../schedule-page-types";
import type { TaskConfigExecutionRuntime } from "../../forms/task-config-form";

vi.mock("@chrona/i18n/react", async () => {
  const { fallbackMessages } = await import("@chrona/i18n/messages");
  return {
    useI18n: () => ({ messages: fallbackMessages, t: (key: string) => key }),
    useLocale: () => "en",
  };
});

vi.mock("@/components/tasks/shared/task-context-links", () => ({
  TaskContextLinks: ({ taskId }: { taskId: string }) => <a href={`/en/tasks/${taskId}`}>Open task workspace</a>,
}));

vi.mock("./use-selected-block-plan-state", () => ({
  useSelectedBlockPlanState: () => ({
    displayedSavedPlan: null,
    generationStatus: "idle",
    acceptedPlan: null,
    handlePlanLoaded: vi.fn(),
    handleApplyPlan: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("./use-selected-block-config-state", () => ({
  useSelectedBlockConfigState: ({ item, onSaveTaskConfigAction }: {
    item: ScheduleRecord;
    onSaveTaskConfigAction: (taskId: string, input: unknown) => Promise<void> | void;
  }) => ({
    planningTaskDraft: {
      title: item.title,
      description: item.description ?? "",
      priority: item.priority,
      dueAt: item.dueAt,
      scheduledStartAt: item.scheduledStartAt,
      scheduledEndAt: item.scheduledEndAt,
    },
    taskConfigDraftState: null,
    handleTaskConfigDraftStateChange: vi.fn(),
    saveTaskConfig: (input: unknown) => onSaveTaskConfigAction(item.taskId, input),
    saveConfigBeforeRegenerate: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("./selected-block-main-column", () => ({
  SelectedBlockMainColumn: ({ item, onSaveTaskConfig }: {
    item: ScheduleRecord;
    onSaveTaskConfig: (input: unknown) => Promise<void> | void;
  }) => (
    <section aria-label="Selected block content">
      <label htmlFor="selected-block-title">Title</label>
      <input id="selected-block-title" defaultValue={item.title} />
      <button
        type="button"
        onClick={() => onSaveTaskConfig({
          title: (document.getElementById("selected-block-title") as HTMLInputElement).value,
          executionRuntime: item.executionRuntime,
        })}
      >
        Save task config
      </button>
    </section>
  ),
}));

afterEach(() => {
  cleanup();
});

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
}

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => undefined;
}

if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => undefined;
}

const runtimes: TaskConfigExecutionRuntime[] = [{
  key: "hermes",
  label: "Hermes",
  spec: {
    runtime: "hermes",
    version: "hermes-v1",
    fields: [],
    runnability: { requiredPaths: [] },
  },
}];

function item(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    taskId: "task-1",
    workspaceId: "workspace-1",
    title: "Selected scheduled task",
    description: "Keep this block selected while editing config.",
    priority: "High",
    persistedStatus: "Ready",
    displayState: "Ready",
    actionRequired: null,
    approvalPendingCount: 0,
    scheduleStatus: "Scheduled",
    scheduleSource: "manual",
    dueAt: new Date("2026-05-28T12:00:00.000Z"),
    scheduledStartAt: new Date("2026-05-28T09:00:00.000Z"),
    scheduledEndAt: new Date("2026-05-28T10:00:00.000Z"),
    latestRunStatus: null,
    scheduleProposalCount: 0,
    lastActivityAt: null,
    autoPlanGeneration: false,
    autoExecute: false,
    autoPlanGenerationTiming: "at_start",
    autoExecuteTiming: "at_start",
    parentTaskId: null,
    executionRuntime: "hermes",
    executionConfig: {},
    isRunnable: true,
    runnabilityState: "ready",
    runnabilitySummary: "Ready to run",
    ...overrides,
  };
}

describe("SelectedBlockSheet regressions", () => {
  it("keeps the selected block sheet open after submitting task config", () => {
    const onClose = vi.fn();
    const onSaveTaskConfigAction = vi.fn().mockResolvedValue(undefined);

    render(
      <SelectedBlockSheet
        item={item()}
        selectedDay="2026-05-28"
        executionRuntimes={runtimes}
        defaultExecutionRuntime="hermes"
        isPending={false}
        onClose={onClose}
        onSaveTaskConfigAction={onSaveTaskConfigAction}
        onMutatedAction={vi.fn().mockResolvedValue(undefined)}
        buildScheduleHref={(day, taskId) => `/en/schedule?day=${day}${taskId ? `&task=${taskId}` : ""}`}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Selected scheduled task" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated scheduled task" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save task config" })[0]);

    expect(onSaveTaskConfigAction).toHaveBeenCalledWith("task-1", expect.objectContaining({
      title: "Updated scheduled task",
      executionRuntime: "hermes",
    }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
