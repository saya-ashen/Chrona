import { describe, expect, it } from "bun:test";

import { normalizeGeneratePlanResponse } from "./index";

describe("normalizeGeneratePlanResponse", () => {
  it("normalizes canonical AI plan payloads", () => {
    const result = normalizeGeneratePlanResponse({
      parsed: {
        title: "API test rollout",
        goal: "Roll out the API regression tests safely",
        nodes: [
          {
            id: "node_1",
            type: "task",
            title: "Draft failing regression test",
            expectedOutput: "A failing regression test that reproduces the bug",
            executor: "ai",
            mode: "auto",
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
            from: "node_1",
            to: "node_2",
          },
        ],
      },
      source: "openclaw",
    });

    expect(result.blueprint.title).toBe("API test rollout");
    expect(result.blueprint.nodes).toHaveLength(2);
    expect(result.blueprint.nodes[0]).toMatchObject({
      id: "node_1",
      title: "Draft failing regression test",
    });
    expect(result.blueprint.nodes[1]).toMatchObject({
      id: "node_2",
      title: "Review the failing output",
    });
    expect(result.blueprint.edges).toHaveLength(1);
    expect(result.blueprint.edges[0]).toMatchObject({
      from: "node_1",
      to: "node_2",
    });
  });

  it("rejects legacy bridge payloads that no longer match the canonical contract", () => {
    const result = normalizeGeneratePlanResponse({
      parsed: {
        title: "Legacy shape",
        goal: "Legacy shape",
        nodes: [
          {
            id: "node_1",
            type: "step",
            title: "Old style node",
            objective: "Legacy field",
            executor: "automation",
          },
        ],
        edges: [{ fromNodeId: "node_1", toNodeId: "node_2" }],
      },
      source: "openclaw",
    });

    expect(result.blueprint.title).toBe("");
    expect(result.blueprint.nodes).toEqual([]);
    expect(result.blueprint.edges).toEqual([]);
  });

  it("rejects runtime and legacy fields from blueprint nodes", () => {
    const result = normalizeGeneratePlanResponse({
      parsed: {
        title: "买咖啡计划",
        goal: "高效购得咖啡",
        nodes: [
          {
            id: "node_1",
            type: "checkpoint",
            title: "确认咖啡偏好",
            checkpointType: "input",
            prompt: "你想喝什么咖啡？",
            status: "pending",
          },
          {
            id: "node_2",
            type: "task",
            title: "查询附近门店库存",
            executor: "ai",
            mode: "auto",
            expectedOutput: "可购买门店列表",
          },
        ],
        edges: [{ from: "node_1", to: "node_2" }],
      },
      source: "openclaw",
    });

    expect(result.blueprint.title).toBe("");
    expect(result.blueprint.nodes).toEqual([]);
  });
});
