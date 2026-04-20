import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}));

import { TaskPlanSidePanel } from "@/components/work/task-plan-side-panel";
import { DEFAULT_WORK_PAGE_COPY } from "@/components/work/work-page/work-page-copy";

describe("TaskPlanSidePanel", () => {
  it("renders graph-native sections for current node, waiting nodes, checkpoints, and linked child tasks", () => {
    render(
      <TaskPlanSidePanel
        copy={DEFAULT_WORK_PAGE_COPY}
        plan={{
          state: "ready",
          revision: "r3",
          generatedBy: "graph-planner",
          isMock: false,
          summary: "Graph-native task plan",
          updatedAt: "2026-04-20T09:19:00.000Z",
          changeSummary: "Grouped by node role",
          currentStepId: "step-current",
          steps: [
            {
              id: "step-current",
              title: "当前执行节点",
              objective: "完成当前 work 页面主结构整理",
              phase: "execution",
              status: "in_progress",
              needsUserInput: false,
              type: "step",
              executionMode: "none",
              linkedTaskId: null,
            },
            {
              id: "step-waiting",
              title: "等待用户确认不可变范围",
              objective: "收集边界约束",
              phase: "input",
              status: "waiting_for_user",
              needsUserInput: true,
              type: "user_input",
              executionMode: "none",
              linkedTaskId: null,
            },
            {
              id: "step-checkpoint",
              title: "检查点",
              objective: "确认驾驶舱与左侧流的分工",
              phase: "review",
              status: "pending",
              needsUserInput: false,
              type: "checkpoint",
              executionMode: "none",
              linkedTaskId: null,
            },
            {
              id: "step-linked",
              title: "物化可执行子任务",
              objective: "把执行节点映射到真实 child task",
              phase: "follow-up",
              status: "pending",
              needsUserInput: false,
              type: "step",
              executionMode: "child_task",
              linkedTaskId: "child-task-1",
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "step-current", toNodeId: "step-linked", type: "sequential" },
            { id: "edge-2", fromNodeId: "step-linked", toNodeId: "step-checkpoint", type: "sequential" },
          ],
        }}
        isPending={false}
        currentAction={{ label: "补充执行要求", href: "/work/input" }}
        currentException={null}
      />,
    );

    expect(screen.getByLabelText("Task plan graph")).toBeInTheDocument();
    expect(screen.getByText("物化可执行子任务")).toBeInTheDocument();
    expect(screen.getByTestId("task-plan-node-step-linked").getAttribute("data-node-tone")).toBe("child-task");
    expect(screen.queryByText("等待你处理")).not.toBeInTheDocument();
    expect(screen.queryByText("已关联子任务")).not.toBeInTheDocument();
  });
});
