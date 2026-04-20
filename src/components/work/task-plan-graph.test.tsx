import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";

afterEach(() => {
  cleanup();
});

describe("TaskPlanGraph", () => {
  it("renders node cards without duplicated type headers when phase already matches type", () => {
    render(
      <TaskPlanGraph
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
              needsUserInput: true,
              type: "user_input",
              executionMode: "none",
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
              needsUserInput: false,
              type: "step",
              executionMode: "child_task",
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

    expect(screen.getByLabelText("Task plan graph")).toBeInTheDocument();

    const currentNode = screen.getByTestId("task-plan-node-node-current");
    expect(currentNode.getAttribute("data-node-current")).toBe("true");
    expect(currentNode.getAttribute("data-node-selected")).toBe("false");

    const childNode = screen.getByTestId("task-plan-node-node-child");
    expect(childNode.getAttribute("data-node-tone")).toBe("child-task");

    expect(screen.getAllByText("user_input").length).toBe(1);
    expect(screen.queryByText("详细说明")).not.toBeInTheDocument();
  });

  it("expands details inside the node card after clicking another node", () => {
    render(
      <TaskPlanGraph
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
              needsUserInput: false,
              type: "step",
              executionMode: "none",
              linkedTaskId: null,
            },
            {
              id: "node-deliverable",
              title: "产出说明文档",
              objective: "整理最终交付物，包含较长内容以验证展开后才显示完整详情。",
              phase: "delivery",
              status: "pending",
              needsUserInput: false,
              type: "deliverable",
              executionMode: "child_task",
              linkedTaskId: "child-9",
              estimatedMinutes: 60,
              priority: "Urgent",
            },
          ],
          edges: [
            { id: "edge-1", fromNodeId: "node-current", toNodeId: "node-deliverable", type: "feeds_output" },
          ],
        }}
      />,
    );

    const deliverableNode = screen.getByTestId("task-plan-node-node-deliverable");
    fireEvent.click(deliverableNode);

    expect(deliverableNode.getAttribute("data-node-selected")).toBe("true");
    expect(deliverableNode).toHaveTextContent("产出说明文档");
    expect(deliverableNode).toHaveTextContent("deliverable");
    expect(deliverableNode).toHaveTextContent("child_task");
    expect(deliverableNode).toHaveTextContent("Urgent");
    expect(deliverableNode).toHaveTextContent("60 min");
    expect(deliverableNode).toHaveTextContent("child-9");
    expect(deliverableNode).toHaveTextContent("Description");
  });
});
