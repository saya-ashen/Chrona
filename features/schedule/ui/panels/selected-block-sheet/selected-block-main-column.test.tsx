import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCHEDULE_PAGE_COPY } from "../../schedule-page-copy";
import type { ScheduleRecord } from "../../schedule-page-types";
import type { TaskConfigExecutionRuntime } from "../../forms/task-config-form";
import { SelectedBlockMainColumn } from "./selected-block-main-column";

vi.mock("../../forms/task-config-form", () => ({
  TaskConfigForm: () => <form aria-label="Task config" />,
}));

vi.mock("@/components/tasks/panels/task-ai-plan-panel", () => ({
  TaskAiPlanPanel: () => <section aria-label="Task plan" />,
}));

vi.mock("@/components/tasks/panels/task-edit-panel", () => ({
  TaskEditPanel: ({ children }: { children: React.ReactNode }) => <section aria-label="Task edit">{children}</section>,
}));

const runtimes: TaskConfigExecutionRuntime[] = [{
  key: "hermes",
  label: "Hermes runtime",
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
    workBlockId: "block-1",
    workspaceId: "workspace-1",
    title: "Selected scheduled task",
    description: "Inspect selected block.",
    priority: "High",
    persistedStatus: "Ready",
    displayState: "Ready",
    actionRequired: null,
    approvalPendingCount: 0,
    scheduleStatus: "Scheduled",
    scheduleSource: "ai",
    dueAt: new Date("2026-05-28T12:00:00.000Z"),
    scheduledStartAt: new Date("2026-05-28T09:00:00.000Z"),
    scheduledEndAt: new Date("2026-05-28T10:00:00.000Z"),
    latestRunStatus: "WaitingForInput",
    scheduleProposalCount: 0,
    lastActivityAt: null,
    autoPlanGeneration: true,
    autoExecute: false,
    autoPlanGenerationTiming: "at_start",
    autoExecuteTiming: "at_start",
    aiClientId: "client-1",
    parentTaskId: null,
    executionRuntime: "hermes",
    executionConfig: {},
    isRunnable: false,
    runnabilityState: "blocked",
    runnabilitySummary: "Waiting for input",
    stateView: {
      state: "waiting_for_input",
      label: "Waiting for input",
      severity: "warning",
      primaryAction: "provide_input",
      nextActionLabel: "Provide the requested input so execution can continue",
      secondaryActions: ["open_execution"],
      description: "Execution needs user input before it can continue.",
      disabledReason: "Waiting for input",
      source: {
        taskStatus: "WaitingForInput",
        scheduleStatus: "Scheduled",
        planStatus: null,
        executionStatus: "WaitingForInput",
        providerStatus: "WaitingForInput",
        nodeStatus: null,
      },
    },
    ...overrides,
  };
}

function renderMainColumn(record: ScheduleRecord) {
  return render(
    <SelectedBlockMainColumn
      item={record}
      copy={DEFAULT_SCHEDULE_PAGE_COPY}
      executionRuntimes={runtimes}
      defaultExecutionRuntime="hermes"
      availableAiClients={[{ id: "client-1", name: "Local Hermes", enabled: true }]}
      isPending={false}
      planningTaskDraft={{
        title: record.title,
        description: record.description ?? "",
        priority: record.priority as "High",
        dueAt: record.dueAt,
        scheduledStartAt: record.scheduledStartAt,
        scheduledEndAt: record.scheduledEndAt,
      }}
      savedPlan={null}
      generationStatus="idle"
      acceptedPlan={null}
      hasUnsavedConfigChanges={false}
      unsavedConfigDraft={null}
      onTaskConfigDraftStateChange={vi.fn()}
      onSaveTaskConfig={vi.fn().mockResolvedValue(undefined)}
      onPlanLoaded={vi.fn()}
      onApplyPlan={vi.fn().mockResolvedValue(undefined)}
      onSaveConfigBeforeRegenerate={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

afterEach(() => cleanup());

describe("SelectedBlockMainColumn", () => {
  it("shows provider, runtime, execution status, automation, and recovery link", () => {
    renderMainColumn(item());

    expect(screen.getByRole("region", { name: "Block overview" })).toBeInTheDocument();
    expect(screen.getByText("AI scheduled")).toBeInTheDocument();
    expect(screen.getByText("Auto-plan")).toBeInTheDocument();
    expect(screen.getByText("Local Hermes")).toBeInTheDocument();
    expect(screen.getByText("Hermes runtime")).toBeInTheDocument();
    expect(screen.getByText("Waiting for input")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open task workspace to recover this run." }))
      .toHaveAttribute("href", "/tasks/task-1?workBlockId=block-1");
  });

  it("prefers derived state label over raw failed provider status", () => {
    renderMainColumn(item({
      persistedStatus: "Completed",
      displayState: null,
      latestRunStatus: "Failed",
      stateView: {
        state: "result_ready",
        label: "Result ready",
        severity: "success",
        primaryAction: "accept_result",
        nextActionLabel: "Accept result or request changes",
        secondaryActions: [],
        description: "Execution completed successfully.",
        source: {
          taskStatus: "Completed",
          scheduleStatus: "Scheduled",
          planStatus: null,
          executionStatus: null,
          providerStatus: "Failed",
          nodeStatus: null,
        },
      },
    }));

    expect(screen.getByText("Result ready")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("marks external calendar blocks as read-only and calendar sourced", () => {
    renderMainColumn(item({
      scheduleSource: "calendar",
      autoPlanGeneration: false,
      sourceManaged: {
        source: "external_calendar",
        eventId: "event-1",
        sourceName: "Work Calendar",
        sourceColor: "#2563eb",
        description: "Busy event",
        immutableFields: ["title", "scheduledStartAt", "scheduledEndAt"],
      },
    }));

    expect(screen.getByText("External calendar: Work Calendar")).toBeInTheDocument();
    expect(screen.getByText("Read-only calendar block")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });
});
