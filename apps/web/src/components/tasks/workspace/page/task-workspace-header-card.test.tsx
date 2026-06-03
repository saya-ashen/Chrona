import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskWorkspaceHeaderCard } from "./task-workspace-header-card";
import type { TaskData, TaskHeaderView } from "../model/task-workspace-types";

vi.mock("lucide-react", () => ({
  CalendarDays: () => null,
  Ellipsis: () => null,
  Loader2: () => null,
  Pause: () => null,
  Pencil: () => null,
  Play: () => null,
  Sparkles: () => null,
  Square: () => null,
  Trash2: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <select aria-label="Select occurrence" value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
}));
vi.mock("@/components/tasks/shared", () => ({
  TaskActionsMenu: ({ label }: { label: string }) => <button>{label}</button>,
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

const header = {
  title: task.title,
  canEditTitle: true,
  status: "waiting",
  completedSteps: 0,
  totalSteps: 1,
  progressPercent: 0,
  actions: [],
  primaryActionLabel: null,
  currentNodeId: null,
} satisfies TaskHeaderView;

describe("TaskWorkspaceHeaderCard", () => {
  afterEach(() => cleanup());

  it("does not show stale Draft persistence state beside the user-facing status", () => {
    render(
      <TaskWorkspaceHeaderCard
        task={task}
        header={header}
        backToScheduleLabel="Back to schedule"
        onAction={vi.fn()}
        onSelectOccurrence={vi.fn()}
        onEdit={vi.fn()}
        showDeleteConfirm={false}
        isDeleting={false}
        onStartDeleteConfirm={vi.fn()}
        onCancelDeleteConfirm={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("shows the selected occurrence window", () => {
    render(
      <TaskWorkspaceHeaderCard
        task={task}
        header={header}
        backToScheduleLabel="Back to schedule"
        onAction={vi.fn()}
        onEdit={vi.fn()}
        onSelectOccurrence={vi.fn()}
        showDeleteConfirm={false}
        isDeleting={false}
        onStartDeleteConfirm={vi.fn()}
        onCancelDeleteConfirm={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Occurrence")).toBeInTheDocument();
    expect(screen.getAllByText(/May 27/).length).toBeGreaterThan(0);
  });

  it("switches to another recurrence occurrence", () => {
    const onSelectOccurrence = vi.fn();
    const recurringTask = {
      ...task,
      recurrenceOccurrences: [
        {
          taskId: "task-1",
          title: "Scheduled draft task",
          status: "Scheduled",
          scheduledStartAt: "2026-05-27T04:30:00.000Z",
          scheduledEndAt: "2026-05-27T05:30:00.000Z",
          workBlockId: "block-1",
          isCurrent: true,
        },
        {
          taskId: "task-2",
          title: "Scheduled draft task",
          status: "Scheduled",
          scheduledStartAt: "2026-05-28T04:30:00.000Z",
          scheduledEndAt: "2026-05-28T05:30:00.000Z",
          workBlockId: "block-2",
          isCurrent: false,
        },
      ],
    } satisfies TaskData;


    render(
      <TaskWorkspaceHeaderCard
        task={recurringTask}
        header={header}
        backToScheduleLabel="Back to schedule"
        onAction={vi.fn()}
        onSelectOccurrence={onSelectOccurrence}
        onEdit={vi.fn()}
        showDeleteConfirm={false}
        isDeleting={false}
        onStartDeleteConfirm={vi.fn()}
        onCancelDeleteConfirm={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Select occurrence"), { target: { value: "task-2:block-2" } });

    expect(onSelectOccurrence).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-2", workBlockId: "block-2" }));
  });
});
