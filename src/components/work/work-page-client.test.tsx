import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {} }),
}));

vi.mock("./work-page/use-work-page-controller", () => ({
  useWorkPageController: vi.fn(),
}));

import { WorkPageClient } from "@/components/work/work-page-client";
import { useWorkPageController } from "@/components/work/work-page/use-work-page-controller";
import { DEFAULT_WORK_PAGE_COPY } from "@/components/work/work-page/work-page-copy";
import type { WorkPageData } from "@/components/work/work-page/work-page-types";

const baseData: WorkPageData = {
  taskShell: {
    id: "task_1",
    workspaceId: "ws_1",
    title: "起草任务驱动 Agent 面板",
    runtimeModel: "gpt-5.4",
    prompt: "先整理任务目标，再输出首轮计划",
    status: "Running",
    priority: "High",
    dueAt: "2026-04-20T12:00:00.000Z",
    scheduledStartAt: "2026-04-20T09:00:00.000Z",
    scheduledEndAt: "2026-04-20T11:00:00.000Z",
    scheduleStatus: "OnTrack",
    blockReason: null,
  },
  currentRun: {
    id: "run_1",
    status: "Running",
    startedAt: "2026-04-20T09:05:00.000Z",
    endedAt: null,
    updatedAt: "2026-04-20T09:20:00.000Z",
    lastSyncedAt: "2026-04-20T09:20:00.000Z",
    syncStatus: "healthy",
    resumeSupported: true,
    pendingInputPrompt: null,
    errorSummary: null,
  },
  currentIntervention: {
    kind: "observe",
    title: "推进当前步骤",
    description: "Agent 正在整理约束与执行方案，你可以在这里补充限制、输出格式和优先级。",
    whyNow: "先对齐当前步骤的边界，后续输出才不会偏离任务目标。",
    actionLabel: "补充执行要求",
    evidence: [
      {
        label: "当前重点",
        value: "先产出一版简洁的执行计划",
        tone: "neutral",
      },
    ],
  },
  latestOutput: {
    kind: "message",
    title: "首轮任务理解",
    body: "我会先确认目标、约束和预期产出。",
    timestamp: "2026-04-20T09:18:00.000Z",
    href: null,
    empty: false,
    sourceLabel: "Conversation",
  },
  scheduleImpact: {
    status: "OnTrack",
    dueAt: "2026-04-20T12:00:00.000Z",
    scheduledStartAt: "2026-04-20T09:00:00.000Z",
    scheduledEndAt: "2026-04-20T11:00:00.000Z",
    summary: "当前任务仍在原定时间窗内推进。",
  },
  reliability: {
    refreshedAt: "2026-04-20T09:20:00.000Z",
    lastSyncedAt: "2026-04-20T09:20:00.000Z",
    lastUpdatedAt: "2026-04-20T09:20:00.000Z",
    syncStatus: "healthy",
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
    state: "ready",
    revision: "r2",
    generatedBy: "agent",
    isMock: false,
    summary: "先对齐目标，再推进执行，再回到 work 页面确认结果。",
    updatedAt: "2026-04-20T09:19:00.000Z",
    changeSummary: "当前步骤已切换到方案整理。",
    currentStepId: "step_2",
    steps: [
      {
        id: "step_1",
        title: "明确任务目标",
        objective: "确认用户想要的 work 页面方向",
        phase: "planning",
        status: "done",
        needsUserInput: false,
      },
      {
        id: "step_2",
        title: "整理页面骨架",
        objective: "把页面改造成 task 驱动协作工作台",
        phase: "execution",
        status: "in_progress",
        needsUserInput: false,
      },
      {
        id: "step_3",
        title: "确认下一步",
        objective: "看首轮结果后决定是否继续细化",
        phase: "review",
        status: "pending",
        needsUserInput: false,
      },
    ],
    edges: [
      { id: "edge-1", fromNodeId: "step_1", toNodeId: "step_2", type: "sequential" },
      { id: "edge-2", fromNodeId: "step_2", toNodeId: "step_3", type: "sequential" },
    ],
  },
  workspaceRail: {
    sections: [],
  },
  workstreamItems: [
    {
      id: "event_1",
      eventType: "task.plan_updated",
      title: "Task Plan Updated",
      summary: "切换到页面骨架整理",
      kind: "progress",
      badge: "Progress",
      whyItMatters: "帮助你理解当前推进位置。",
      linkedEvidenceLabel: null,
      payload: {},
      runtimeTs: "2026-04-20T09:19:00.000Z",
    },
  ],
  conversation: [
    {
      id: "msg_1",
      role: "assistant",
      content: "我会先整理工作页的任务推进结构。",
      runtimeTs: "2026-04-20T09:15:00.000Z",
    },
  ],
  composerValue: "",
  inspector: {
    approvals: [],
    artifacts: [],
    toolCalls: [],
  },
};

