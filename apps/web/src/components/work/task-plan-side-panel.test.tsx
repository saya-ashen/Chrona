import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

beforeAll(() => {
  class ResizeObserverMock {
    observe(target?: Element) {
      if (target) {
        const width = Number.parseInt((target as HTMLElement).style.width || "0", 10);
        Object.defineProperty(target, "clientWidth", {
          configurable: true,
          value: width || 320,
        });
      }
    }
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

vi.mock("@chrona/i18n/react", () => ({
  useI18n: () => ({ messages: {} }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) => {
    if (asChild && children) {
      return <>{children}</>;
    }
    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" "),
}));

vi.mock("@/components/tasks/plan/task-plan-graph", () => ({
  TaskPlanGraph: ({ mode, plan }: { mode?: string; plan: TaskPlanGraphPlan }) => (
    <div aria-label="Task plan graph" data-graph-mode={mode === "auto" ? "compact" : mode}>
      {plan.nodes.map((node) => (
        <div
          data-node-tone={node.linkedTaskId ? "child-task" : undefined}
          data-testid={`task-plan-outline-node-${node.id}`}
          key={node.id}
        >
          {node.title}
        </div>
      ))}
      {plan.analytics.attentionNodeIds.length ? <span>Needs action</span> : null}
      {plan.analytics.activeNodeIds.length ? <span>Current progress</span> : null}
    </div>
  ),
}));

import { TaskPlanSidePanel } from "@/components/work/task-plan-side-panel";
import { DEFAULT_WORK_PAGE_COPY } from "@/components/work/work-page/work-page-copy";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph";

function testPlan(input: Omit<TaskPlanGraphPlan, "nodes" | "analytics">): TaskPlanGraphPlan {
  return {
    ...input,
    nodes: input.steps,
    analytics: {
      entryNodeIds: input.steps.slice(0, 1).map((node) => node.id),
      terminalNodeIds: input.steps.slice(-1).map((node) => node.id),
      activeNodeIds: input.steps.filter((node) => node.status === "active" || node.status === "in_progress").map((node) => node.id),
      reachableFromActiveIds: input.steps.map((node) => node.id),
      criticalPathNodeIds: input.steps.map((node) => node.id),
      attentionNodeIds: input.steps.filter((node) => node.status === "waiting" || node.status === "waiting_for_user").map((node) => node.id),
      blockedNodeIds: input.steps.filter((node) => node.status === "blocked").map((node) => node.id),
      rankByNodeId: Object.fromEntries(input.steps.map((node, index) => [node.id, index])),
      laneByNodeId: Object.fromEntries(input.steps.map((node) => [node.id, 0])),
      upstreamByNodeId: Object.fromEntries(input.steps.map((node) => [node.id, []])),
      downstreamByNodeId: Object.fromEntries(input.steps.map((node) => [node.id, []])),
    },
  };
}

describe("TaskPlanSidePanel", () => {
  it("renders graph-native sections for current node, waiting nodes, checkpoints, and linked child tasks", () => {
    render(
      <TaskPlanSidePanel
        copy={DEFAULT_WORK_PAGE_COPY}
        plan={testPlan({
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
              requiresHumanInput: false,
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
              requiresHumanInput: true,
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
              requiresHumanInput: false,
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
              requiresHumanInput: false,
              type: "step",
              executionMode: "child_task",
              linkedTaskId: "child-task-1",
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "step-current", toNodeId: "step-linked", type: "sequential" },
            { id: "edge-2", fromNodeId: "step-linked", toNodeId: "step-checkpoint", type: "sequential" },
          ],
        })}
        isPending={false}
        currentAction={{ label: "补充执行要求", href: "/work/input" }}
        currentException={null}
      />,
    );

    const graph = screen.getByLabelText("Task plan graph");
    expect(graph).toBeInTheDocument();
    expect(graph).toHaveAttribute("data-graph-mode", "compact");
    expect(screen.getByText("物化可执行子任务")).toBeInTheDocument();
    expect(screen.getByTestId("task-plan-outline-node-step-linked").getAttribute("data-node-tone")).toBe("child-task");
    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.getByText("Current progress")).toBeInTheDocument();
    expect(screen.queryByText("已关联子任务")).not.toBeInTheDocument();
  });
});
