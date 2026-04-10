import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, refreshMock, createTaskFromScheduleMock, updateTaskConfigFromScheduleMock, applyScheduleMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  createTaskFromScheduleMock: vi.fn(),
  updateTaskConfigFromScheduleMock: vi.fn(),
  applyScheduleMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

vi.mock("@/app/actions/task-actions", () => ({
  acceptScheduleProposal: vi.fn().mockResolvedValue(undefined),
  applySchedule: applyScheduleMock,
  clearSchedule: vi.fn().mockResolvedValue(undefined),
  createTaskFromSchedule: createTaskFromScheduleMock,
  rejectScheduleProposal: vi.fn().mockResolvedValue(undefined),
  updateTaskConfigFromSchedule: updateTaskConfigFromScheduleMock,
}));

import { SchedulePage } from "@/components/schedule/schedule-page";
import type { TaskConfigRuntimeAdapter } from "@/components/schedule/task-config-form";

const OPENCLAW_RUNTIME_ADAPTER: TaskConfigRuntimeAdapter = {
  key: "openclaw",
  label: "openclaw",
  spec: {
    adapterKey: "openclaw",
    version: "openclaw-legacy-v1",
        fields: [
          { key: "model", path: "model", label: "Model", kind: "text", constraints: { maxLength: 200 } },
          { key: "prompt", path: "prompt", label: "Prompt / instructions", kind: "textarea", constraints: { maxLength: 20000 } },
          {
            key: "temperature",
            path: "temperature",
            label: "Temperature",
            kind: "number",
        advanced: true,
        defaultValue: 0.2,
        constraints: { min: 0, max: 2, step: 0.1 },
          },
          {
            key: "approvalPolicy",
            path: "approvalPolicy",
            label: "Approval policy",
            kind: "select",
        advanced: true,
        defaultValue: "never",
        options: [
          { label: "Never", value: "never" },
          { label: "On failure", value: "on-failure" },
          { label: "Always", value: "always" },
        ],
          },
          {
            key: "toolMode",
            path: "toolMode",
            label: "Tool mode",
            kind: "select",
        advanced: true,
        defaultValue: "workspace-write",
        options: [
          { label: "Read only", value: "read-only" },
          { label: "Workspace write", value: "workspace-write" },
          { label: "Danger full access", value: "danger-full-access" },
        ],
      },
    ],
    runnability: { requiredPaths: ["model", "prompt"] },
  },
};

