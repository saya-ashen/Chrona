import { describe, expect, it } from "bun:test";

import { normalizeGeneratePlanResponse } from "./index";

describe("normalizeGeneratePlanResponse", () => {
  it("derives execution semantics from explicit executor and human flags", () => {
    const result = normalizeGeneratePlanResponse({
      parsed: {
        summary: "买咖啡计划",
        nodes: [
          {
            id: "node-1",
            type: "user_input",
            title: "确认咖啡偏好",
            objective: "收集口味信息",
            executor: "human",
            requiresHumanInput: true,
            requiresHumanApproval: false,
          },
          {
            id: "node-2",
            type: "tool_action",
            title: "查询附近门店库存",
            objective: "确认可购买门店",
            executor: "automation",
            requiresHumanInput: false,
            requiresHumanApproval: false,
          },
          {
            id: "node-3",
            type: "step",
            title: "前往门店取货",
            objective: "到店拿到饮品",
            executor: "human",
            requiresHumanInput: false,
            requiresHumanApproval: false,
          },
          {
            id: "node-4",
            type: "decision",
            title: "审批最终购买方案",
            objective: "确认是否执行支付",
            executor: "human",
            requiresHumanInput: false,
            requiresHumanApproval: true,
          },
        ],
        edges: [
          { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-2", type: "depends_on" },
          { id: "edge-2", fromNodeId: "node-2", toNodeId: "node-3", type: "unblocks" },
          { id: "edge-3", fromNodeId: "node-3", toNodeId: "node-4", type: "invalid_edge" },
        ],
      },
      source: "openclaw",
    });

    expect(result.nodes[0]).toMatchObject({
      executionMode: "manual",
      requiresHumanInput: true,
      requiresHumanApproval: false,
      autoRunnable: false,
      blockingReason: "needs_user_input",
    });

    expect(result.nodes[1]).toMatchObject({
      executionMode: "automatic",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: true,
      blockingReason: null,
    });

    expect(result.nodes[2]).toMatchObject({
      executionMode: "manual",
      requiresHumanInput: false,
      requiresHumanApproval: false,
      autoRunnable: false,
      blockingReason: null,
    });

    expect(result.nodes[3]).toMatchObject({
      executionMode: "manual",
      requiresHumanApproval: true,
      autoRunnable: false,
      blockingReason: "needs_approval",
    });

    expect(result.edges.map((edge) => edge.type)).toEqual([
      "depends_on",
      "unblocks",
      "sequential",
    ]);
  });
});
