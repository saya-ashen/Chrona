import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {} }),
}));

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

afterEach(() => {
  cleanup();
});

describe("TaskPlanGraph", () => {
  it("renders a compact read-only React Flow graph that pans the canvas instead of dragging nodes", () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={{
          state: "ready",
          currentStepId: "node-current",
          steps: [
            {
              id: "node-current",
              title: "当前执行节点",
              objective: "这是一个比较长的说明，用来验证未展开时会被收敛成真正像节点的卡片，而不是把全部正文都摊开。",
              phase: "user_input",
              status: "waiting_for_user",
              requiresHumanInput: true,
              type: "user_input",
              executionMode: "manual",
              linkedTaskId: null,
              estimatedMinutes: 20,
              priority: "High",
            },
            {
              id: "node-child",
              title: "已物化子任务",
              objective: "这是一个 child task 节点",
              phase: "execution",
              status: "pending",
              requiresHumanInput: false,
              type: "step",
              executionMode: "automatic",
              linkedTaskId: "child-1",
              estimatedMinutes: 45,
              priority: "Urgent",
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-current", toNodeId: "node-child", type: "sequential" },
          ],
        }}
      />,
    );

    const graph = screen.getByLabelText("任务计划图");
    expect(graph).toBeInTheDocument();
    expect(graph).toHaveAttribute("data-renderer", "react-flow");
    expect(graph).toHaveAttribute("data-layout-engine", "dagre");
    expect(graph).toHaveAttribute("data-layout-direction", "TB");
    expect(graph).toHaveAttribute("data-graph-interactive", "true");
    expect(graph).toHaveAttribute("data-graph-editable", "false");
    expect(graph).toHaveAttribute("data-canvas-pan", "true");
    expect(graph).toHaveAttribute("data-edge-style", "orthogonal");
    expect(graph.querySelector(".react-flow")).not.toBeNull();
    expect(graph.querySelector(".react-flow__pane.draggable")).not.toBeNull();
    expect(graph.querySelector(".react-flow__edges")).not.toBeNull();
    expect(graph.querySelector(".react-flow__node[data-id='node-current'] .source")).not.toBeNull();
    expect(graph.querySelector(".react-flow__node[data-id='node-current'] .target")).not.toBeNull();
    expect(graph.querySelector("marker")).not.toBeNull();
    expect(graph.querySelector(".react-flow__edgelabel-renderer")?.childElementCount ?? 0).toBe(0);

    const legend = within(graph).getByTestId("task-plan-graph-legend");
    expect(legend).toHaveTextContent("顺序执行");
    expect(legend).toHaveTextContent("依赖于");
    expect(legend).toHaveTextContent("分支到");
    expect(legend).toHaveTextContent("解除阻塞");
    expect(legend).toHaveTextContent("输出流向");
    expect(legend).toHaveTextContent("step · 普通步骤");
    expect(legend).toHaveTextContent("user_input · 用户输入");
    expect(legend).toHaveTextContent("decision · 决策/审批");
    expect(legend).toHaveTextContent("deliverable · 交付结果");
    expect(within(legend).getByTestId("task-plan-graph-node-legend")).toBeInTheDocument();
    const legendOverlay = legend.parentElement as HTMLElement | null;
    expect(legendOverlay).not.toBeNull();
    expect(legendOverlay?.className).toContain("absolute");
    expect(legendOverlay?.className).toContain("bottom-0");
    expect(legendOverlay?.className).toContain("justify-end");

    const scrollShell = within(graph).getByTestId("task-plan-graph-scroll");
    expect(scrollShell.className).toContain("overflow-auto");
    expect(scrollShell.contains(legend)).toBe(false);

    const canvas = within(graph).getByTestId("task-plan-graph-canvas");
    expect(Number.parseInt(canvas.style.height, 10)).toBeGreaterThanOrEqual(260);
    expect(Number.parseInt(canvas.style.height, 10)).toBeLessThanOrEqual(540);
    expect(Number.parseInt(canvas.style.minWidth, 10)).toBeLessThan(296 * 2 + 64);

    const currentNode = screen.getByTestId("task-plan-node-node-current");
    expect(currentNode.getAttribute("data-node-current")).toBe("true");
    expect(currentNode.getAttribute("data-node-selected")).toBe("false");
    expect(currentNode.getAttribute("data-node-shape")).toBe("rounded");
    expect(currentNode).not.toHaveTextContent("等待你处理");
    expect(currentNode).toHaveTextContent("user_input");

    const childNode = screen.getByTestId("task-plan-node-node-child");
    expect(childNode.getAttribute("data-node-tone")).toBe("child-task");
    expect(childNode.getAttribute("data-node-shape")).toBe("rounded");
    expect(childNode).not.toHaveTextContent("待处理");
    expect(childNode).toHaveTextContent("execution");
  });

  it("keeps nodes clickable in read-only mode and keeps the expanded node above others within the visible graph frame", () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={{
          state: "ready",
          currentStepId: "node-current",
          steps: [
            {
              id: "node-top",
              title: "上游节点",
              objective: "上游说明",
              phase: "planning",
              status: "done",
              requiresHumanInput: false,
              type: "step",
              executionMode: "automatic",
              linkedTaskId: null,
            },
            {
              id: "node-current",
              title: "当前执行节点",
              objective: "当前正在处理",
              phase: "execution",
              status: "in_progress",
              requiresHumanInput: false,
              type: "step",
              executionMode: "automatic",
              linkedTaskId: null,
            },
            {
              id: "node-deliverable",
              title: "产出说明文档",
              objective: "整理最终交付物，包含较长内容以验证展开后才显示完整详情。",
              phase: "delivery",
              status: "pending",
              requiresHumanInput: false,
              type: "deliverable",
              executionMode: "hybrid",
              linkedTaskId: "child-9",
              estimatedMinutes: 60,
              priority: "Urgent",
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-top", toNodeId: "node-current", type: "sequential" },
            { id: "edge-2", fromNodeId: "node-current", toNodeId: "node-deliverable", type: "feeds_output" },
          ],
        }}
      />
    );

    const graph = screen.getByLabelText("任务计划图");
    const deliverableNode = screen.getByTestId("task-plan-node-node-deliverable");

    fireEvent.click(deliverableNode);

    expect(graph).toHaveAttribute("data-graph-editable", "false");
    expect(deliverableNode.getAttribute("data-node-selected")).toBe("true");
    expect(deliverableNode.getAttribute("data-node-shape")).toBe("pill");
    expect(deliverableNode).toHaveTextContent("产出说明文档");
    expect(deliverableNode).toHaveTextContent("delivery");
    expect(deliverableNode).toHaveTextContent("deliverable");
    expect(deliverableNode).toHaveTextContent("待处理");
    expect(deliverableNode).toHaveTextContent("hybrid");
    expect(deliverableNode).toHaveTextContent("Urgent");
    expect(deliverableNode).toHaveTextContent("60 min");
    expect(deliverableNode).toHaveTextContent("child-9");
    expect(deliverableNode).toHaveTextContent("详细说明");

    const flowNodeWrapper = graph.querySelector(".react-flow__node[data-id='node-deliverable']") as HTMLElement | null;
    expect(flowNodeWrapper).not.toBeNull();
    expect(flowNodeWrapper?.style.zIndex).toBe("1000");

    const canvas = within(graph).getByTestId("task-plan-graph-canvas");
    const scrollShell = within(graph).getByTestId("task-plan-graph-scroll");
    expect(Number.parseInt(canvas.style.height, 10)).toBeGreaterThanOrEqual(Number.parseInt(scrollShell.style.height || "0", 10));
  });

  it("maps semantic node types to flowchart-like shapes", () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={{
          state: "ready",
          currentStepId: "node-tool",
          steps: [
            {
              id: "node-decision",
              title: "决定是否扩展范围",
              objective: "需要在两个方案之间做选择",
              phase: "planning",
              status: "pending",
              requiresHumanInput: false,
              type: "decision",
              executionMode: "manual",
              linkedTaskId: null,
            },
            {
              id: "node-tool",
              title: "调用检索工具",
              objective: "自动拉取信息",
              phase: "execution",
              status: "in_progress",
              requiresHumanInput: false,
              type: "tool_action",
              executionMode: "automatic",
              linkedTaskId: null,
            },
            {
              id: "node-checkpoint",
              title: "核对结果完整性",
              objective: "确认结果符合预期",
              phase: "review",
              status: "pending",
              requiresHumanInput: false,
              type: "checkpoint",
              executionMode: "hybrid",
              linkedTaskId: null,
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-decision", toNodeId: "node-tool", type: "branches_to" },
            { id: "edge-2", fromNodeId: "node-tool", toNodeId: "node-checkpoint", type: "sequential" },
          ],
        }}
      />,
    );

    expect(screen.getByTestId("task-plan-node-node-decision")).toHaveAttribute("data-node-shape", "diamond");
    expect(screen.getByTestId("task-plan-node-node-tool")).toHaveAttribute("data-node-shape", "hex");
    expect(screen.getByTestId("task-plan-node-node-checkpoint")).toHaveAttribute("data-node-shape", "parallelogram");
  });

  it("automatically switches to full mode when enough width is available", () => {
    render(
      <div style={{ width: "960px" }} data-testid="wide-graph-host">
        <TaskPlanGraph
          mode="auto"
          plan={{
            state: "ready",
            currentStepId: "node-current",
            steps: [
              {
                id: "node-current",
                title: "当前执行节点",
                objective: "当前正在处理",
                phase: "execution",
                status: "in_progress",
                requiresHumanInput: false,
                type: "step",
                executionMode: "automatic",
                linkedTaskId: null,
              },
              {
                id: "node-child",
                title: "物化可执行子任务",
                objective: "映射真实 child task",
                phase: "follow-up",
                status: "pending",
                requiresHumanInput: false,
                type: "step",
                executionMode: "automatic",
                linkedTaskId: "child-3",
              },
            ],
            edges: [
              { id: "edge-1", fromNodeId: "node-current", toNodeId: "node-child", type: "sequential" },
            ],
          }}
        />
      </div>
    );

    const host = screen.getByTestId("wide-graph-host");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 960 });

    const graph = screen.getByLabelText("任务计划图");
    expect(graph).toHaveAttribute("data-graph-mode", "full");
    expect(graph.querySelector(".react-flow")).not.toBeNull();
  });

  it("renders a compact outline mode for sidebar usage with grouped nodes and no full graph chrome", () => {
    render(
      <TaskPlanGraph
        mode="compact"
        plan={{
          state: "ready",
          currentStepId: "node-current",
          steps: [
            {
              id: "node-current",
              title: "当前执行节点",
              objective: "当前正在处理",
              phase: "execution",
              status: "in_progress",
              requiresHumanInput: false,
              type: "step",
              executionMode: "automatic",
              linkedTaskId: null,
            },
            {
              id: "node-waiting",
              title: "等待用户确认范围",
              objective: "收集边界条件",
              phase: "input",
              status: "waiting_for_user",
              requiresHumanInput: true,
              type: "user_input",
              executionMode: "manual",
              linkedTaskId: null,
            },
            {
              id: "node-child",
              title: "物化可执行子任务",
              objective: "映射真实 child task",
              phase: "follow-up",
              status: "pending",
              requiresHumanInput: false,
              type: "step",
              executionMode: "automatic",
              linkedTaskId: "child-3",
            },
            {
              id: "node-deliverable",
              title: "整理交付物",
              objective: "汇总最终结果",
              phase: "delivery",
              status: "pending",
              requiresHumanInput: false,
              type: "deliverable",
              executionMode: "hybrid",
              linkedTaskId: null,
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-current", toNodeId: "node-child", type: "sequential" },
            { id: "edge-2", fromNodeId: "node-child", toNodeId: "node-deliverable", type: "feeds_output" },
          ],
        }}
      />
    );

    const graph = screen.getByLabelText("任务计划图");
    expect(graph).toHaveAttribute("data-graph-mode", "compact");
    expect(graph.querySelector(".react-flow")).toBeNull();
    expect(screen.queryByTestId("task-plan-graph-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-plan-graph-scroll")).not.toBeInTheDocument();

    expect(screen.getByText("当前推进")).toBeInTheDocument();
    expect(screen.getByText("待处理 / 阻塞")).toBeInTheDocument();
    expect(screen.getByText("后续摘要")).toBeInTheDocument();

    const currentOutlineNode = screen.getByTestId("task-plan-outline-node-node-current");
    expect(currentOutlineNode.getAttribute("data-node-current")).toBe("true");
    expect(currentOutlineNode).toHaveTextContent("当前节点");

    const waitingOutlineNode = screen.getByTestId("task-plan-outline-node-node-waiting");
    expect(waitingOutlineNode.getAttribute("data-node-tone")).toBe("waiting");
    expect(waitingOutlineNode).toHaveTextContent("需处理");

    const childOutlineNode = screen.getByTestId("task-plan-outline-node-node-child");
    expect(childOutlineNode).toHaveTextContent("已关联任务");
    expect(childOutlineNode).toHaveTextContent("1 个前置");
    expect(childOutlineNode).toHaveTextContent("1 个后续");

    const deliverableOutlineNode = screen.getByTestId("task-plan-outline-node-node-deliverable");
    expect(deliverableOutlineNode).toHaveTextContent("1 个前置");

    const compactRail = screen.getByTestId("task-plan-compact-groups");
    expect(compactRail.className).toContain("border-l");

    const openFullButton = screen.getByRole("button", { name: "查看完整图" });
    fireEvent.click(openFullButton);

    const dialog = screen.getByRole("dialog", { name: "完整任务计划图" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByTestId("task-plan-graph-full-dialog")).toBeInTheDocument();
    expect(within(dialog).getByTestId("task-plan-graph-full-dialog")).toHaveAttribute("data-renderer", "react-flow");
    expect(within(dialog).getByTestId("task-plan-graph-full-dialog")).toHaveAttribute("data-graph-mode", "full");
    expect(within(dialog).getByTestId("task-plan-graph-legend")).toBeInTheDocument();
  });
});