function buildBaseData() {
  const scheduled = [
    {
      taskId: "task_scheduled",
      workspaceId: "ws_1",
      title: "Ship projection cleanup",
      description: "Polish the projection layer",
      priority: "High",
      ownerType: "human",
      assigneeAgentId: null,
      persistedStatus: "Ready",
      displayState: null,
      actionRequired: null,
      approvalPendingCount: 0,
      scheduleStatus: "Scheduled",
      scheduleSource: "human",
      dueAt: new Date("2026-04-16T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-16T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-16T11:00:00.000Z"),
      latestRunStatus: null,
      scheduleProposalCount: 0,
      lastActivityAt: new Date("2026-04-16T11:00:00.000Z"),
      runtimeAdapterKey: "openclaw",
      runtimeInputVersion: "openclaw-legacy-v1",
      runtimeInput: {
        model: "gpt-5.4",
        prompt: "Update the projection flow and keep tests green",
        temperature: 0.2,
        approvalPolicy: "never",
        toolMode: "workspace-write",
      },
      runtimeModel: "gpt-5.4",
      prompt: "Update the projection flow and keep tests green",
      runtimeConfig: { temperature: 0.2 },
      isRunnable: true,
      runnabilityState: "ready_to_run",
      runnabilitySummary: "Ready to run",
    },
  ];

  const unscheduled = [
    {
      taskId: "task_unscheduled",
      workspaceId: "ws_1",
      title: "Queue follow-up docs",
      description: "Write the follow-up note",
      priority: "Medium",
      ownerType: "human",
      assigneeAgentId: null,
      persistedStatus: "Ready",
      displayState: null,
      actionRequired: "Schedule task",
      approvalPendingCount: 0,
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: "Unscheduled",
      scheduleSource: null,
      latestRunStatus: null,
      scheduleProposalCount: 1,
      lastActivityAt: new Date("2026-04-16T12:00:00.000Z"),
      runtimeAdapterKey: "openclaw",
      runtimeInputVersion: "openclaw-legacy-v1",
      runtimeInput: {
        temperature: 0.2,
        approvalPolicy: "never",
        toolMode: "workspace-write",
      },
      runtimeModel: null,
      prompt: null,
      runtimeConfig: null,
      isRunnable: false,
      runnabilityState: "missing_model_and_prompt",
      runnabilitySummary: "Needs model and prompt",
    },
  ];

  const risks = [
    {
      taskId: "task_risk",
      workspaceId: "ws_1",
      title: "Recover overdue adapter run",
      description: "Investigate the broken run",
      priority: "Urgent",
      ownerType: "human",
      assigneeAgentId: null,
      persistedStatus: "Blocked",
      displayState: "Attention Needed",
      scheduleStatus: "Overdue",
      scheduleSource: "human",
      actionRequired: "Reschedule task",
      approvalPendingCount: 0,
      latestRunStatus: null,
      dueAt: new Date("2026-04-15T18:00:00.000Z"),
      scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
      scheduleProposalCount: 0,
      lastActivityAt: new Date("2026-04-15T11:00:00.000Z"),
      runtimeAdapterKey: "openclaw",
      runtimeInputVersion: "openclaw-legacy-v1",
      runtimeInput: {
        model: "gpt-5.4",
        prompt: "Recover the run and summarize the issue",
        approvalPolicy: "never",
        toolMode: "workspace-write",
      },
      runtimeModel: "gpt-5.4",
      prompt: "Recover the run and summarize the issue",
      runtimeConfig: null,
      isRunnable: true,
      runnabilityState: "ready_to_run",
      runnabilitySummary: "Ready to run",
    },
  ];

  return {
    defaultRuntimeAdapterKey: "openclaw",
    runtimeAdapters: [OPENCLAW_RUNTIME_ADAPTER],
    summary: {
      scheduledCount: 1,
      unscheduledCount: 1,
      proposalCount: 1,
      riskCount: 1,
    },
    scheduled,
    unscheduled,
    proposals: [
      {
        proposalId: "proposal_1",
        taskId: "task_unscheduled",
        workspaceId: "ws_1",
        title: "Queue follow-up docs",
        priority: "Medium",
        ownerType: "human",
        assigneeAgentId: null,
        source: "ai",
        proposedBy: "planner-agent",
        summary: "Plan this for tomorrow morning",
        dueAt: new Date("2026-04-17T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-17T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-17T10:30:00.000Z"),
      },
    ],
    risks,
    listItems: [...scheduled, ...unscheduled, ...risks],
  };
}

