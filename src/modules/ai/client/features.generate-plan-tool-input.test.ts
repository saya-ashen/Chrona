import { describe, expect, it } from "vitest";
import { normalizeGeneratePlanResponse } from "@/modules/ai/client/features";

describe("normalizeGeneratePlanResponse", () => {
  it("parses graph payload from business tool input shape", () => {
    const result = normalizeGeneratePlanResponse({
      parsed: {
        taskId: "task-1",
        title: "制作答辩PPT",
        summary: "四步完成答辩PPT",
        reasoning: "先梳理内容，再出结构，再补图，最后审阅。",
        nodes: [
          {
            id: "node-1",
            type: "step",
            title: "梳理内容",
            objective: "整理答辩核心论点",
            estimatedMinutes: 15,
            priority: "High",
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
          },
          {
            id: "node-2",
            type: "deliverable",
            title: "制作页面结构",
            objective: "输出逐页结构",
            estimatedMinutes: 30,
            priority: "High",
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
          },
        ],
        edges: [
          {
            id: "edge-1",
            fromNodeId: "node-1",
            toNodeId: "node-2",
            type: "sequential",
          },
        ],
      },
      source: "openclaw",
    });

    expect(result.summary).toBe("四步完成答辩PPT");
    expect(result.reasoning).toContain("先梳理内容");
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes[0]?.title).toBe("梳理内容");
    expect(result.edges[0]?.fromNodeId).toBe("node-1");
  });
});
