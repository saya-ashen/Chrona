import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TaskPlanGraph } from "@/components/tasks/plan/task-plan-graph";
import { DEFAULT_GRAPH_COPY } from "@/components/tasks/plan/task-plan-graph/constants";
import { TaskPlanGraphInspector } from "@/components/tasks/plan/task-plan-graph/inspector";
import { buildFlowLayout } from "@/components/tasks/plan/task-plan-graph/layout";
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

function expectNoNodeOverlap(
  nodes: Array<{ id: string; position: { x: number; y: number }; width?: number; height?: number }>,
) {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      const overlaps =
        left.position.x < right.position.x + (right.width ?? 0) &&
        left.position.x + (left.width ?? 0) > right.position.x &&
        left.position.y < right.position.y + (right.height ?? 0) &&
        left.position.y + (left.height ?? 0) > right.position.y;
      expect(overlaps, `${left.id} overlaps ${right.id}`).toBe(false);
    }
  }
}

vi.mock("@chrona/i18n/react", () => ({
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
  it("renders no graph chrome when a plan is empty or not ready", () => {
    const { rerender } = render(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
          state: "empty",
          currentStepId: null,
          steps: [],
          edges: [],
        })}
      />,
    );

    expect(screen.queryByLabelText("Task plan graph")).not.toBeInTheDocument();

    rerender(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
          state: "empty",
          currentStepId: null,
          steps: [
            {
              id: "node-pending",
              title: "等待计划生成",
              objective: "生成中",
              phase: "planning",
              status: "pending",
              requiresHumanInput: false,
              type: "task",
              displayType: "task",
              executionMode: "automatic",
              linkedTaskId: null,
            },
          ],
          edges: [],
        })}
      />,
    );

    expect(screen.queryByLabelText("Task plan graph")).not.toBeInTheDocument();
  });

  it("presents pending and accepted nodes with selectable execution-console states", async () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
          state: "ready",
          currentStepId: "node-pending",
          steps: [
            {
              id: "node-pending",
              title: "准备执行",
              objective: "等待启动",
              phase: "execution",
              status: "ready",
              requiresHumanInput: false,
              type: "task",
              displayType: "task",
              executionMode: "automatic",
              linkedTaskId: null,
            },
            {
              id: "node-accepted",
              title: "已完成验收",
              objective: "产出已确认",
              phase: "review",
              status: "done",
              requiresHumanInput: false,
              type: "checkpoint",
              displayType: "checkpoint",
              executionMode: "manual",
              linkedTaskId: null,
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-pending", toNodeId: "node-accepted", type: "sequential" },
          ],
        })}
      />,
    );

    const pendingNode = await screen.findByTestId("task-plan-node-node-pending");
    const acceptedNode = screen.getByTestId("task-plan-node-node-accepted");
    expect(pendingNode).toHaveTextContent("Ready");
    expect(pendingNode).toHaveAttribute("data-node-current", "true");
    expect(acceptedNode).toHaveTextContent("Done");

    fireEvent.click(acceptedNode);

    expect(acceptedNode).toHaveAttribute("data-node-selected", "true");
    expect(acceptedNode).toHaveAttribute("data-node-shape", "parallelogram");
  });

  it("maps user-facing execution states to stable node markers", async () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
          state: "ready",
          currentStepId: "node-running",
          steps: [
            {
              id: "node-completed",
              title: "Completed step",
              objective: "Finished work",
              phase: "done",
              status: "done",
              type: "task",
              displayType: "task",
              resultOutputs: [{ kind: "text", content: "artifact summary" }],
            },
            {
              id: "node-running",
              title: "Running step",
              objective: "In flight",
              phase: "execute",
              status: "active",
              type: "task",
              displayType: "task",
            },
            {
              id: "node-waiting",
              title: "Waiting step",
              objective: "Queued work",
              phase: "queue",
              status: "waiting",
              interactionType: "wait",
              type: "wait",
              displayType: "wait",
            },
            {
              id: "node-approval",
              title: "Approval step",
              objective: "Needs review",
              phase: "review",
              status: "waiting_for_user",
              interactionType: "approve",
              requiresHumanInput: true,
              type: "checkpoint",
              displayType: "checkpoint",
            },
            {
              id: "node-blocked",
              title: "Blocked step",
              objective: "Needs retry",
              phase: "recover",
              status: "blocked",
              type: "condition",
              displayType: "condition",
            },
          ],
          edges: [],
        })}
      />,
    );

    expect(await screen.findByTestId("task-plan-node-node-completed")).toHaveAttribute("data-node-execution-status", "completed");
    expect(screen.getByTestId("task-plan-node-node-completed")).toHaveAttribute("data-node-has-artifacts", "true");
    expect(screen.getByTestId("task-plan-node-node-running")).toHaveAttribute("data-node-execution-status", "running");
    expect(screen.getByTestId("task-plan-node-node-waiting")).toHaveAttribute("data-node-execution-status", "waiting");
    expect(screen.getByTestId("task-plan-node-node-approval")).toHaveAttribute("data-node-execution-status", "approval-needed");
    expect(screen.getByTestId("task-plan-node-node-approval")).toHaveAttribute("data-node-requires-action", "true");
    expect(screen.getByTestId("task-plan-node-node-blocked")).toHaveAttribute("data-node-execution-status", "blocked");
    expect(screen.getByTestId("task-plan-node-node-blocked")).toHaveAttribute("data-node-requires-action", "true");
  });

  it("keeps long titles, generated plan text, and error summaries contained in graph surfaces", async () => {
    const longTitle = "Investigate an unusually long generated execution node title that should stay clipped inside the graph card without hiding controls";
    const longObjective = "Generated plan text: collect logs, compare checkpoints, write a diagnostic summary, and include enough detail to reproduce the blocked execution state without expanding the node beyond the graph viewport.";
    const longError = "Provider timeout while waiting for checkpoint review output after multiple retries; keep this error visible in the inspector without overflowing the modal.";

    render(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
          state: "ready",
          currentStepId: "node-long",
          steps: [
            {
              id: "node-long",
              title: longTitle,
              objective: longObjective,
              summary: longObjective,
              phase: "diagnostics",
              status: "blocked",
              statusLabel: "Retry needed after provider timeout",
              nextAction: "Retry after checking checkpoint evidence and provider logs",
              type: "checkpoint",
              displayType: "checkpoint",
              metadata: { error: longError },
            },
          ],
          edges: [],
        })}
      />,
    );

    const node = await screen.findByTestId("task-plan-node-node-long");
    expect(node).toHaveTextContent(longTitle);
    expect(node).toHaveAttribute("data-node-execution-status", "blocked");
    expect(node).toHaveClass("overflow-hidden");
    expect(screen.getByText(longTitle)).toHaveClass("break-words");

    fireEvent.click(node);
    expect(screen.getAllByText(longObjective).length).toBeGreaterThan(0);
    const errorText = screen.getByText(longError);
    expect(errorText).toBeInTheDocument();
    expect(errorText.closest("aside")).toHaveClass("overflow-hidden");
    expect(screen.getByText(/Next:/)).toBeInTheDocument();
    expect(screen.getAllByText("Retry after checking checkpoint evidence and provider logs").length).toBeGreaterThan(0);
  });

  it("shows inspector guidance when no graph node is selected", () => {
    render(
      <TaskPlanGraphInspector
        graphCopy={DEFAULT_GRAPH_COPY}
        node={null}
      />,
    );

    expect(screen.getByText("No node selected")).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_GRAPH_COPY.inspectorEmpty)).toBeInTheDocument();
  });

  it("dispatches execution actions from the node inspector", async () => {
    const onDispatchExecutionAction = vi.fn().mockResolvedValue({ message: "Retry queued" });

    render(
      <TaskPlanGraphInspector
        graphCopy={DEFAULT_GRAPH_COPY}
        node={{
          id: "node-failed",
          title: "Recover failed node",
          objective: "Retry the stale failed run.",
          phase: "execution",
          status: "pending",
          type: "task",
          interactionType: "retry",
          availableActions: [
            {
              id: "task-primary:retry_sync:node-failed",
              label: "Retry Run",
              kind: "retry",
              emphasis: "danger",
              executionAction: { action: "retry_node", nodeId: "node-failed" },
            },
          ],
        }}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />,
    );

    expect(screen.getByRole("button", { name: "Retry Run" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onDispatchExecutionAction).toHaveBeenCalledWith({
      action: "retry_node",
      nodeId: "node-failed",
    }));
    expect(await screen.findByText("Retry queued")).toBeInTheDocument();
  });

  it("renders a compact read-only React Flow graph that pans the canvas instead of dragging nodes", async () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
          state: "ready",
          currentStepId: "node-current",
          steps: [
            {
              id: "node-current",
              title: "当前执行节点",
              objective: "这是一个比较长的说明，用来验证未展开时会被收敛成真正像节点的卡片，而不是把全部正文都摊开。",
              phase: "checkpoint",
              status: "waiting_for_user",
              requiresHumanInput: true,
              type: "checkpoint",
              displayType: "checkpoint",
              executionMode: "manual",
              linkedTaskId: null,
              estimatedMinutes: 20,
              priority: "High",
              metadata: { checkpointType: "input", prompt: "你希望调整哪些参数？" },
            },
            {
              id: "node-child",
              title: "已物化子任务",
              objective: "这是一个 child task 节点",
              phase: "execution",
              status: "pending",
              requiresHumanInput: false,
              type: "task",
              displayType: "task",
              executionMode: "automatic",
              linkedTaskId: "child-1",
              estimatedMinutes: 45,
              priority: "Urgent",
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-current", toNodeId: "node-child", type: "sequential" },
          ],
        })}
      />,
    );

    const graph = await screen.findByLabelText("Task plan graph");
    expect(graph).toBeInTheDocument();
    expect(graph).toHaveAttribute("data-renderer", "react-flow");
    expect(graph).toHaveAttribute("data-layout-engine", "elk-layered");
    expect(graph).toHaveAttribute("data-layout-direction", "TB");
    expect(graph).toHaveAttribute("data-graph-interactive", "true");
    expect(graph).toHaveAttribute("data-graph-editable", "false");
    expect(graph).toHaveAttribute("data-canvas-pan", "true");
    expect(graph).toHaveAttribute("data-edge-style", "orthogonal");
    expect(graph.querySelector(".react-flow")).not.toBeNull();
    expect(graph.querySelector(".react-flow__pane.draggable")).not.toBeNull();
    expect(graph.querySelector(".react-flow__edges")).not.toBeNull();
    const currentFlowNode = graph.querySelector(".react-flow__node[data-id='node-current']") as HTMLElement | null;
    expect(currentFlowNode?.querySelector("[data-handleid='bottom-source']")).not.toBeNull();
    expect(currentFlowNode?.querySelector<HTMLElement>("[data-handleid='bottom-source']")?.style.opacity).toBe("0");
    expect(currentFlowNode?.querySelector<HTMLElement>("[data-handleid='bottom-center-source']")?.style.left).toBe("50%");
    expect(currentFlowNode?.querySelector<HTMLElement>("[data-handleid='top-center-target']")?.style.left).toBe("50%");
    expect(currentFlowNode?.querySelector<HTMLElement>("[data-handleid='bottom-source']")?.style.left).toBe("56%");
    expect(currentFlowNode?.querySelector<HTMLElement>("[data-handleid='bottom-target']")?.style.left).toBe("44%");
    expect(currentFlowNode?.querySelector<HTMLElement>("[data-handleid='right-source']")?.style.top).toBe("56%");
    expect(currentFlowNode?.querySelector<HTMLElement>("[data-handleid='right-target']")?.style.top).toBe("44%");
    expect(graph.querySelector("marker")).not.toBeNull();
    expect(graph.querySelector(".react-flow__edgelabel-renderer")?.childElementCount ?? 0).toBe(0);

    const legend = within(graph).getByTestId("task-plan-graph-legend");
    expect(legend).toHaveTextContent("Sequential");
    expect(legend).toHaveTextContent("Dependency");
    expect(legend).toHaveTextContent("Task");
    expect(legend).toHaveTextContent("Checkpoint");
    expect(legend).toHaveTextContent("Condition");
    expect(legend).toHaveTextContent("Waiting");
    expect(legend).toHaveTextContent("Skipped");
    expect(within(legend).getByTestId("task-plan-graph-node-legend")).toBeInTheDocument();
    const legendOverlay = legend.parentElement as HTMLElement | null;
    expect(legendOverlay).not.toBeNull();
    expect(legendOverlay?.className).toContain("absolute");
    expect(legendOverlay?.className).toContain("bottom-4");
    expect(legendOverlay?.className).toContain("justify-center");

    const scrollShell = within(graph).getByTestId("task-plan-graph-scroll");
    expect(scrollShell.className).toContain("overflow-hidden");
    expect(scrollShell).toHaveAttribute("data-wheel-pan", "scroll");
    expect(scrollShell).toHaveAttribute("data-wheel-zoom", "modifier-or-pinch");
    expect(scrollShell.contains(legend)).toBe(false);

    const canvas = within(graph).getByTestId("task-plan-graph-canvas");
    expect(Number.parseInt(scrollShell.style.height, 10)).toBeGreaterThanOrEqual(260);
    expect(Number.parseInt(scrollShell.style.height, 10)).toBeLessThanOrEqual(620);
    expect(canvas.style.height).toBe("100%");
    expect(canvas.style.minWidth).toBe("100%");

    const wheelHint = within(graph).getByTestId("task-plan-graph-wheel-hint");
    expect(wheelHint).toHaveTextContent("Hold Ctrl/Cmd and scroll to zoom the canvas");
    expect(wheelHint.className).toContain("opacity-0");
    fireEvent.wheel(scrollShell, { deltaY: 120 });
    expect(wheelHint.className).toContain("opacity-100");

    const currentNode = screen.getByTestId("task-plan-node-node-current");
    expect(currentNode.getAttribute("data-node-current")).toBe("true");
    expect(currentNode.getAttribute("data-node-selected")).toBe("false");
    expect(currentNode.getAttribute("data-node-shape")).toBe("parallelogram");
    expect(currentNode.getAttribute("data-node-display-type")).toBe("checkpoint");
    expect(currentNode).toHaveTextContent("Checkpoint");
    expect(currentNode).not.toHaveTextContent("你希望调整哪些参数？");

    const childNode = screen.getByTestId("task-plan-node-node-child");
    expect(childNode.getAttribute("data-node-tone")).toBe("child-task");
    expect(childNode.getAttribute("data-node-shape")).toBe("rounded");
    expect(childNode.getAttribute("data-node-display-type")).toBe("task");
  });

  it("exposes graph flow controls and preserves selected node while controls are used", async () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
          state: "ready",
          currentStepId: "node-current",
          steps: [
            {
              id: "node-current",
              title: "Current node",
              objective: "Currently running",
              phase: "execution",
              status: "active",
              type: "task",
              displayType: "task",
            },
            {
              id: "node-next",
              title: "Next node",
              objective: "Follow up",
              phase: "delivery",
              status: "ready",
              type: "task",
              displayType: "task",
            },
          ],
          edges: [{ id: "edge-1", fromNodeId: "node-current", toNodeId: "node-next", type: "sequential" }],
        })}
      />,
    );

    const selectedNode = await screen.findByTestId("task-plan-node-node-next");
    fireEvent.click(selectedNode);

    expect(selectedNode).toHaveAttribute("data-node-selected", "true");

    const controls = screen.getByTestId("task-plan-graph-controls");
    expect(within(controls).getByRole("button", { name: "Zoom in" })).toBeEnabled();
    expect(within(controls).getByRole("button", { name: "Zoom out" })).toBeEnabled();
    expect(within(controls).getByRole("button", { name: "Fit graph" })).toBeEnabled();
    expect(within(controls).getByRole("button", { name: "Center current node" })).toBeEnabled();
    expect(within(controls).getByRole("button", { name: "Expand graph" })).toBeEnabled();

    fireEvent.click(within(controls).getByRole("button", { name: "Zoom in" }));
    fireEvent.click(within(controls).getByRole("button", { name: "Zoom out" }));
    fireEvent.click(within(controls).getByRole("button", { name: "Fit graph" }));
    fireEvent.click(within(controls).getByRole("button", { name: "Center current node" }));

    expect(selectedNode).toHaveAttribute("data-node-selected", "true");

    fireEvent.click(within(controls).getByRole("button", { name: "Expand graph" }));
    const dialog = screen.getByRole("dialog", { name: "Full execution graph" });
    expect(within(dialog).getByTestId("task-plan-node-node-next")).toHaveAttribute("data-node-selected", "true");
  });

  it("keeps nodes clickable in read-only mode and keeps the expanded node above others within the visible graph frame", async () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
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
              type: "task",
              displayType: "task",
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
              type: "task",
              displayType: "task",
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
              type: "task",
              displayType: "task",
              executionMode: "hybrid",
              linkedTaskId: "child-9",
              estimatedMinutes: 60,
              priority: "Urgent",
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-top", toNodeId: "node-current", type: "sequential" },
            { id: "edge-2", fromNodeId: "node-current", toNodeId: "node-deliverable", type: "sequential" },
          ],
        })}
      />
    );

    const graph = await screen.findByLabelText("Task plan graph");
    const deliverableNode = await screen.findByTestId("task-plan-node-node-deliverable");

    fireEvent.click(deliverableNode);

    expect(graph).toHaveAttribute("data-graph-editable", "false");
    expect(deliverableNode.getAttribute("data-node-selected")).toBe("true");
    expect(deliverableNode.getAttribute("data-node-shape")).toBe("rounded");
    expect(deliverableNode.getAttribute("data-node-display-type")).toBe("task");
    expect(deliverableNode).toHaveTextContent("产出说明文档");
    expect(deliverableNode).toHaveTextContent("60 min");
    expect(deliverableNode).not.toHaveTextContent("hybrid");
    expect(deliverableNode).not.toHaveTextContent("Urgent");
    expect(deliverableNode).not.toHaveTextContent("child-9");
    expect(deliverableNode).not.toHaveTextContent("详细说明");

    const flowNodeWrapper = graph.querySelector(".react-flow__node[data-id='node-deliverable']") as HTMLElement | null;
    expect(flowNodeWrapper).not.toBeNull();
    expect(flowNodeWrapper?.style.zIndex).toBe("1000");

    const canvas = within(graph).getByTestId("task-plan-graph-canvas");
    expect(canvas.style.height).toBe("100%");
  });

  it("maps semantic node types to flowchart-like shapes", async () => {
    render(
      <TaskPlanGraph
        mode="full"
        plan={testPlan({
          state: "ready",
          currentStepId: "node-task",
          steps: [
            {
              id: "node-condition",
              title: "决定是否扩展范围",
              objective: "需要在两个方案之间做选择",
              phase: "planning",
              status: "pending",
              requiresHumanInput: false,
              type: "condition",
              displayType: "condition",
              executionMode: "manual",
              linkedTaskId: null,
              metadata: { condition: "范围是否大于 100 项？", evaluationBy: "user", branches: [{ label: "是" }, { label: "否" }] },
            },
            {
              id: "node-task",
              title: "执行核心任务",
              objective: "自动拉取信息",
              phase: "execution",
              status: "in_progress",
              requiresHumanInput: false,
              type: "task",
              displayType: "task",
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
              displayType: "checkpoint",
              executionMode: "hybrid",
              linkedTaskId: null,
              metadata: { checkpointType: "confirm", prompt: "结果是否完整？" },
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-condition", toNodeId: "node-task", type: "depends_on" },
            { id: "edge-2", fromNodeId: "node-task", toNodeId: "node-checkpoint", type: "sequential" },
          ],
        })}
      />,
    );

    const conditionNode = await screen.findByTestId("task-plan-node-node-condition");
    expect(conditionNode).toHaveAttribute("data-node-shape", "diamond");
    expect(screen.getByTestId("task-plan-node-node-task")).toHaveAttribute("data-node-shape", "rounded");
    const checkpointNode = screen.getByTestId("task-plan-node-node-checkpoint");
    expect(checkpointNode).toHaveAttribute("data-node-shape", "parallelogram");
    expect(conditionNode.querySelector('polygon[points="16,1 84,1 99,50 84,99 16,99 1,50"]')).not.toBeNull();
    expect(checkpointNode.querySelector('polygon[points="10,1 99,1 90,99 1,99"]')).not.toBeNull();
  });

  it("uses hybrid lanes for branch and sidecar nodes instead of a single vertical rail", async () => {
    const plan = testPlan({
      state: "ready",
      currentStepId: "start",
      steps: [
        {
          id: "start",
          title: "Start",
          objective: "Begin flow",
          phase: "start",
          status: "done",
          type: "task",
          displayType: "task",
        },
        {
          id: "choice",
          title: "Choose path",
          objective: "Split work",
          phase: "decision",
          status: "active",
          type: "condition",
          displayType: "condition",
        },
        {
          id: "branch-left",
          title: "Left branch",
          objective: "Branch work",
          phase: "branch",
          status: "pending",
          type: "task",
          displayType: "task",
        },
        {
          id: "branch-right",
          title: "Right branch",
          objective: "Alternative work",
          phase: "branch",
          status: "pending",
          type: "task",
          displayType: "task",
        },
        {
          id: "approval",
          title: "Approve scope",
          objective: "Human checkpoint",
          phase: "review",
          status: "waiting_for_user",
          requiresHumanInput: true,
          interactionType: "approve",
          intent: "approval",
          type: "checkpoint",
          displayType: "checkpoint",
        },
      ],
      edges: [
        { id: "edge-start-choice", fromNodeId: "start", toNodeId: "choice", type: "sequential" },
        { id: "edge-choice-left", fromNodeId: "choice", toNodeId: "branch-left", type: "branch_true" },
        { id: "edge-choice-right", fromNodeId: "choice", toNodeId: "branch-right", type: "branch_false" },
        { id: "edge-choice-approval", fromNodeId: "choice", toNodeId: "approval", type: "dependency" },
      ],
    });
    plan.analytics.criticalPathNodeIds = ["start", "choice"];
    plan.analytics.rankByNodeId = { start: 0, choice: 1, "branch-left": 2, "branch-right": 2, approval: 2 };
    plan.analytics.laneByNodeId = { start: 0, choice: 0, "branch-left": -1, "branch-right": 1, approval: 2 };

    const layout = await buildFlowLayout({
      plan,
      selectedNodeId: null,
      graphCopy: DEFAULT_GRAPH_COPY,
      onSelect: vi.fn(),
    });

    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
    const choice = nodeById.get("choice");
    const left = nodeById.get("branch-left");
    const right = nodeById.get("branch-right");
    const approval = nodeById.get("approval");
    const leftEdge = layout.edges.find((edge) => edge.id === "edge-choice-left");
    const rightEdge = layout.edges.find((edge) => edge.id === "edge-choice-right");

    expect(choice?.data.layoutRole).toBe("primary");
    expect(left?.data.layoutRole).toBe("branch");
    expect(right?.data.layoutRole).toBe("branch");
    expect(approval?.data.layoutRole).toBe("sidecar");
    expect((left?.position.x ?? 0)).toBeLessThan(right?.position.x ?? 0);
    expect(approval?.position.x ?? 0).toBeGreaterThan(choice?.position.x ?? 0);
    expect(approval?.position.y ?? 0).toBeGreaterThan(choice?.position.y ?? 0);
    expect(left?.position.x).not.toBeCloseTo(right?.position.x ?? 0, 0);
    expect(Math.abs((right?.position.x ?? 0) - (left?.position.x ?? 0))).toBeGreaterThan(260);
    expect(approval?.position.x).not.toBeCloseTo(choice?.position.x ?? 0, 0);
    expect(leftEdge?.data?.orientation).toBe("vertical");
    expect(rightEdge?.data?.orientation).toBe("vertical");
    expect(layout.contentWidth).toBeGreaterThan(360);
  });

  it("keeps inactive condition branches visible as skipped paths", async () => {
    const plan = testPlan({
      state: "ready",
      currentStepId: "branch-selected",
      steps: [
        { id: "choice", title: "Choose path", objective: "Pick branch", phase: "decision", status: "done", type: "condition", displayType: "condition" },
        { id: "branch-selected", title: "Selected branch", objective: "Run this path", phase: "run", status: "active", type: "task", displayType: "task", reachable: true },
        { id: "branch-skipped", title: "Skipped branch", objective: "Not selected", phase: "skip", status: "skipped", type: "task", displayType: "task", reachable: false },
      ],
      edges: [
        { id: "edge-selected", fromNodeId: "choice", toNodeId: "branch-selected", kind: "branch_option", label: "是", active: true },
        { id: "edge-skipped", fromNodeId: "choice", toNodeId: "branch-skipped", kind: "branch_option", label: "否", active: false, emphasis: "inactive" },
      ],
    });
    plan.analytics.reachableFromActiveIds = ["choice", "branch-selected"];

    const layout = await buildFlowLayout({
      plan,
      selectedNodeId: null,
      graphCopy: DEFAULT_GRAPH_COPY,
      onSelect: vi.fn(),
    });
    const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
    const skippedEdge = edgeById.get("edge-skipped");
    const skippedNode = layout.nodes.find((node) => node.id === "branch-skipped");

    expect(skippedEdge).toBeDefined();
    expect(skippedEdge?.animated).toBe(false);
    expect(skippedEdge?.style?.strokeDasharray).toBe("3 6");
    expect(skippedEdge?.style?.opacity).toBe(0.58);
    expect(skippedEdge?.zIndex).toBe(3);
    expect(skippedNode?.data.tone).toBe("skipped");
    expect(skippedNode?.style?.opacity).toBe(0.58);
  });

  it("lays out long linear plans with ELK layered coordinates", async () => {
    const steps = Array.from({ length: 6 }, (_, index) => ({
      id: `node-${index + 1}`,
      title: `Step ${index + 1}`,
      objective: "Linear work",
      phase: "execute",
      status: index === 0 ? "active" as const : "pending" as const,
      type: "task" as const,
      displayType: "task" as const,
    }));
    const plan = testPlan({
      state: "ready",
      currentStepId: "node-1",
      steps,
      edges: steps.slice(0, -1).map((node, index) => ({
        id: `edge-${index + 1}`,
        fromNodeId: node.id,
        toNodeId: steps[index + 1].id,
        type: "sequential",
      })),
    });

    const layout = await buildFlowLayout({
      plan,
      selectedNodeId: null,
      graphCopy: DEFAULT_GRAPH_COPY,
      onSelect: vi.fn(),
    });
    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(layout.layoutDirection).toBe("TB");
    expect(nodeById.get("node-1")?.sourcePosition).toBe("bottom");
    expect(nodeById.get("node-2")?.targetPosition).toBe("top");
    expect(nodeById.get("node-2")?.position.y ?? 0).toBeGreaterThan((nodeById.get("node-1")?.position.y ?? 0) + 100);
    expect(nodeById.get("node-6")?.position.y ?? 0).toBeGreaterThan((nodeById.get("node-1")?.position.y ?? 0) + 500);
    expectNoNodeOverlap(layout.nodes);
    expect(layout.edges.some((edge) => edge.sourceHandle === "bottom-center-source" && edge.targetHandle === "top-center-target")).toBe(true);
    expect(layout.edges.some((edge) => edge.data?.orientation === "vertical")).toBe(true);
  });

  it("keeps condition branches and completed checkpoints separated with ELK", async () => {
    const steps = [
      { id: "need", title: "Confirm need", objective: "Scope", phase: "plan", status: "done" as const, type: "checkpoint" as const, displayType: "checkpoint" as const },
      { id: "design", title: "Design script", objective: "Plan", phase: "plan", status: "done" as const, type: "task" as const, displayType: "task" as const },
      { id: "build", title: "Build script", objective: "Implement", phase: "work", status: "done" as const, type: "task" as const, displayType: "task" as const },
      { id: "verify", title: "Verify script", objective: "Test", phase: "verify", status: "done" as const, type: "task" as const, displayType: "task" as const },
      { id: "choice", title: "Check result", objective: "Branch", phase: "decision", status: "done" as const, type: "condition" as const, displayType: "condition" as const },
      { id: "blocked-summary", title: "Summarize blockers", objective: "Skipped", phase: "skip", status: "skipped" as const, type: "task" as const, displayType: "task" as const, reachable: false },
      { id: "deliver", title: "Prepare delivery", objective: "Package", phase: "deliver", status: "done" as const, type: "task" as const, displayType: "task" as const },
      { id: "confirm-write", title: "Confirm write scope", objective: "Manual checkpoint", phase: "review", status: "done" as const, requiresHumanInput: true, type: "checkpoint" as const, displayType: "checkpoint" as const },
      { id: "write", title: "Write file", objective: "Persist", phase: "write", status: "done" as const, type: "task" as const, displayType: "task" as const },
    ];
    const plan = testPlan({
      state: "ready",
      currentStepId: "write",
      steps,
      edges: [
        { id: "edge-need-design", fromNodeId: "need", toNodeId: "design", type: "sequential" },
        { id: "edge-design-build", fromNodeId: "design", toNodeId: "build", type: "sequential" },
        { id: "edge-build-verify", fromNodeId: "build", toNodeId: "verify", type: "sequential" },
        { id: "edge-verify-choice", fromNodeId: "verify", toNodeId: "choice", type: "sequential" },
        { id: "edge-choice-blocked", fromNodeId: "choice", toNodeId: "blocked-summary", kind: "branch_option", active: false, emphasis: "inactive" },
        { id: "edge-choice-deliver", fromNodeId: "choice", toNodeId: "deliver", kind: "branch_option", active: true },
        { id: "edge-deliver-confirm", fromNodeId: "deliver", toNodeId: "confirm-write", type: "sequential" },
        { id: "edge-confirm-write", fromNodeId: "confirm-write", toNodeId: "write", type: "sequential" },
      ],
    });

    const layout = await buildFlowLayout({
      plan,
      selectedNodeId: null,
      graphCopy: DEFAULT_GRAPH_COPY,
      onSelect: vi.fn(),
    });
    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

    expectNoNodeOverlap(layout.nodes);
    expect(nodeById.get("confirm-write")?.data.layoutRole).toBe("primary");
    expect(layout.edges.find((edge) => edge.id === "edge-choice-blocked")?.style?.strokeDasharray).toBe("3 6");
  });

  it("keeps wide task fan-out flowing top-to-bottom through branch nodes", async () => {
    const branchIds = ["branch-a", "branch-b", "branch-c", "branch-d", "branch-e"];
    const plan = testPlan({
      state: "ready",
      currentStepId: "start",
      steps: [
        { id: "start", title: "Start", objective: "Begin", phase: "start", status: "done", type: "task", displayType: "task" },
        ...branchIds.map((id) => ({
          id,
          title: id,
          objective: "Branch work",
          phase: "branch",
          status: "pending" as const,
          type: "task" as const,
          displayType: "task" as const,
        })),
        { id: "join", title: "Join", objective: "Merge", phase: "join", status: "pending", type: "checkpoint", displayType: "checkpoint" },
      ],
      edges: [
        ...branchIds.map((id) => ({ id: `edge-start-${id}`, fromNodeId: "start", toNodeId: id, type: "sequential" })),
        ...branchIds.map((id) => ({ id: `edge-${id}-join`, fromNodeId: id, toNodeId: "join", type: "resume" })),
      ],
    });

    const layout = await buildFlowLayout({
      plan,
      selectedNodeId: null,
      graphCopy: DEFAULT_GRAPH_COPY,
      onSelect: vi.fn(),
    });

    expectNoNodeOverlap(layout.nodes);
    for (const id of branchIds) {
      const incoming = layout.edges.find((edge) => edge.id === `edge-start-${id}`);
      const outgoing = layout.edges.find((edge) => edge.id === `edge-${id}-join`);
      expect(incoming?.sourceHandle).toBe("bottom-center-source");
      expect(incoming?.targetHandle).toBe("top-center-target");
      expect(outgoing?.sourceHandle).toBe("bottom-center-source");
      expect(outgoing?.targetHandle).toBe("top-center-target");
    }
  });

  it("keeps parallel diamond lanes entering from top and exiting from bottom", async () => {
    const laneIds = ["api", "ui", "docs"];
    const plan = testPlan({
      state: "ready",
      currentStepId: "start",
      steps: [
        { id: "start", title: "Start", objective: "Begin", phase: "start", status: "done", type: "task", displayType: "task" },
        { id: "api", title: "API", objective: "Implement API", phase: "branch", status: "pending", type: "task", displayType: "task" },
        { id: "ui", title: "UI", objective: "Implement UI", phase: "branch", status: "pending", type: "task", displayType: "task" },
        { id: "docs", title: "Docs", objective: "Update docs", phase: "branch", status: "pending", type: "task", displayType: "task" },
        { id: "join", title: "Join", objective: "Review", phase: "join", status: "pending", type: "checkpoint", displayType: "checkpoint" },
        { id: "ship", title: "Ship", objective: "Release", phase: "ship", status: "pending", type: "task", displayType: "task" },
      ],
      edges: [
        ...laneIds.map((id) => ({ id: `edge-start-${id}`, fromNodeId: "start", toNodeId: id, type: "sequential" })),
        ...laneIds.map((id) => ({ id: `edge-${id}-join`, fromNodeId: id, toNodeId: "join", type: "resume" })),
        { id: "edge-join-ship", fromNodeId: "join", toNodeId: "ship", type: "sequential" },
      ],
    });

    const layout = await buildFlowLayout({
      plan,
      selectedNodeId: null,
      graphCopy: DEFAULT_GRAPH_COPY,
      onSelect: vi.fn(),
    });

    expectNoNodeOverlap(layout.nodes);
    for (const id of laneIds) {
      const incoming = layout.edges.find((edge) => edge.id === `edge-start-${id}`);
      const outgoing = layout.edges.find((edge) => edge.id === `edge-${id}-join`);
      expect(incoming?.sourceHandle).toBe("bottom-center-source");
      expect(incoming?.targetHandle).toBe("top-center-target");
      expect(incoming?.data?.orientation).toBe("vertical");
      expect(outgoing?.sourceHandle).toBe("bottom-center-source");
      expect(outgoing?.targetHandle).toBe("top-center-target");
      expect(outgoing?.data?.orientation).toBe("vertical");
    }
    expect(layout.edges.find((edge) => edge.id === "edge-join-ship")?.sourceHandle).toBe("bottom-center-source");
  });

  it("keeps branched plans vertical while preserving branch roles", async () => {
    const plan = testPlan({
      state: "ready",
      currentStepId: "start",
      steps: [
        { id: "start", title: "Start", objective: "Begin", phase: "setup", status: "done", type: "task", displayType: "task" },
        { id: "branch-a", title: "Branch A", objective: "Parallel", phase: "check", status: "done", type: "task", displayType: "task" },
        { id: "branch-b", title: "Branch B", objective: "Parallel", phase: "check", status: "done", type: "task", displayType: "task" },
        { id: "join", title: "Join", objective: "Merge", phase: "merge", status: "done", type: "checkpoint", displayType: "checkpoint" },
        { id: "tail-1", title: "Tail 1", objective: "Linear", phase: "run", status: "pending", type: "task", displayType: "task" },
        { id: "tail-2", title: "Tail 2", objective: "Linear", phase: "run", status: "pending", type: "task", displayType: "task" },
        { id: "tail-3", title: "Tail 3", objective: "Linear", phase: "run", status: "pending", type: "task", displayType: "task" },
        { id: "tail-4", title: "Tail 4", objective: "Linear", phase: "run", status: "pending", type: "task", displayType: "task" },
      ],
      edges: [
        { id: "edge-start-a", fromNodeId: "start", toNodeId: "branch-a", type: "branch_true" },
        { id: "edge-start-b", fromNodeId: "start", toNodeId: "branch-b", type: "branch_false" },
        { id: "edge-a-join", fromNodeId: "branch-a", toNodeId: "join", type: "resume" },
        { id: "edge-b-join", fromNodeId: "branch-b", toNodeId: "join", type: "resume" },
        { id: "edge-join-tail-1", fromNodeId: "join", toNodeId: "tail-1", type: "sequential" },
        { id: "edge-tail-1-tail-2", fromNodeId: "tail-1", toNodeId: "tail-2", type: "sequential" },
        { id: "edge-tail-2-tail-3", fromNodeId: "tail-2", toNodeId: "tail-3", type: "sequential" },
        { id: "edge-tail-3-tail-4", fromNodeId: "tail-3", toNodeId: "tail-4", type: "sequential" },
      ],
    });
    plan.analytics.criticalPathNodeIds = ["start", "join"];
    plan.analytics.rankByNodeId = { start: 0, "branch-a": 1, "branch-b": 1, join: 2, "tail-1": 3, "tail-2": 4, "tail-3": 5, "tail-4": 6 };

    const layout = await buildFlowLayout({
      plan,
      selectedNodeId: null,
      graphCopy: DEFAULT_GRAPH_COPY,
      onSelect: vi.fn(),
    });
    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(layout.layoutDirection).toBe("TB");
    expect(nodeById.get("branch-a")?.data.layoutRole).toBe("branch");
    expect(nodeById.get("branch-b")?.data.layoutRole).toBe("branch");
    expect(nodeById.get("tail-1")?.data.layoutRole).toBe("chain");
    expect(layout.edges.find((edge) => edge.id === "edge-join-tail-1")?.data?.orientation).toBe("vertical");
    expect(layout.edges.some((edge) => edge.sourceHandle === "bottom-center-source" && edge.targetHandle === "top-center-target")).toBe(true);
  });

  it("automatically switches to full mode when enough width is available", async () => {
    render(
      <div style={{ width: "960px" }} data-testid="wide-graph-host">
        <TaskPlanGraph
          mode="auto"
            plan={testPlan({
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
                type: "task",
                displayType: "task",
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
                type: "task",
                displayType: "task",
                executionMode: "automatic",
                linkedTaskId: "child-3",
              },
            ],
            edges: [
              { id: "edge-1", fromNodeId: "node-current", toNodeId: "node-child", type: "sequential" },
            ],
            })}
        />
      </div>
    );

    const host = screen.getByTestId("wide-graph-host");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 960 });

    const graph = await screen.findByLabelText("Task plan graph");
    expect(graph).toHaveAttribute("data-graph-mode", "full");
    expect(graph.querySelector(".react-flow")).not.toBeNull();
  });

  it("renders a compact outline mode for sidebar usage with grouped nodes and no full graph chrome", async () => {
    render(
      <TaskPlanGraph
        mode="compact"
        plan={testPlan({
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
              type: "task",
              displayType: "task",
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
              type: "checkpoint",
              displayType: "checkpoint",
              executionMode: "manual",
              linkedTaskId: null,
              metadata: { checkpointType: "input", prompt: "确认范围" },
            },
            {
              id: "node-child",
              title: "物化可执行子任务",
              objective: "映射真实 child task",
              phase: "follow-up",
              status: "pending",
              requiresHumanInput: false,
              type: "task",
              displayType: "task",
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
              type: "task",
              displayType: "task",
              executionMode: "hybrid",
              linkedTaskId: null,
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-current", toNodeId: "node-child", type: "sequential" },
            { id: "edge-2", fromNodeId: "node-child", toNodeId: "node-deliverable", type: "sequential" },
          ],
        })}
      />
    );

    const graph = screen.getByLabelText("Task plan graph");
    expect(graph).toHaveAttribute("data-graph-mode", "compact");
    expect(graph.querySelector(".react-flow")).toBeNull();
    expect(screen.queryByTestId("task-plan-graph-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-plan-graph-scroll")).not.toBeInTheDocument();

    expect(screen.getByText("Current progress")).toBeInTheDocument();
    expect(screen.getByText("Action / blocked")).toBeInTheDocument();
    expect(screen.getByText("Next summary")).toBeInTheDocument();

    const currentOutlineNode = screen.getByTestId("task-plan-outline-node-node-current");
    expect(currentOutlineNode.getAttribute("data-node-current")).toBe("true");
    expect(currentOutlineNode).toHaveTextContent("Current node");

    const waitingOutlineNode = screen.getByTestId("task-plan-outline-node-node-waiting");
    expect(waitingOutlineNode.getAttribute("data-node-tone")).toBe("waiting");
    expect(waitingOutlineNode).toHaveTextContent("Needs action");

    const childOutlineNode = screen.getByTestId("task-plan-outline-node-node-child");
    expect(childOutlineNode).toHaveTextContent("Linked task");
    expect(childOutlineNode).toHaveTextContent("1 upstream");
    expect(childOutlineNode).toHaveTextContent("1 downstream");

    const deliverableOutlineNode = screen.getByTestId("task-plan-outline-node-node-deliverable");
    expect(deliverableOutlineNode).toHaveTextContent("1 upstream");

    const compactRail = screen.getByTestId("task-plan-compact-groups");
    expect(compactRail.className).toContain("border-l");

    const openFullButton = screen.getByRole("button", { name: "Open full graph" });
    fireEvent.click(openFullButton);

    const dialog = screen.getByRole("dialog", { name: "Full execution graph" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const dialogGraph = await within(dialog).findByTestId("task-plan-graph-full-dialog");
    expect(dialogGraph).toBeInTheDocument();
    expect(dialogGraph).toHaveAttribute("data-renderer", "react-flow");
    expect(dialogGraph).toHaveAttribute("data-graph-mode", "full");
    expect(within(dialog).getByTestId("task-plan-graph-legend")).toBeInTheDocument();
  });
});
