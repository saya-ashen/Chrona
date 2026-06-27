import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStateStore } from "@json-render/core";
import { createHeaderSpecFixture } from "@/components/tasks/workspace/test-support/task-workspace-test-fixtures";
import { TaskWorkspaceHeaderCard } from "../ui/task-workspace-header-card";
import type { TaskData } from "./task-workspace-model";
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
function renderHeader(spec = createHeaderSpecFixture({
  title: task.title,
  priority: "Medium",
  progressLabel: "1 steps · 0 accepted · 0%",
  occurrenceLabel: "Occurrence · Wed, May 27 04:30 AM-05:30 AM",
  actions: [{ id: "edit", label: "Edit" }, { id: "delete", label: "Delete Task" }],
}), state: Record<string, unknown> = {}) {
  const store = createStateStore(spec.state ?? {});
  store.update(state);
  return render(
    <TaskWorkspaceHeaderCard
      task={task}
      spec={spec}
      store={store}
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
    renderHeader(createHeaderSpecFixture({
      title: task.title,
      status: "running",
      priority: "Medium",
      progressLabel: "1 steps · 0 accepted · 0%",
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

  it("shows Accept plan while header state marks generated plan unaccepted", () => {
    renderHeader(undefined, {
      "/execution/show-accept-plan": true,
      "/execution/show-generate-plan": false,
      "/execution/can-start": false,
      "/execution/can-pause": false,
      "/execution/can-stop": false,
    });

    expect(screen.getByRole("button", { name: "Accept plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("switches from Accept plan to enabled Start after accepted-plan state", () => {
    renderHeader(undefined, {
      "/execution/show-accept-plan": false,
      "/execution/show-generate-plan": false,
      "/execution/can-start": true,
      "/execution/start-disabled": false,
      "/execution/start-disabled-reason": null,
      "/execution/can-pause": false,
      "/execution/can-stop": false,
      "/execution/status": "started",
    });

    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeInTheDocument();
    expect(start).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Accept plan" })).not.toBeInTheDocument();
  });

  it("hides Start and shows running controls after post-start state", () => {
    renderHeader(undefined, {
      "/execution/show-accept-plan": false,
      "/execution/show-generate-plan": false,
      "/execution/can-start": false,
      "/execution/can-pause": true,
      "/execution/can-stop": true,
      "/execution/status": "running",
    });

    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });
});
