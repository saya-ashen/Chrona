import { describe, expect, it } from "bun:test";

import { normalizeGeneratePlanResponse } from "./index";

describe("normalizeGeneratePlanResponse", () => {
  it("accepts bridge-style plan payloads without title and goal", () => {
    const result = normalizeGeneratePlanResponse({
      parsed: {
        summary: "Plan the API test rollout",
        nodes: [
          {
            id: "node_1",
            type: "task",
            title: "Draft failing regression test",
            objective: "Reproduce the missing plan generation bug",
            executor: "automation",
            estimatedMinutes: 15,
          },
          {
            id: "node_2",
            type: "checkpoint",
            title: "Review the failing output",
            checkpointType: "approve",
            prompt: "Confirm the failure matches the production bug",
          },
        ],
        edges: [
          {
            fromNodeId: "node_1",
            toNodeId: "node_2",
            type: "sequential",
          },
        ],
      },
      source: "openclaw",
    });

    expect(result.summary).toBe("Plan the API test rollout");
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({
      id: "node_1",
      title: "Draft failing regression test",
      executionMode: "automatic",
      autoRunnable: true,
    });
    expect(result.nodes[1]).toMatchObject({
      id: "node_2",
      title: "Review the failing output",
      executionMode: "manual",
      requiresHumanApproval: true,
      autoRunnable: false,
    });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      fromNodeId: "node_1",
      toNodeId: "node_2",
      type: "sequential",
    });
  });

  it("derives execution semantics from node types and fields", () => {
    const result = normalizeGeneratePlanResponse({
      parsed: {
        title: "买咖啡计划",
        goal: "高效购得咖啡",
        summary: "买咖啡计划",
        nodes: [
          {
            id: "node_1",
            type: "checkpoint",
            title: "确认咖啡偏好",
            checkpointType: "input",
            prompt: "你想喝什么咖啡？",
          },
          {
            id: "node_2",
            type: "task",
            title: "查询附近门店库存",
            description: "确认可购买门店",
            executor: "ai",
            mode: "auto",
            expectedOutput: "可购买门店列表",
          },
          {
            id: "node_3",
            type: "task",
            title: "前往门店取货",
            description: "到店拿到饮品",
            executor: "user",
            mode: "manual",
            expectedOutput: "拿到饮品",
          },
          {
            id: "node_4",
            type: "checkpoint",
            title: "审批最终购买方案",
            checkpointType: "approve",
            prompt: "是否确认执行支付？",
          },
        ],
        edges: [
          { from: "node_1", to: "node_2" },
          { from: "node_2", to: "node_3" },
          { from: "node_3", to: "node_4" },
        ],
      },
      source: "openclaw",
    });

    // node_1: checkpoint "input" → manual, needs_user_input
    expect(result.nodes[0]).toMatchObject({
      executionMode: "manual",
      requiresHumanInput: true,
      requiresHumanApproval: false,
      autoRunnable: false,
      blockingReason: "needs_user_input",
    });

    // node_2: task executor "ai", mode "auto" → automatic
    expect(result.nodes[1]).toMatchObject({
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
    });

    // node_3: task executor "user", mode "manual" → manual
    expect(result.nodes[2]).toMatchObject({
      executionMode: "manual",
      requiresHumanInput: true,
      requiresHumanApproval: false,
      autoRunnable: false,
      blockingReason: "needs_user_input",
    });

    // node_4: checkpoint "approve" → manual, needs_approval
    expect(result.nodes[3]).toMatchObject({
      executionMode: "manual",
      requiresHumanApproval: true,
      autoRunnable: false,
      blockingReason: "needs_approval",
    });

    // All main edges become "sequential" via buildTaskPlanEdgesFromAIPlanEdges
    expect(result.edges.map((edge) => edge.type)).toEqual([
      "sequential",
      "sequential",
      "sequential",
    ]);
  });
});
