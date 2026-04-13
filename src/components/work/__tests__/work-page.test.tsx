import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDateInputForSubmission, WorkPageClient } from "@/components/work/work-page-client";

const actionMocks = vi.hoisted(() => ({
  acceptTaskResult: vi.fn(async () => ({})),
  approveApproval: vi.fn(async () => ({})),
  createFollowUpTask: vi.fn(async () => ({ workspaceId: "ws_1", taskId: "task_1", followUpTaskId: "task_follow_up" })),
  editAndApproveApproval: vi.fn(async () => ({})),
  generateTaskPlan: vi.fn(async () => ({ workspaceId: "ws_1", taskId: "task_1" })),
  markTaskDone: vi.fn(async () => ({ workspaceId: "ws_1", taskId: "task_1" })),
  provideInput: vi.fn(async () => ({})),
  rejectApproval: vi.fn(async () => ({})),
  reopenTask: vi.fn(async () => ({ workspaceId: "ws_1", taskId: "task_1" })),
  retryRun: vi.fn(async () => ({ workspaceId: "ws_1", taskId: "task_1" })),
  sendOperatorMessage: vi.fn(async () => ({})),
  startRun: vi.fn(async () => ({ workspaceId: "ws_1", taskId: "task_1" })),
}));

const i18nMocks = vi.hoisted(() => ({
  useI18n: vi.fn(() => ({ messages: { components: { workPage: {} } } })),
  useLocale: vi.fn(() => "en"),
}));

const navigationMocks = vi.hoisted(() => ({
  useRouter: vi.fn(() => ({
    refresh: vi.fn(),
  })),
}));

vi.mock("@/app/actions/task-actions", () => actionMocks);
vi.mock("@/i18n/client", () => i18nMocks);
vi.mock("next/navigation", () => navigationMocks);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.values(actionMocks).forEach((mock) => mock.mockClear());
});

beforeEach(() => {
  i18nMocks.useI18n.mockReturnValue({ messages: { components: { workPage: {} } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => buildInitialData(),
    })),
  );
});

function buildInitialData(overrides: Partial<Parameters<typeof WorkPageClient>[0]["initialData"]> = {}) {
  return {
    taskShell: {
      id: "task_1",
      workspaceId: "ws_1",
      title: "Write projection",
      runtimeModel: "gpt-5.4",
      prompt: null,
      status: "Ready",
      priority: "High",
      dueAt: null,
      scheduledStartAt: "2026-04-16T09:00:00.000Z",
      scheduledEndAt: "2026-04-16T11:00:00.000Z",
      scheduleStatus: "OnTrack",
      blockReason: null,
    },
    currentRun: null,
    currentIntervention: {
      kind: "idle" as const,
      title: "Start execution",
      description: "No run is active yet.",
      whyNow: "There is no active run yet.",
      actionLabel: "Start Run Here",
      evidence: [],
    },
    latestOutput: {
      kind: "empty" as const,
      title: "No mapped output yet",
      body: "The latest artifact or agent result will appear here first.",
      timestamp: null,
      href: null,
      empty: true,
      sourceLabel: "No output source",
    },
    scheduleImpact: {
      status: "OnTrack",
      dueAt: null,
      scheduledStartAt: "2026-04-16T09:00:00.000Z",
      scheduledEndAt: "2026-04-16T11:00:00.000Z",
      summary: "Execution is moving inside the planned window.",
    },
    reliability: {
      refreshedAt: "2026-04-16T10:16:00.000Z",
      lastSyncedAt: null,
      lastUpdatedAt: null,
      syncStatus: null,
      isStale: false,
      stuckFor: null,
      stopReason: null,
    },
    closure: {
      resultAccepted: false,
      acceptedAt: null,
      isDone: false,
      doneAt: null,
      canAcceptResult: false,
      canMarkDone: false,
      canCreateFollowUp: false,
      canRetry: false,
      canReopen: false,
      latestFollowUp: null,
    },
    taskPlan: {
      state: "ready" as const,
      revision: "generated" as const,
      generatedBy: "work-plan-agent",
      isMock: true,
      summary: "Keep the work moving through the current step.",
      updatedAt: "2026-04-16T10:16:00.000Z",
      changeSummary: "Generated from current task context.",
      currentStepId: "execute-task",
      steps: [
        { id: "understand-task", title: "梳理目标与约束", objective: "确认目标与限制。", phase: "理解", status: "done" as const, needsUserInput: false },
        { id: "execute-task", title: "推进首轮产出", objective: "推进当前执行。", phase: "执行", status: "in_progress" as const, needsUserInput: false },
      ],
    },
    workstreamItems: [
      {
        id: "evt_1",
        eventType: "run.started",
        title: "Run started",
        summary: "Execution began from the workbench.",
        kind: "event",
        badge: "Started",
        whyItMatters: "Confirms the run is live.",
        linkedEvidenceLabel: null,
        payload: { source: "workbench" },
        runtimeTs: "2026-04-16T10:14:00.000Z",
      },
    ],
    conversation: [
      {
        id: "msg_1",
        role: "assistant",
        content: "I am ready to continue.",
        runtimeTs: "2026-04-16T10:13:00.000Z",
      },
    ],
    inspector: {
      approvals: [],
      artifacts: [],
      toolCalls: [],
    },
    ...overrides,
  };
}