describe("SchedulePage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    createTaskFromScheduleMock.mockReset();
    updateTaskConfigFromScheduleMock.mockReset();
    applyScheduleMock.mockReset();
  });

  it("renders the schedule planning sections with a dedicated queue rail", () => {
    createTaskFromScheduleMock.mockResolvedValue({ taskId: "task_created", workspaceId: "ws_1" });
    applyScheduleMock.mockResolvedValue(undefined);

    render(
      <SchedulePage workspaceId="ws_1" selectedDay="2026-04-16" selectedTaskId="task_scheduled" data={buildBaseData()} />,
    );

    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today Focus" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scheduled Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unscheduled Queue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conflicts / Overdue Risks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI Proposals" })).toBeInTheDocument();
    expect(screen.getByText("Keep recovery work visible without crowding the queue rail.")).toBeInTheDocument();
    expect(screen.getByText("Review suggestions near the timeline, not inside the queue rail.")).toBeInTheDocument();
    expect(screen.getByText("Planning Guide")).toBeInTheDocument();
    expect(screen.getByText("Secondary planning info")).toBeInTheDocument();
    expect(screen.getAllByText("Ship projection cleanup").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Create Task Block").length).toBeGreaterThan(0);
    expect(screen.getByText("Click any slot or drag to adjust")).toBeInTheDocument();
    expect(screen.getByText(/quiet hours compressed/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Task Details" })).toBeInTheDocument();
    expect(screen.getAllByText("Queue follow-up docs")).toHaveLength(2);
    expect(screen.getAllByText("Ready to run").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs model and prompt")).toBeInTheDocument();
    expect(screen.getAllByText("Recover overdue adapter run").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Planning surface")).toBeInTheDocument();
    expect(screen.queryByText("Pending proposals")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByLabelText("Drag Queue follow-up docs to the timeline")
        .some((element) => element.getAttribute("draggable") === "true"),
    ).toBe(true);
    expect(screen.getByRole("region", { name: /Schedule drop zone for/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute("href", "/en/schedule?day=2026-04-16");
    expect(
      screen
        .getAllByRole("link", { name: "Open Workbench" })
        .some((link) => link.getAttribute("href") === "/en/workspaces/ws_1/work/task_scheduled"),
    ).toBe(true);
  });

  it("keeps the timeline visible even when no tasks are scheduled", () => {
    createTaskFromScheduleMock.mockResolvedValue({ taskId: "task_created", workspaceId: "ws_1" });
    applyScheduleMock.mockResolvedValue(undefined);

    render(
      <SchedulePage
        workspaceId="ws_1"
        selectedDay="2026-04-18"
        data={{
          summary: {
            scheduledCount: 0,
            unscheduledCount: 1,
            proposalCount: 0,
            riskCount: 0,
          },
          defaultRuntimeAdapterKey: "openclaw",
          runtimeAdapters: [OPENCLAW_RUNTIME_ADAPTER],
          scheduled: [],
          unscheduled: [
            {
              taskId: "task_unscheduled",
              workspaceId: "ws_1",
              title: "Queue follow-up docs",
              description: "Write the follow-up note",
              priority: "Medium",
              ownerType: "human",
              assigneeAgentId: null,
              persistedStatus: "Ready",
              displayState: null,
              actionRequired: "Schedule task",
              approvalPendingCount: 0,
              dueAt: null,
              scheduledStartAt: null,
              scheduledEndAt: null,
              scheduleStatus: "Unscheduled",
              scheduleSource: null,
              latestRunStatus: null,
              scheduleProposalCount: 0,
              lastActivityAt: new Date("2026-04-18T09:00:00.000Z"),
              runtimeAdapterKey: "openclaw",
              runtimeInputVersion: "openclaw-legacy-v1",
              runtimeInput: {
                temperature: 0.2,
                approvalPolicy: "never",
                toolMode: "workspace-write",
              },
              runtimeModel: null,
              prompt: null,
              runtimeConfig: null,
              isRunnable: false,
              runnabilityState: "missing_model_and_prompt",
              runnabilitySummary: "Needs model and prompt",
            },
          ],
          proposals: [],
          risks: [],
          listItems: [
            {
              taskId: "task_unscheduled",
              workspaceId: "ws_1",
              title: "Queue follow-up docs",
              description: "Write the follow-up note",
              priority: "Medium",
              ownerType: "human",
              assigneeAgentId: null,
              persistedStatus: "Ready",
              displayState: null,
              actionRequired: "Schedule task",
              approvalPendingCount: 0,
              dueAt: null,
              scheduledStartAt: null,
              scheduledEndAt: null,
              scheduleStatus: "Unscheduled",
              scheduleSource: null,
              latestRunStatus: null,
              scheduleProposalCount: 0,
              lastActivityAt: new Date("2026-04-18T09:00:00.000Z"),
              runtimeAdapterKey: "openclaw",
              runtimeInputVersion: "openclaw-legacy-v1",
              runtimeInput: {
                temperature: 0.2,
                approvalPolicy: "never",
                toolMode: "workspace-write",
              },
              runtimeModel: null,
              prompt: null,
              runtimeConfig: null,
              isRunnable: false,
              runnabilityState: "missing_model_and_prompt",
              runnabilitySummary: "Needs model and prompt",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByText("Week Overview").length).toBeGreaterThan(0);
    expect(screen.getByText("Empty day lane")).toBeInTheDocument();
    expect(screen.getByText("Drop a queued task anywhere on this lane to create the first block.")).toBeInTheDocument();
    expect(screen.getAllByText("Create Task Block").length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByLabelText("Drag Queue follow-up docs to the timeline")
        .some((element) => element.getAttribute("draggable") === "true"),
    ).toBe(true);
  });

  it("shows a newly created block immediately on the timeline", async () => {
    createTaskFromScheduleMock.mockResolvedValue({ taskId: "task_created", workspaceId: "ws_1" });
    applyScheduleMock.mockResolvedValue(undefined);

    render(
      <SchedulePage
        workspaceId="ws_1"
        selectedDay="2026-04-18"
        data={{
          summary: {
            scheduledCount: 0,
            unscheduledCount: 0,
            proposalCount: 0,
            riskCount: 0,
          },
          defaultRuntimeAdapterKey: "openclaw",
          runtimeAdapters: [OPENCLAW_RUNTIME_ADAPTER],
          scheduled: [],
          unscheduled: [],
          proposals: [],
          risks: [],
          listItems: [],
        }}
      />,
    );

    fireEvent.click(screen.getAllByText("Create Task Block")[0]);
    const composer = document.querySelector("[data-timeline-composer]") as HTMLElement | null;

    if (!composer) {
      throw new Error("Timeline composer not found");
    }

    fireEvent.change(within(composer).getByLabelText("Title"), { target: { value: "Create timeline task" } });
    fireEvent.change(within(composer).getByLabelText("Model"), { target: { value: "gpt-5.4" } });
    fireEvent.change(within(composer).getByLabelText("Prompt / instructions"), {
      target: { value: "Implement the task and report status" },
    });
    fireEvent.submit(within(composer).getByRole("button", { name: "Create and schedule" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getAllByText("Create timeline task").length).toBeGreaterThan(0);
    });

      expect(createTaskFromScheduleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Create timeline task",
          runtimeAdapterKey: "openclaw",
          runtimeInputVersion: "openclaw-legacy-v1",
          runtimeInput: expect.objectContaining({
            model: "gpt-5.4",
            prompt: "Implement the task and report status",
          }),
        }),
      );
    expect(applyScheduleMock).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0]?.[0]).toContain("task=task_created");
  });

  it("applies starter presets before creating a scheduled task", async () => {
    createTaskFromScheduleMock.mockResolvedValue({ taskId: "task_created", workspaceId: "ws_1" });
    applyScheduleMock.mockResolvedValue(undefined);

    render(
      <SchedulePage
        workspaceId="ws_1"
        selectedDay="2026-04-18"
        data={{
          summary: {
            scheduledCount: 0,
            unscheduledCount: 0,
            proposalCount: 0,
            riskCount: 0,
          },
          defaultRuntimeAdapterKey: "openclaw",
          runtimeAdapters: [OPENCLAW_RUNTIME_ADAPTER],
          scheduled: [],
          unscheduled: [],
          proposals: [],
          risks: [],
          listItems: [],
        }}
      />,
    );

    fireEvent.click(screen.getAllByText("Create Task Block")[0]);
    const composer = document.querySelector("[data-timeline-composer]") as HTMLElement | null;

    if (!composer) {
      throw new Error("Timeline composer not found");
    }

    fireEvent.click(within(composer).getByRole("button", { name: /Bug investigation/i }));

    expect(within(composer).getByLabelText("Priority")).toHaveValue("High");
    expect(within(composer).getByLabelText("Model")).toHaveValue("gpt-5.4");
    expect(within(composer).getByLabelText("Prompt / instructions")).toHaveValue(
      "Reproduce the issue, identify the root cause, describe the impact, and suggest the safest fix before making broader changes.",
    );

    fireEvent.change(within(composer).getByLabelText("Title"), { target: { value: "Investigate runtime drift" } });
    fireEvent.submit(within(composer).getByRole("button", { name: "Create and schedule" }).closest("form")!);

    await waitFor(() => {
        expect(createTaskFromScheduleMock).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Investigate runtime drift",
            priority: "High",
            runtimeAdapterKey: "openclaw",
            runtimeInput: expect.objectContaining({ model: "gpt-5.4" }),
          }),
        );
    });
  });

  it("renders the schedule list view with triage filters and quick edit", async () => {
    updateTaskConfigFromScheduleMock.mockResolvedValue(undefined);

    render(
      <SchedulePage
        workspaceId="ws_1"
        selectedDay="2026-04-16"
        selectedView="list"
        data={buildBaseData()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Schedule List View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Running/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /WaitingForApproval/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Not runnable/i })).toBeInTheDocument();
    expect(screen.getAllByText("Queue follow-up docs").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Not runnable/i }));
    expect(screen.getAllByText("Queue follow-up docs").length).toBeGreaterThan(0);

    const listView = screen.getByRole("heading", { name: "Schedule List View" }).closest("section");

    if (!listView) {
      throw new Error("Schedule list view container not found");
    }

    fireEvent.click(screen.getByRole("button", { name: "Quick edit" }));
    const quickEditForm = within(listView).getAllByRole("button", { name: "Save task config" })[0]?.closest("form");

    if (!quickEditForm) {
      throw new Error("Quick edit form not found");
    }

    fireEvent.change(within(quickEditForm).getByLabelText("Model"), { target: { value: "gpt-5.4" } });
    fireEvent.change(within(quickEditForm).getByLabelText("Prompt / instructions"), {
      target: { value: "Write the follow-up note" },
    });
    fireEvent.submit(quickEditForm);

      await waitFor(() => {
        expect(updateTaskConfigFromScheduleMock).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: "task_unscheduled",
            runtimeAdapterKey: "openclaw",
            runtimeInput: expect.objectContaining({
              model: "gpt-5.4",
              prompt: "Write the follow-up note",
            }),
          }),
        );
      });
  });
});
