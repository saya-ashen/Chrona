import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/localized-link", () => ({
  LocalizedLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}));

import { WorkInspector } from "@/components/work/work-inspector";
import { DEFAULT_WORK_PAGE_COPY } from "@/components/work/work-page/work-page-copy";

beforeAll(() => {
  class ResizeObserverMock {
    observe(target?: Element) {
      if (target) {
        const width = Number.parseInt((target as HTMLElement).style.width || "0", 10);
        Object.defineProperty(target, "clientWidth", {
          configurable: true,
          value: width || 960,
        });
      }
    }
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

const labels = {
  ariaLabel: DEFAULT_WORK_PAGE_COPY.workInspectorAria,
  sections: {
    plan: DEFAULT_WORK_PAGE_COPY.taskPlan,
    approvals: DEFAULT_WORK_PAGE_COPY.pendingApprovals,
    artifacts: DEFAULT_WORK_PAGE_COPY.currentArtifacts,
    tools: DEFAULT_WORK_PAGE_COPY.toolLog,
    context: DEFAULT_WORK_PAGE_COPY.taskContext,
  },
  emptyValue: DEFAULT_WORK_PAGE_COPY.noValue,
  emptyScheduleWindow: DEFAULT_WORK_PAGE_COPY.noScheduleWindow,
  stepStatuses: {
    pending: { label: DEFAULT_WORK_PAGE_COPY.pendingStep, tone: "neutral" as const },
    in_progress: { label: DEFAULT_WORK_PAGE_COPY.inProgressStep, tone: "info" as const },
    waiting_for_user: { label: DEFAULT_WORK_PAGE_COPY.waitingForUserStep, tone: "warning" as const },
    done: { label: DEFAULT_WORK_PAGE_COPY.doneStep, tone: "success" as const },
    blocked: { label: DEFAULT_WORK_PAGE_COPY.blockedStep, tone: "critical" as const },
  },
  planTitle: DEFAULT_WORK_PAGE_COPY.taskPlan,
  planReadySummary: DEFAULT_WORK_PAGE_COPY.planReadySummary,
  planEmptySummary: DEFAULT_WORK_PAGE_COPY.planEmptySummary,
  planEmptyTitle: DEFAULT_WORK_PAGE_COPY.noTaskPlan,
  currentStep: DEFAULT_WORK_PAGE_COPY.currentStep,
  currentBlocker: DEFAULT_WORK_PAGE_COPY.currentBlocker,
  approvalsTitle: DEFAULT_WORK_PAGE_COPY.pendingApprovals,
  noApprovals: DEFAULT_WORK_PAGE_COPY.noPendingApprovals,
  artifactsTitle: DEFAULT_WORK_PAGE_COPY.currentArtifacts,
  noArtifacts: DEFAULT_WORK_PAGE_COPY.noArtifacts,
  toolsTitle: DEFAULT_WORK_PAGE_COPY.toolLog,
  noTools: DEFAULT_WORK_PAGE_COPY.noToolLog,
  toolArguments: DEFAULT_WORK_PAGE_COPY.toolArguments,
  toolResult: DEFAULT_WORK_PAGE_COPY.toolResult,
  toolError: DEFAULT_WORK_PAGE_COPY.toolError,
  contextTitle: DEFAULT_WORK_PAGE_COPY.taskContext,
  priority: DEFAULT_WORK_PAGE_COPY.priorityLabel,
  dueAt: DEFAULT_WORK_PAGE_COPY.dueAtLabel,
  scheduledWindow: DEFAULT_WORK_PAGE_COPY.scheduledWindowLabel,
  scheduleStatus: DEFAULT_WORK_PAGE_COPY.scheduleStatusLabel,
  runStatus: DEFAULT_WORK_PAGE_COPY.runStatusLabel,
  syncStatus: DEFAULT_WORK_PAGE_COPY.syncStatusLabel,
  staleSync: DEFAULT_WORK_PAGE_COPY.staleSync,
  healthySync: DEFAULT_WORK_PAGE_COPY.healthySync,
  lastUpdated: DEFAULT_WORK_PAGE_COPY.lastUpdatedLabel,
  lastSynced: DEFAULT_WORK_PAGE_COPY.lastSyncedLabel,
  stopReason: DEFAULT_WORK_PAGE_COPY.stopReasonLabel,
};

describe("WorkInspector", () => {
  it("surfaces graph-native plan groupings in the plan tab", () => {
    render(
      <WorkInspector
        plan={{
          state: "ready",
          revision: "r4",
          generatedBy: "graph-planner",
          isMock: false,
          summary: "Graph-native plan summary",
          updatedAt: "2026-04-20T09:19:00.000Z",
          changeSummary: "Current node and grouped side buckets",
          currentStepId: "current-node",
          steps: [
            {
              id: "current-node",
              title: "当前执行节点",
              objective: "固定右侧摘要并收敛信号",
              phase: "execution",
              status: "in_progress",
              requiresHumanInput: false,
              type: "step",
              executionMode: "none",
            },
            {
              id: "waiting-node",
              title: "等待确认输出格式",
              objective: "拿到用户输入后继续",
              phase: "input",
              status: "waiting_for_user",
              requiresHumanInput: true,
              type: "user_input",
              executionMode: "none",
            },
            {
              id: "checkpoint-node",
              title: "检查点",
              objective: "确认左侧分组是否清晰",
              phase: "review",
              status: "pending",
              requiresHumanInput: false,
              type: "checkpoint",
              executionMode: "none",
            },
            {
              id: "linked-node",
              title: "创建子任务并接线",
              objective: "为 child_task 节点落库",
              phase: "follow-up",
              status: "pending",
              requiresHumanInput: false,
              type: "step",
              executionMode: "child_task",
              linkedTaskId: "child-task-42",
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "current-node", toNodeId: "linked-node", type: "sequential" },
            { id: "edge-2", fromNodeId: "linked-node", toNodeId: "checkpoint-node", type: "sequential" },
          ],
        }}
        currentAction={{ label: "补充执行要求", href: "/work/input" }}
        currentException={null}
        isPending={false}
        approvals={[]}
        artifacts={[]}
        toolCalls={[]}
        context={{
          priority: "High",
          dueAt: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
          scheduleStatus: "OnTrack",
          scheduleSummary: "on track",
          runStatus: "Running",
          syncStatus: "healthy",
          isStale: false,
          lastUpdatedAt: null,
          lastSyncedAt: null,
          stopReason: null,
          blockerSummary: "none",
        }}
        labels={labels}
      />,
    );

    expect(screen.getByLabelText("Task plan graph")).toBeInTheDocument();
    expect(screen.getByTestId("task-plan-node-linked-node").getAttribute("data-node-tone")).toBe("child-task");
    expect(screen.queryByText("等待你处理")).not.toBeInTheDocument();
    expect(screen.queryByText("已关联子任务")).not.toBeInTheDocument();
  });
});
