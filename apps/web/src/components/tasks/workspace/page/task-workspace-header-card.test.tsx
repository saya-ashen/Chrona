import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStateStore } from "@json-render/core";
import { buildTaskHeaderSpec } from "@chrona/ui-protocol";
import { TaskWorkspaceHeaderCard } from "./task-workspace-header-card";
import type { TaskData } from "../model/task-workspace-types";

type ChildrenProps = { children?: React.ReactNode };

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ChildrenProps & React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: ChildrenProps) => <div>{children}</div>,
  DialogContent: ({ children }: ChildrenProps) => <div>{children}</div>,
  DialogDescription: ({ children }: ChildrenProps) => <p>{children}</p>,
  DialogFooter: ({ children }: ChildrenProps) => <div>{children}</div>,
  DialogHeader: ({ children }: ChildrenProps) => <div>{children}</div>,
  DialogTitle: ({ children }: ChildrenProps) => <h2>{children}</h2>,
}));

const task = {
  id: "task-1",
  workspaceId: "ws-1",
  title: "Scheduled draft task",
  description: null,
  executionRuntime: "hermes",
  executionConfig: {},
  autoPlanGeneration: false,
  autoExecute: false,
  autoPlanGenerationTiming: "at_start",
  autoExecuteTiming: "at_start",
  status: "Draft",
  priority: "Medium",
  dueAt: null,
  scheduledStartAt: "2026-05-27T04:30:00.000Z",
  scheduledEndAt: "2026-05-27T05:30:00.000Z",
  scheduleStatus: "Scheduled",
  scheduleSource: "human",
  isRunnable: true,
  runnabilitySummary: "Ready to run",
  runnabilityState: "ready_to_run",
  savedPlan: null,
  executionSummary: null,
  graphNodeStates: [],
  aiPlanGenerationStatus: "accepted",
  blockReason: null,
  dependencies: [],
} satisfies TaskData;

function renderHeader(spec = buildTaskHeaderSpec({
  title: task.title,
  status: "waiting",
  statusLabel: "Waiting",
  progressLabel: "1 steps · 0 accepted · 0%",
  priorityLabel: "Medium",
  occurrenceLabel: "Occurrence · Wed, May 27 04:30 AM-05:30 AM",
  actions: [{ id: "edit", label: "Edit" }, { id: "delete", label: "Delete Task" }],
})) {
  return render(
    <TaskWorkspaceHeaderCard
      task={task}
      spec={spec}
      store={createStateStore(spec.state ?? {})}
      onAction={vi.fn()}
      onAcceptPlan={vi.fn()}
      onGeneratePlan={vi.fn()}
      onEdit={vi.fn()}
      showDeleteConfirm={false}
      isDeleting={false}
      onStartDeleteConfirm={vi.fn()}
      onCancelDeleteConfirm={vi.fn()}
      onDelete={vi.fn()}
      onRecoveryRetry={vi.fn()}
      onRecoveryEditInstruction={vi.fn()}
      onRecoveryCancel={vi.fn()}
    />,
  );
}

describe("TaskWorkspaceHeaderCard", () => {
  afterEach(() => cleanup());

  it("renders server-provided status without stale persisted task state", () => {
    renderHeader();

    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("renders one server-provided execution status", () => {
    renderHeader(buildTaskHeaderSpec({
      title: task.title,
      status: "running",
      statusLabel: "Running",
      progressLabel: "1 steps · 0 accepted · 0%",
      priorityLabel: "Medium",
      actions: [{ id: "pause", label: "Pause" }, { id: "stop", label: "Stop" }],
    }));

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("Running now")).not.toBeInTheDocument();
  });

  it("renders server-provided occurrence label", () => {
    renderHeader();

    expect(screen.getByText(/Occurrence ·/)).toBeInTheDocument();
    expect(screen.getByText(/May 27/)).toBeInTheDocument();
  });
});