describe("WorkPageClient", () => {
  it("shows the approval next action as the dominant hero instead of the old status-card-first layout", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_approval",
            workspaceId: "ws_1",
            title: "Write projection",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Blocked",
            priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "AtRisk",
            blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
          },
          currentRun: { id: "run_1", status: "WaitingForApproval", pendingInputPrompt: "Need operator guidance" },
          currentIntervention: {
            kind: "approval",
            title: "Resolve approval",
            description: "Allow the agent to edit files.",
            whyNow: "A human decision is required before the next execution step can proceed.",
            actionLabel: "Approve / Reject / Edit",
            evidence: [
              { label: "Pending approval", value: "Approve tool execution", tone: "warning" },
              { label: "Latest output", value: "Latest agent output", tone: "neutral" },
            ],
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
          },
          latestOutput: {
            kind: "message",
            title: "Latest agent output",
            body: "The agent prepared a safe file edit plan.",
            timestamp: "2026-04-16T10:15:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Conversation output",
          },
          scheduleImpact: {
            status: "AtRisk",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            summary: "Execution timing is slipping against the planned window.",
          },
          reliability: {
            refreshedAt: "2026-04-16T10:16:00.000Z",
            lastSyncedAt: "2026-04-16T10:15:00.000Z",
            lastUpdatedAt: "2026-04-16T10:15:00.000Z",
            syncStatus: "healthy",
            isStale: false,
            stuckFor: "1m",
            stopReason: "Approve / Reject / Edit and Approve",
          },
          inspector: {
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
            artifacts: [],
            toolCalls: [],
          },
        })}
      />,
    );

    const shell = screen.getByRole("region", { name: "任务概览" });
    const hero = screen.getByRole("region", { name: "当前重点区域" });
    const resultPanel = screen.getByRole("region", { name: "最新结果区域" });
    const executionStream = screen.getByRole("region", { name: "任务记录区域" });
    const inspector = screen.getByRole("complementary", { name: "工作检查区" });

    expect(shell).toBeInTheDocument();
    expect(hero).toBeInTheDocument();
    expect(resultPanel).toBeInTheDocument();
    expect(executionStream).toBeInTheDocument();
    expect(inspector).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "任务状态" })).not.toBeInTheDocument();

    const heroScope = within(hero);
    expect(heroScope.getByText("Resolve approval")).toBeInTheDocument();
    expect(heroScope.getByText("A human decision is required before the next execution step can proceed.")).toBeInTheDocument();
    expect(heroScope.getByText("等待审批")).toBeInTheDocument();
    expect(heroScope.queryByText("WaitingForApproval")).not.toBeInTheDocument();
    expect(heroScope.getByRole("button", { name: "批准" })).toBeInTheDocument();
    expect(heroScope.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(heroScope.getByRole("button", { name: "修改后批准" })).toBeInTheDocument();
    expect(heroScope.getByRole("textbox", { name: "修改后的指令" })).toBeInTheDocument();
    expect(heroScope.getByRole("textbox", { name: /发送给 Agent 的内容/ })).toBeInTheDocument();
    expect(heroScope.getByRole("button", { name: "发送补充说明" })).toBeInTheDocument();
    expect(heroScope.getAllByText("Approve tool execution").length).toBeGreaterThan(0);
  expect(screen.getAllByText("有风险").length).toBeGreaterThan(0);
  expect(screen.queryByText("已超时")).not.toBeInTheDocument();
  });

  it("keeps the work mobile reading order focused on action before context", () => {
    render(<WorkPageClient initialData={buildInitialData()} />);

    const shell = screen.getByRole("region", { name: "任务概览" });
    const hero = screen.getByRole("region", { name: "当前重点区域" });
    const resultPanel = screen.getByRole("region", { name: "最新结果区域" });
    const executionStream = screen.getByRole("region", { name: "任务记录区域" });
    const inspector = screen.getByRole("complementary", { name: "工作检查区" });

    expect(shell.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hero.compareDocumentPosition(resultPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(resultPanel.compareDocumentPosition(executionStream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(executionStream.compareDocumentPosition(inspector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(inspector).getByRole("heading", { name: "工作检查区" })).toBeInTheDocument();
  });

  it("keeps the composer in the dominant hero while a run is actively running", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_running",
            workspaceId: "ws_1",
            title: "Monitor rollout",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Running",
            priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "OnTrack",
            blockReason: { actionRequired: "Observe progress" },
          },
          currentRun: { id: "run_running", status: "Running", pendingInputPrompt: null },
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [{ label: "Status", value: "Running", tone: "neutral" }],
          },
          latestOutput: {
            kind: "message",
            title: "Live update",
            body: "Collecting deployment evidence.",
            timestamp: "2026-04-16T10:20:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Conversation output",
          },
        })}
      />,
    );

    const heroScope = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(heroScope.getByText("Observe progress")).toBeInTheDocument();
    expect(heroScope.getByRole("textbox", { name: /发送给 Agent 的内容/ })).toBeInTheDocument();
    expect(heroScope.getByRole("button", { name: "发送补充说明" })).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "工作检查区" })).getByRole("tab", { name: "任务计划" })).toBeInTheDocument();
  });

  it("lets the operator start the first run from the new hero", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_start",
            workspaceId: "ws_1",
            title: "Draft rollout note",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Ready",
            priority: "Medium",
            dueAt: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
            scheduleStatus: "Unscheduled",
            blockReason: { actionRequired: "Start the first execution pass" },
          },
          currentRun: null,
          currentIntervention: {
            kind: "idle",
            title: "Start execution",
            description: "No run is active yet. Launch one from this workbench once the task is ready in Schedule.",
            whyNow: "There is no active run, so execution cannot progress from this page yet.",
            actionLabel: "Start Run Here",
            evidence: [],
          },
          taskPlan: {
            state: "empty",
            revision: null,
            generatedBy: null,
            isMock: true,
            summary: null,
            updatedAt: null,
            changeSummary: null,
            currentStepId: null,
            steps: [],
          },
        })}
      />,
    );

    const heroScope = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(heroScope.getByText("Start execution")).toBeInTheDocument();
    expect(heroScope.getByDisplayValue("继续处理：Draft rollout note")).toBeInTheDocument();
    expect(heroScope.getByRole("button", { name: "启动并继续" })).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "工作检查区" })).getByRole("button", { name: "生成占位计划" })).toBeInTheDocument();
  });

  it("preserves hero composer input when submission fails", async () => {
    actionMocks.sendOperatorMessage.mockRejectedValueOnce(new Error("发送失败"));

    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_running_error",
            workspaceId: "ws_1",
            title: "Monitor rollout",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Running",
            priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "OnTrack",
            blockReason: { actionRequired: "Observe progress" },
          },
          currentRun: { id: "run_running_error", status: "Running", pendingInputPrompt: null },
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [],
          },
        })}
      />,
    );

    const input = screen.getByRole("textbox", { name: /发送给 Agent 的内容/ });
    fireEvent.change(input, { target: { value: "Please collect more logs." } });
    fireEvent.click(screen.getByRole("button", { name: "发送补充说明" }));

    await vi.waitFor(() => {
      expect(within(screen.getByRole("region", { name: "当前重点区域" })).getByRole("alert")).toHaveTextContent("发送失败");
    });

    expect(input).toHaveValue("Please collect more logs.");
  });

  it("preserves hero composer input when the projection refresh fails after send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => buildInitialData(),
      })),
    );

    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_running_refresh_error",
            workspaceId: "ws_1",
            title: "Monitor rollout",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Running",
            priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "OnTrack",
            blockReason: { actionRequired: "Observe progress" },
          },
          currentRun: { id: "run_running_refresh_error", status: "Running", pendingInputPrompt: null },
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [],
          },
        })}
      />,
    );

    const input = screen.getByRole("textbox", { name: /发送给 Agent 的内容/ });
    fireEvent.change(input, { target: { value: "Please collect more logs." } });
    fireEvent.click(screen.getByRole("button", { name: "发送补充说明" }));

    await vi.waitFor(() => {
      expect(within(screen.getByRole("region", { name: "当前重点区域" })).getByRole("alert")).toHaveTextContent("操作失败");
    });

    expect(input).toHaveValue("Please collect more logs.");
  });

  it("clears hero composer input after a successful submission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () =>
          buildInitialData({
            taskShell: {
              id: "task_running_success",
              workspaceId: "ws_1",
              title: "Monitor rollout",
              runtimeModel: "gpt-5.4",
              prompt: null,
              status: "Running",
              priority: "High",
              dueAt: null,
              scheduledStartAt: "2026-04-16T09:00:00.000Z",
              scheduledEndAt: "2026-04-16T11:00:00.000Z",
              scheduleStatus: "OnTrack",
              blockReason: { actionRequired: "Observe progress" },
            },
            currentRun: { id: "run_running_success", status: "Running", pendingInputPrompt: null },
            currentIntervention: {
              kind: "observe",
              title: "Observe progress",
              description: "The run is active. Watch the output and add context only when needed.",
              whyNow: "The agent is still executing, so the next human action should stay lightweight.",
              actionLabel: "Observe Progress",
              evidence: [],
            },
          }),
      })),
    );

    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_running_success",
            workspaceId: "ws_1",
            title: "Monitor rollout",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Running",
            priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "OnTrack",
            blockReason: { actionRequired: "Observe progress" },
          },
          currentRun: { id: "run_running_success", status: "Running", pendingInputPrompt: null },
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [],
          },
        })}
      />,
    );

    const input = screen.getByRole("textbox", { name: /发送给 Agent 的内容/ });
    fireEvent.change(input, { target: { value: "Please collect more logs." } });
    fireEvent.click(screen.getByRole("button", { name: "发送补充说明" }));

    await vi.waitFor(() => {
      expect(actionMocks.sendOperatorMessage).toHaveBeenCalledWith({
        runId: "run_running_success",
        message: "Please collect more logs.",
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByRole("textbox", { name: /发送给 Agent 的内容/ })).toHaveValue("");
    });
  });

  it("shows whitespace-only hero submissions as inline validation errors", async () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_running_blank",
            workspaceId: "ws_1",
            title: "Monitor rollout",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Running",
            priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "OnTrack",
            blockReason: { actionRequired: "Observe progress" },
          },
          currentRun: { id: "run_running_blank", status: "Running", pendingInputPrompt: null },
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [],
          },
        })}
      />,
    );

    const input = screen.getByRole("textbox", { name: /发送给 Agent 的内容/ });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "发送补充说明" }));

    await vi.waitFor(() => {
      expect(within(screen.getByRole("region", { name: "当前重点区域" })).getByRole("alert")).toHaveTextContent("需要填写发送给 Agent 的内容");
    });

    expect(actionMocks.sendOperatorMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue("   ");
  });

  it("keeps result actions inside the readable latest-result panel after completion", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_completed",
            workspaceId: "ws_1",
            title: "Close rollout checklist",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Completed",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_3",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: {
            kind: "review",
            title: "Review result",
            description: "The run completed. Review the latest output and decide whether follow-up work is needed.",
            whyNow: "The latest result is available and should be reviewed before closing or extending the task.",
            actionLabel: "Review Output",
            evidence: [],
          },
          latestOutput: {
            kind: "artifact",
            title: "Rollout summary",
            body: "Type: report",
            timestamp: "2026-04-20T09:45:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Artifact · report",
          },
          closure: {
            resultAccepted: false,
            acceptedAt: null,
            isDone: false,
            doneAt: null,
            canAcceptResult: true,
            canMarkDone: true,
            canCreateFollowUp: true,
            canRetry: true,
            canReopen: false,
            latestFollowUp: null,
          },
        })}
      />,
    );

    const resultScope = within(screen.getByRole("region", { name: "最新结果区域" }));
    expect(resultScope.getByText("Rollout summary")).toBeInTheDocument();
    expect(resultScope.getByRole("button", { name: "确认结果" })).toBeInTheDocument();
    expect(resultScope.getByRole("button", { name: "标记任务完成" })).toBeInTheDocument();
    expect(resultScope.getByRole("button", { name: "创建后续任务" })).toBeInTheDocument();
    expect(resultScope.getByRole("textbox", { name: "后续任务标题" })).toBeInTheDocument();
    expect(resultScope.getByLabelText("后续任务截止时间")).toBeInTheDocument();
    expect(resultScope.getByRole("button", { name: "重新执行" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "继续下一轮执行" })).not.toBeInTheDocument();

    const heroScope = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(within(screen.getByRole("region", { name: "任务概览" })).getByText("待确认")).toBeInTheDocument();
    expect(heroScope.queryByRole("button", { name: "确认结果" })).not.toBeInTheDocument();
    expect(heroScope.getByRole("button", { name: "重新执行" })).toBeInTheDocument();
  });

  it("does not expose continue controls when a completed run cannot be retried", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_review_only",
            workspaceId: "ws_1",
            title: "Review rollout summary",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Completed",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_review_only",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: {
            kind: "review",
            title: "Review result",
            description: "The run completed. Review the latest output before deciding the next step.",
            whyNow: "The latest result is available and should be reviewed before extending the task.",
            actionLabel: "Review Output",
            evidence: [],
          },
          closure: {
            resultAccepted: false,
            acceptedAt: null,
            isDone: false,
            doneAt: null,
            canAcceptResult: true,
            canMarkDone: true,
            canCreateFollowUp: true,
            canRetry: false,
            canReopen: false,
            latestFollowUp: null,
          },
        })}
      />,
    );

    const heroScope = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(heroScope.queryByRole("textbox")).not.toBeInTheDocument();
    expect(heroScope.queryByRole("button", { name: "继续下一轮执行" })).not.toBeInTheDocument();
    expect(heroScope.getByText("最新一轮已经完成。先确认结果，再决定是否继续推进。")).toBeInTheDocument();
    expect(heroScope.getByText("确认结果 / 标记任务完成 / 创建后续任务")).toBeInTheDocument();
  });

  it("does not expose retry controls when resume is supported but retry is not allowed", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_resume_only",
            workspaceId: "ws_1",
            title: "Review run without retry",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Completed",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_resume_only",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: true,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: null,
          closure: {
            resultAccepted: false,
            acceptedAt: null,
            isDone: false,
            doneAt: null,
            canAcceptResult: true,
            canMarkDone: true,
            canCreateFollowUp: true,
            canRetry: false,
            canReopen: false,
            latestFollowUp: null,
          },
        })}
      />,
    );

    const heroScope = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(heroScope.queryByRole("textbox")).not.toBeInTheDocument();
    expect(heroScope.queryByRole("button", { name: "重新执行" })).not.toBeInTheDocument();
    expect(heroScope.getAllByText("最新一轮已经完成。先确认结果，再决定是否继续推进。").length).toBeGreaterThan(0);
  });

  it("keeps reopen and latest follow-up details in the latest-result area after the task is done", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_done",
            workspaceId: "ws_1",
            title: "Ship rollout summary",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Done",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_done",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: {
            kind: "review",
            title: "Review result",
            description: "The run completed. Review the latest output and decide whether follow-up work is needed.",
            whyNow: "The latest result is available and should be reviewed before closing or extending the task.",
            actionLabel: "Review Output",
            evidence: [],
          },
          latestOutput: {
            kind: "artifact",
            title: "Rollout summary",
            body: "Type: report",
            timestamp: "2026-04-20T09:45:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Artifact · report",
          },
          closure: {
            resultAccepted: true,
            acceptedAt: "2026-04-20T09:47:00.000Z",
            isDone: true,
            doneAt: "2026-04-20T09:50:00.000Z",
            canAcceptResult: false,
            canMarkDone: false,
            canCreateFollowUp: false,
            canRetry: false,
            canReopen: true,
            latestFollowUp: {
              id: "task_follow_up",
              title: "Prepare stakeholder summary",
              status: "Ready",
              scheduleStatus: "Unscheduled",
              createdAt: "2026-04-20T09:55:00.000Z",
            },
          },
        })}
      />,
    );

    const resultScope = within(screen.getByRole("region", { name: "最新结果区域" }));
    expect(resultScope.getByRole("button", { name: "重新打开任务" })).toBeInTheDocument();
    expect(resultScope.getByText("最新后续任务")).toBeInTheDocument();
    expect(resultScope.getByText("Prepare stakeholder summary")).toBeInTheDocument();
    expect(resultScope.getByText("任务已完成")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "当前重点区域" })).getByText("重新打开任务")).toBeInTheDocument();
  });

  it("keeps closure controls visible when the latest result is still empty", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_empty_closure",
            workspaceId: "ws_1",
            title: "Close rollout checklist",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Completed",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_empty_closure",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: {
            kind: "review",
            title: "Review result",
            description: "The run completed. Review the latest output and decide whether follow-up work is needed.",
            whyNow: "The latest result is available and should be reviewed before closing or extending the task.",
            actionLabel: "Review Output",
            evidence: [],
          },
          latestOutput: {
            kind: "empty",
            title: "No mapped output yet",
            body: "The latest artifact or agent result will appear here first.",
            timestamp: null,
            href: null,
            empty: true,
            sourceLabel: "No output source",
          },
          closure: {
            resultAccepted: false,
            acceptedAt: null,
            isDone: false,
            doneAt: null,
            canAcceptResult: true,
            canMarkDone: true,
            canCreateFollowUp: true,
            canRetry: true,
            canReopen: false,
            latestFollowUp: null,
          },
        })}
      />,
    );

    const resultScope = within(screen.getByRole("region", { name: "最新结果区域" }));
    expect(resultScope.getByRole("button", { name: "确认结果" })).toBeInTheDocument();
    expect(resultScope.getByRole("button", { name: "标记任务完成" })).toBeInTheDocument();
    expect(resultScope.getByRole("button", { name: "创建后续任务" })).toBeInTheDocument();
    expect(resultScope.getByRole("button", { name: "重新执行" })).toBeInTheDocument();
  });

  it("uses localized inspector tabs with selected-state semantics", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          inspector: {
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
            artifacts: [],
            toolCalls: [],
          },
        })}
      />,
    );

    const inspector = within(screen.getByRole("complementary", { name: "工作检查区" }));
    const tablist = inspector.getByRole("tablist");
    const planTab = within(tablist).getByRole("tab", { name: "任务计划" });
    const approvalsTab = within(tablist).getByRole("tab", { name: "待处理审批" });

    expect(planTab).toHaveAttribute("aria-selected", "true");
    expect(approvalsTab).toHaveAttribute("aria-selected", "false");
    expect(inspector.queryByRole("tab", { name: "批准" })).not.toBeInTheDocument();

    fireEvent.click(approvalsTab);

    expect(approvalsTab).toHaveAttribute("aria-selected", "true");
    expect(planTab).toHaveAttribute("aria-selected", "false");
    expect(inspector.getByRole("tabpanel", { name: "待处理审批" })).toBeInTheDocument();
  });

  it("keeps valid tab-panel relationships for inactive inspector tabs", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          inspector: {
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
            artifacts: [{ id: "artifact_1", title: "Run log", type: "text/plain", uri: "/artifacts/run-log" }],
            toolCalls: [{ id: "tool_1", toolName: "write_file", status: "completed" }],
          },
        })}
      />,
    );

    const inspector = within(screen.getByRole("complementary", { name: "工作检查区" }));
    const approvalsTab = inspector.getByRole("tab", { name: "待处理审批" });
    const approvalsPanelId = approvalsTab.getAttribute("aria-controls");

    if (!approvalsPanelId) {
      throw new Error("Approvals tab is missing aria-controls");
    }

    const approvalsPanel = document.getElementById(approvalsPanelId);

    if (!(approvalsPanel instanceof HTMLDivElement)) {
      throw new Error("Approvals panel not found");
    }

    expect(approvalsTab).toHaveAttribute("aria-controls", approvalsPanel.getAttribute("id"));
    expect(approvalsPanel).toHaveAttribute("hidden");
    expect(approvalsPanel).toHaveAttribute("aria-labelledby", approvalsTab.getAttribute("id"));
  });

  it("supports keyboard navigation across inspector tabs", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          inspector: {
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
            artifacts: [{ id: "artifact_1", title: "Run log", type: "text/plain", uri: "/artifacts/run-log" }],
            toolCalls: [{ id: "tool_1", toolName: "write_file", status: "completed" }],
          },
        })}
      />,
    );

    const inspector = within(screen.getByRole("complementary", { name: "工作检查区" }));
    const planTab = inspector.getByRole("tab", { name: "任务计划" });
    const approvalsTab = inspector.getByRole("tab", { name: "待处理审批" });
    const artifactsTab = inspector.getByRole("tab", { name: "当前产出" });
    const contextTab = inspector.getByRole("tab", { name: "任务背景" });

    planTab.focus();
    fireEvent.keyDown(planTab, { key: "ArrowRight" });
    expect(approvalsTab).toHaveFocus();
    expect(approvalsTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(approvalsTab, { key: "End" });
    expect(contextTab).toHaveFocus();
    expect(contextTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(contextTab, { key: "Home" });
    expect(planTab).toHaveFocus();
    expect(planTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(planTab, { key: "ArrowLeft" });
    expect(contextTab).toHaveFocus();
    expect(contextTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(contextTab, { key: "ArrowLeft" });
    expect(inspector.getByRole("tab", { name: "工具记录" })).toHaveFocus();
    expect(inspector.getByRole("tab", { name: "工具记录" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(inspector.getByRole("tab", { name: "工具记录" }), { key: "ArrowLeft" });
    expect(artifactsTab).toHaveFocus();
    expect(artifactsTab).toHaveAttribute("aria-selected", "true");
  });

  it("does not poll terminal runs", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation(() => 1 as unknown as number);

    render(
      <WorkPageClient
        initialData={buildInitialData({
          currentRun: {
            id: "run_completed",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
        })}
      />,
    );

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("renders linked hero evidence and linked inspector artifacts as actionable links", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [
              { label: "部署面板", value: "查看最新部署日志", tone: "neutral", href: "/ops/deployments/123" },
            ],
          },
          inspector: {
            approvals: [],
            artifacts: [{ id: "artifact_1", title: "Run log", type: "text/plain", uri: "/artifacts/run-log" }],
            toolCalls: [],
          },
        })}
      />,
    );

    const hero = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(hero.getByRole("link", { name: "查看最新部署日志" })).toHaveAttribute("href", "/en/ops/deployments/123");

    const inspector = within(screen.getByRole("complementary", { name: "工作检查区" }));
    fireEvent.click(inspector.getByRole("tab", { name: "当前产出" }));
    expect(inspector.getByRole("link", { name: "Run log" })).toHaveAttribute("href", "/en/artifacts/run-log");
  });

  it("does not render unsafe hrefs as actionable links", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [
              { label: "危险链接", value: "不要点击", tone: "critical", href: "javascript:alert(1)" },
            ],
          },
          inspector: {
            approvals: [],
            artifacts: [{ id: "artifact_unsafe", title: "Unsafe artifact", type: "text/plain", uri: "javascript:alert(1)" }],
            toolCalls: [],
          },
        })}
      />,
    );

    const hero = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(hero.queryByRole("link", { name: "不要点击" })).not.toBeInTheDocument();
    expect(hero.getByText("不要点击")).toBeInTheDocument();

    const inspector = within(screen.getByRole("complementary", { name: "工作检查区" }));
    fireEvent.click(inspector.getByRole("tab", { name: "当前产出" }));
    expect(inspector.queryByRole("link", { name: "Unsafe artifact" })).not.toBeInTheDocument();
    expect(inspector.getByText("Unsafe artifact")).toBeInTheDocument();
  });

  it("does not treat protocol-relative URLs as internal clickable links", () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          currentIntervention: {
            kind: "observe",
            title: "Observe progress",
            description: "The run is active. Watch the output and add context only when needed.",
            whyNow: "The agent is still executing, so the next human action should stay lightweight.",
            actionLabel: "Observe Progress",
            evidence: [
              { label: "协议相对链接", value: "不要去这个站点", tone: "critical", href: "//evil.example/path" },
            ],
          },
          inspector: {
            approvals: [],
            artifacts: [{ id: "artifact_protocol_relative", title: "Protocol-relative artifact", type: "text/plain", uri: "//evil.example/artifact" }],
            toolCalls: [],
          },
        })}
      />,
    );

    const hero = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(hero.queryByRole("link", { name: "不要去这个站点" })).not.toBeInTheDocument();
    expect(hero.getByText("不要去这个站点")).toBeInTheDocument();

    const inspector = within(screen.getByRole("complementary", { name: "工作检查区" }));
    fireEvent.click(inspector.getByRole("tab", { name: "当前产出" }));
    expect(inspector.queryByRole("link", { name: "Protocol-relative artifact" })).not.toBeInTheDocument();
    expect(inspector.getByText("Protocol-relative artifact")).toBeInTheDocument();
  });

  it("submits follow-up due dates without timezone-sensitive parsing", async () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_follow_up_due",
            workspaceId: "ws_1",
            title: "Close rollout checklist",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Completed",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_follow_up_due",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: {
            kind: "review",
            title: "Review result",
            description: "The run completed. Review the latest output and decide whether follow-up work is needed.",
            whyNow: "The latest result is available and should be reviewed before closing or extending the task.",
            actionLabel: "Review Output",
            evidence: [],
          },
          latestOutput: {
            kind: "artifact",
            title: "Rollout summary",
            body: "Type: report",
            timestamp: "2026-04-20T09:45:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Artifact · report",
          },
          closure: {
            resultAccepted: false,
            acceptedAt: null,
            isDone: false,
            doneAt: null,
            canAcceptResult: false,
            canMarkDone: false,
            canCreateFollowUp: true,
            canRetry: false,
            canReopen: false,
            latestFollowUp: null,
          },
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText("后续任务截止时间"), { target: { value: "2026-04-23" } });
    fireEvent.click(screen.getByRole("button", { name: "创建后续任务" }));

    await vi.waitFor(() => {
      expect(actionMocks.createFollowUpTask).toHaveBeenCalledTimes(1);
    });

    const submission = actionMocks.createFollowUpTask.mock.calls[0]?.[0];
    expect(submission.title).toBe("Close rollout checklist - follow-up");
    expect(submission.dueAt).toBeInstanceOf(Date);
    expect(submission.dueAt?.toISOString()).toBe("2026-04-23T12:00:00.000Z");
  });

  it("rejects whitespace-only follow-up titles in the latest-result panel", async () => {
    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_follow_up_blank_title",
            workspaceId: "ws_1",
            title: "Close rollout checklist",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Completed",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_follow_up_blank_title",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: {
            kind: "review",
            title: "Review result",
            description: "The run completed. Review the latest output and decide whether follow-up work is needed.",
            whyNow: "The latest result is available and should be reviewed before closing or extending the task.",
            actionLabel: "Review Output",
            evidence: [],
          },
          latestOutput: {
            kind: "artifact",
            title: "Rollout summary",
            body: "Type: report",
            timestamp: "2026-04-20T09:45:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Artifact · report",
          },
          closure: {
            resultAccepted: false,
            acceptedAt: null,
            isDone: false,
            doneAt: null,
            canAcceptResult: false,
            canMarkDone: false,
            canCreateFollowUp: true,
            canRetry: false,
            canReopen: false,
            latestFollowUp: null,
          },
        })}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "后续任务标题" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "创建后续任务" }));

    await vi.waitFor(() => {
      expect(within(screen.getByRole("region", { name: "最新结果区域" })).getByText("后续任务标题不能为空")).toBeInTheDocument();
    });

    expect(actionMocks.createFollowUpTask).not.toHaveBeenCalled();
  });

  it("rejects invalid follow-up due dates instead of normalizing them", () => {
    expect(parseDateInputForSubmission("2026-02-31")).toBeNull();
    expect(parseDateInputForSubmission("2026-04-23")?.toISOString()).toBe("2026-04-23T12:00:00.000Z");
  });

  it("uses localized landmark labels for the new work page regions", () => {
    render(<WorkPageClient initialData={buildInitialData()} />);

    expect(screen.getByRole("region", { name: "任务概览" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "当前重点区域" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "最新结果区域" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "任务记录区域" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "工作检查区" })).toBeInTheDocument();

    expect(screen.queryByRole("region", { name: "Task shell" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Next action hero" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Latest result panel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Execution stream" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Work inspector" })).not.toBeInTheDocument();
  });

  it("preserves work-page message overrides instead of forcing default copy", () => {
    i18nMocks.useI18n.mockReturnValue({
      messages: {
        components: {
          workPage: {
            whyNow: "Override why now",
            approve: "Override approve",
            sendNoteToAgent: "Override send",
            conversationInput: "Override conversation input",
          },
        },
      },
    });

    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_override_copy",
            workspaceId: "ws_1",
            title: "Write projection",
            runtimeModel: "gpt-5.4",
            prompt: null,
            status: "Blocked",
            priority: "High",
            dueAt: null,
            scheduledStartAt: "2026-04-16T09:00:00.000Z",
            scheduledEndAt: "2026-04-16T11:00:00.000Z",
            scheduleStatus: "AtRisk",
            blockReason: { actionRequired: "Approve / Reject / Edit and Approve" },
          },
          currentRun: { id: "run_override_copy", status: "WaitingForApproval", pendingInputPrompt: "Need operator guidance" },
          currentIntervention: {
            kind: "approval",
            title: "Resolve approval",
            description: "Allow the agent to edit files.",
            whyNow: "A human decision is required before the next execution step can proceed.",
            actionLabel: "Approve / Reject / Edit",
            evidence: [],
            approvals: [{ id: "approval_1", title: "Approve tool execution", status: "Pending", summary: "Allow the agent to edit files." }],
          },
        })}
      />,
    );

    const hero = within(screen.getByRole("region", { name: "当前重点区域" }));
    expect(hero.getByText("Override why now")).toBeInTheDocument();
    expect(hero.getByRole("button", { name: "Override approve" })).toBeInTheDocument();
    expect(hero.getByRole("button", { name: "Override send" })).toBeInTheDocument();
    expect(hero.getByRole("textbox", { name: "Override conversation input" })).toBeInTheDocument();
  });

  it("shows result action errors in the latest-result panel instead of the hero", async () => {
    actionMocks.acceptTaskResult.mockRejectedValueOnce(new Error("结果确认失败"));

    render(
      <WorkPageClient
        initialData={buildInitialData({
          taskShell: {
            id: "task_result_error",
            workspaceId: "ws_1",
            title: "Close rollout checklist",
            runtimeModel: "gpt-5.4",
            prompt: "Summarize the rollout",
            status: "Completed",
            priority: "High",
            dueAt: "2026-04-20T18:00:00.000Z",
            scheduledStartAt: "2026-04-20T09:00:00.000Z",
            scheduledEndAt: "2026-04-20T11:00:00.000Z",
            scheduleStatus: "Completed",
            blockReason: null,
          },
          currentRun: {
            id: "run_result_error",
            status: "Completed",
            startedAt: "2026-04-20T09:00:00.000Z",
            endedAt: "2026-04-20T09:45:00.000Z",
            updatedAt: "2026-04-20T09:45:00.000Z",
            lastSyncedAt: "2026-04-20T09:45:00.000Z",
            syncStatus: "healthy",
            resumeSupported: false,
            pendingInputPrompt: null,
            errorSummary: null,
          },
          currentIntervention: {
            kind: "review",
            title: "Review result",
            description: "The run completed. Review the latest output and decide whether follow-up work is needed.",
            whyNow: "The latest result is available and should be reviewed before closing or extending the task.",
            actionLabel: "Review Output",
            evidence: [],
          },
          latestOutput: {
            kind: "artifact",
            title: "Rollout summary",
            body: "Type: report",
            timestamp: "2026-04-20T09:45:00.000Z",
            href: null,
            empty: false,
            sourceLabel: "Artifact · report",
          },
          closure: {
            resultAccepted: false,
            acceptedAt: null,
            isDone: false,
            doneAt: null,
            canAcceptResult: true,
            canMarkDone: false,
            canCreateFollowUp: false,
            canRetry: false,
            canReopen: false,
            latestFollowUp: null,
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认结果" }));

    await vi.waitFor(() => {
      expect(within(screen.getByRole("region", { name: "最新结果区域" })).getByText("结果确认失败")).toBeInTheDocument();
    });

    expect(within(screen.getByRole("region", { name: "当前重点区域" })).queryByText("结果确认失败")).not.toBeInTheDocument();
  });

  it("removes the remaining English hero, result, and stream chrome labels", () => {
    render(<WorkPageClient initialData={buildInitialData()} />);

    expect(screen.queryByText("Next Action")).not.toBeInTheDocument();
    expect(screen.queryByText("Latest Result")).not.toBeInTheDocument();
    expect(screen.queryByText("Execution Stream")).not.toBeInTheDocument();
    expect(screen.getByText("当前重点")).toBeInTheDocument();
    expect(screen.getByText("最新结果")).toBeInTheDocument();
    expect(screen.getAllByText("任务记录").length).toBeGreaterThan(0);
  });
});