describe("WorkPageClient", () => {
  it("shows a task-driven collaboration workspace with a task brief and current-step callout", () => {
    vi.mocked(useWorkPageController).mockReturnValue({
      data: baseData,
      isPending: false,
      heroErrorMessage: null,
      resultErrorMessage: null,
      composerResetKey: 0,
      submitWorkbenchInput: vi.fn(),
      actions: {
        acceptResult: vi.fn(),
        retryResult: vi.fn(),
        markTaskDone: vi.fn(),
        reopenTask: vi.fn(),
        createFollowUpTask: vi.fn(),
        approveApproval: vi.fn(),
        rejectApproval: vi.fn(),
        editAndApproveApproval: vi.fn(),
      },
    });

    render(<WorkPageClient initialData={baseData} />);

    expect(screen.getByRole("tab", { name: "协作推进" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "执行记录" })).toBeInTheDocument();
    expect(screen.getByText("起草任务驱动 Agent 面板")).toBeInTheDocument();
    expect(screen.getByText("补充执行要求")).toBeInTheDocument();
    expect(
      screen.getByText("Agent 正在整理约束与执行方案，你可以在这里补充限制、输出格式和优先级。"),
    ).toBeInTheDocument();
  });

  it("renames the plan rail around current and upcoming task steps", () => {
    vi.mocked(useWorkPageController).mockReturnValue({
      data: baseData,
      isPending: false,
      heroErrorMessage: null,
      resultErrorMessage: null,
      composerResetKey: 0,
      submitWorkbenchInput: vi.fn(),
      actions: {
        acceptResult: vi.fn(),
        retryResult: vi.fn(),
        markTaskDone: vi.fn(),
        reopenTask: vi.fn(),
        createFollowUpTask: vi.fn(),
        approveApproval: vi.fn(),
        rejectApproval: vi.fn(),
        editAndApproveApproval: vi.fn(),
      },
    });

    render(<WorkPageClient initialData={baseData} />);

    const [planRail] = screen.getAllByRole("complementary", {
      name: DEFAULT_WORK_PAGE_COPY.planRailAria,
    });

    expect(within(planRail).getByText("任务路径")).toBeInTheDocument();
    expect(within(planRail).getByLabelText("任务计划图")).toBeInTheDocument();
    expect(within(planRail).getAllByText("sequential").length).toBeGreaterThan(0);
    expect(planRail.className).toContain("self-start");
    expect(planRail.className).toContain("pb-3");
    expect(planRail.parentElement?.className).not.toContain("items-start");
  });

  it("keeps the collaboration tab focused on conversation messages while the composer stays docked at the bottom", () => {
    const waitingInputData: WorkPageData = {
      ...baseData,
      currentRun: {
        ...baseData.currentRun!,
        status: "WaitingForInput",
        pendingInputPrompt: "请确认不可变约束和输出格式",
      },
      currentIntervention: {
        kind: "input",
        title: "回答当前缺口",
        description: "先补齐 Agent 缺失的信息，再继续当前步骤。",
        whyNow: "如果缺少约束，当前步骤会反复返工。",
        actionLabel: "补充缺失信息",
        defaultMessage: "这些是不可变约束：...",
        evidence: [
          {
            label: "缺失信息",
            value: "输出格式与不可改动范围",
            tone: "warning",
          },
        ],
      },
      taskPlan: {
        ...baseData.taskPlan,
        steps: baseData.taskPlan.steps.map((step) =>
          step.id === "step_2"
            ? { ...step, status: "waiting_for_user", needsUserInput: true }
            : step,
        ),
      },
      conversation: [
        {
          id: "msg_1",
          role: "assistant",
          content: "我会先整理工作页的任务推进结构。",
          runtimeTs: "2026-04-20T09:15:00.000Z",
        },
        {
          id: "msg_2",
          role: "user",
          content: "保持 work 页面范围，不要改 schedule。",
          runtimeTs: "2026-04-20T09:16:00.000Z",
        },
      ],
    };

    vi.mocked(useWorkPageController).mockReturnValue({
      data: waitingInputData,
      isPending: false,
      heroErrorMessage: null,
      resultErrorMessage: null,
      composerResetKey: 0,
      submitWorkbenchInput: vi.fn(),
      actions: {
        acceptResult: vi.fn(),
        retryResult: vi.fn(),
        markTaskDone: vi.fn(),
        reopenTask: vi.fn(),
        createFollowUpTask: vi.fn(),
        approveApproval: vi.fn(),
        rejectApproval: vi.fn(),
        editAndApproveApproval: vi.fn(),
      },
    });

    render(<WorkPageClient initialData={waitingInputData} />);

    const [workbench] = screen.getAllByLabelText(DEFAULT_WORK_PAGE_COPY.conversationWorkbenchAria);
    const thread = workbench.querySelector('[data-slot="workbench-thread"]');
    const composerDock = workbench.querySelector('[data-slot="workbench-composer-dock"]');

    expect(workbench.className).toContain("xl:h-full");
    expect(thread?.className).toContain("overflow-y-auto");
    expect(composerDock?.className).toContain("sticky");
    expect(composerDock?.className).toContain("bottom-0");
    expect(within(workbench).getAllByText("我会先整理工作页的任务推进结构。").length).toBeGreaterThan(0);
    expect(screen.queryByText("Task Plan Updated")).not.toBeInTheDocument();
    expect(screen.queryByText("首轮任务理解")).not.toBeInTheDocument();
    expect(within(workbench).getAllByText("智能体").length).toBe(1);
    expect(screen.getByText("直接回答缺失信息")).toBeInTheDocument();
    expect(screen.getByText("先说明不可变约束")).toBeInTheDocument();
  });

  it("keeps the execution record view scrollable inside the workbench", async () => {
    const user = userEvent.setup();
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).dataset.slot === "workbench-shell") {
        return {
          x: 0,
          y: 83,
          top: 83,
          left: 0,
          right: 1100,
          bottom: 83,
          width: 1100,
          height: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }

      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 633,
    });

    const groupedExecutionData: WorkPageData = {
      ...baseData,
      currentRun: {
        ...baseData.currentRun!,
        id: "run_current",
        status: "WaitingForInput",
        pendingInputPrompt: "请确认不可变范围",
      },
      currentIntervention: {
        kind: "input",
        title: "确认不可变范围",
        description: "Agent 正等待你确认哪些区域不能改动。",
        whyNow: "不明确边界会导致本轮返工。",
        actionLabel: "给出不可变约束",
        evidence: [
          {
            label: "当前阻塞",
            value: "需要明确不可改动模块",
            tone: "warning",
          },
        ],
      },
      latestOutput: {
        kind: "message",
        title: "当前执行草稿",
        body: "我先把 work 页面拆成协作区与执行区。",
        timestamp: "2026-04-20T09:22:00.000Z",
        href: null,
        empty: false,
        sourceLabel: "Conversation",
      },
      reliability: {
        ...baseData.reliability,
        syncStatus: "delayed",
        isStale: true,
        stuckFor: "18 分钟",
        stopReason: "等待你的范围确认",
      },
      workstreamItems: [
        {
          id: "event_prev_1",
          runId: "run_previous",
          eventType: "run.output_generated",
          title: "上一轮输出首稿",
          summary: "上一轮先产出基础草图。",
          kind: "output",
          badge: "新产出",
          whyItMatters: "可以作为这一轮的参考输入。",
          linkedEvidenceLabel: null,
          payload: {},
          runtimeTs: "2026-04-20T09:05:00.000Z",
        },
        {
          id: "event_current_1",
          runId: "run_current",
          eventType: "run.input_requested",
          title: "等待补充约束",
          summary: "请确认不可变范围。",
          kind: "input",
          badge: "待补充",
          whyItMatters: "确认后才能继续。",
          linkedEvidenceLabel: null,
          payload: {},
          runtimeTs: "2026-04-20T09:21:00.000Z",
        },
        {
          id: "event_current_2",
          runId: "run_current",
          eventType: "task.synced",
          title: "同步当前进展",
          summary: "记录当前等待状态。",
          kind: "progress",
          badge: "进展",
          whyItMatters: "仅供追踪。",
          linkedEvidenceLabel: null,
          payload: {},
          runtimeTs: "2026-04-20T09:20:00.000Z",
        },
        {
          id: "event_task_1",
          eventType: "task.plan_updated",
          title: "任务计划已更新",
          summary: "当前进入协作面板整理。",
          kind: "progress",
          badge: "进展",
          whyItMatters: "说明任务级别的规划变化。",
          linkedEvidenceLabel: null,
          payload: {},
          runtimeTs: "2026-04-20T09:02:00.000Z",
        },
      ],
    };

    vi.mocked(useWorkPageController).mockReturnValue({
      data: groupedExecutionData,
      isPending: false,
      heroErrorMessage: null,
      resultErrorMessage: null,
      composerResetKey: 0,
      submitWorkbenchInput: vi.fn(),
      actions: {
        acceptResult: vi.fn(),
        retryResult: vi.fn(),
        markTaskDone: vi.fn(),
        reopenTask: vi.fn(),
        createFollowUpTask: vi.fn(),
        approveApproval: vi.fn(),
        rejectApproval: vi.fn(),
        editAndApproveApproval: vi.fn(),
      },
    });

    render(<WorkPageClient initialData={groupedExecutionData} />);

    await user.click(screen.getAllByRole("tab", { name: "执行记录" })[0]!);

    const [workbench] = screen.getAllByLabelText(DEFAULT_WORK_PAGE_COPY.conversationWorkbenchAria);
    const shell = workbench.closest('[data-slot="workbench-shell"]') as HTMLElement | null;
    const thread = workbench.querySelector('[data-slot="workbench-thread"]');
    const mainRegion = screen.getByRole("region", { name: "执行记录主区域" });
    const sidebar = screen.getByRole("complementary", { name: "执行记录侧栏" });

    expect(shell).not.toBeNull();
    expect(workbench.className).toContain("xl:h-full");
    expect(thread?.className).toContain("overflow-y-auto");
    expect(screen.getByRole("tabpanel", { name: "执行记录" })).toBeInTheDocument();
    expect(mainRegion).toBeInTheDocument();
    expect(sidebar).toBeInTheDocument();
    expect(within(sidebar).getByText("任务驾驶舱")).toBeInTheDocument();
    expect(within(sidebar).getByText("当前阻塞")).toBeInTheDocument();
    expect(within(sidebar).getByText("当前没有记录阻塞动作。")).toBeInTheDocument();
    expect(within(sidebar).getByText("建议动作")).toBeInTheDocument();
    expect(within(sidebar).getByText("补充执行要求")).toBeInTheDocument();
    expect(within(sidebar).getByText("最近产出")).toBeInTheDocument();
    expect(within(sidebar).getAllByText("首轮任务理解").length).toBeGreaterThan(0);
    expect(within(sidebar).getByText("风险与同步")).toBeInTheDocument();
    expect(within(sidebar).getByText(/同步正常/)).toBeInTheDocument();

    rectSpy.mockRestore();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it("renders approval-specific action workspace guidance when the current step is waiting for approval", () => {
    const approvalData: WorkPageData = {
      ...baseData,
      currentRun: {
        ...baseData.currentRun!,
        status: "WaitingForApproval",
      },
      currentIntervention: {
        kind: "approval",
        title: "确认是否允许变更方案",
        description: "Agent 需要你确认这轮变更是否可以执行。",
        whyNow: "没有审批，当前步骤不能继续。",
        actionLabel: "处理当前审批",
        evidence: [
          {
            label: "变更范围",
            value: "仅调整 work 页面协作工作台",
            tone: "warning",
          },
        ],
        approvals: [
          {
            id: "approval_1",
            title: "允许替换当前协作主区结构",
            status: "pending",
            summary: "只改 work 页，不扩散到 schedule。",
          },
        ],
      },
    };

    vi.mocked(useWorkPageController).mockReturnValue({
      data: approvalData,
      isPending: false,
      heroErrorMessage: null,
      resultErrorMessage: null,
      composerResetKey: 0,
      submitWorkbenchInput: vi.fn(),
      actions: {
        acceptResult: vi.fn(),
        retryResult: vi.fn(),
        markTaskDone: vi.fn(),
        reopenTask: vi.fn(),
        createFollowUpTask: vi.fn(),
        approveApproval: vi.fn(),
        rejectApproval: vi.fn(),
        editAndApproveApproval: vi.fn(),
      },
    });

    render(<WorkPageClient initialData={approvalData} />);

    expect(screen.getByText("审批焦点")).toBeInTheDocument();
    expect(screen.getAllByText("允许替换当前协作主区结构").length).toBeGreaterThan(0);
    expect(screen.getAllByText("只改 work 页，不扩散到 schedule。").length).toBeGreaterThan(0);
  });
});
