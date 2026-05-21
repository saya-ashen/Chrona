import { describe, expect, it } from "bun:test";
import { createPlanGraphFromCompiledPlan, validatePlanGraph } from "./index";
import { makeBranchingPlan, makeConditionConfig } from "./graph-runtime.test-fixtures";

describe("graph-runtime validation", () => {
  it("validates graph invariants with structured issues", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const invalid = {
      ...graph,
      nodes: [{ ...graph.nodes[0]!, layers: [] }, graph.nodes[0]!, graph.nodes[1]!],
      edges: [
        ...graph.edges,
        {
          id: "bad_edge",
          fromNodeId: "missing",
          toNodeId: "done",
          type: "hard_dependency" as const,
          active: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const result = validatePlanGraph(invalid);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("MISSING_DEFINITION_LAYER");
    expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_NODE_ID");
    expect(result.issues.map((issue) => issue.code)).toContain("MISSING_EDGE_SOURCE");
  });

  it("validates condition branch targets", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const choose = graph.nodes[0]!;
    const layer = choose.layers[0];
    if (!layer || layer.type !== "definition") {
      throw new Error("Expected definition layer");
    }
    const invalid = {
      ...graph,
      nodes: [
        {
          ...choose,
          layers: [
            {
              ...layer,
              definition: {
                ...layer.definition,
                metadata: {
                  ...layer.definition.metadata,
                  branches: [{ label: "missing", nextNodeId: "missing" }],
                  defaultNextNodeId: "also_missing",
                },
              },
            },
          ],
        },
        graph.nodes[1]!,
      ],
    };

    const result = validatePlanGraph(invalid);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_BRANCH_TARGET");
    expect(result.issues.map((issue) => issue.code)).toContain("INVALID_DEFAULT_BRANCH_TARGET");
  });

  it("validates unreachable cyclic components", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: {
        id: "compiled_invalid_structure",
        editablePlanId: "graph_invalid_structure",
        sourceVersion: 1,
        nodes: [
          ...makeBranchingPlan().nodes,
          {
            id: "loop_a",
            localId: "loop_a",
            type: "condition",
            title: "Loop A",
            description: "Loop A",
            config: makeConditionConfig({
              condition: "Loop A",
              evaluationBy: "user",
              branches: [{ label: "next", nextNodeId: "loop_b" }],
            }),
            dependencies: ["loop_b"],
            dependents: ["loop_b"],
          },
          {
            id: "loop_b",
            localId: "loop_b",
            type: "condition",
            title: "Loop B",
            description: "Loop B",
            config: makeConditionConfig({
              condition: "Loop B",
              evaluationBy: "user",
              branches: [{ label: "next", nextNodeId: "loop_a" }],
            }),
            dependencies: ["loop_a"],
            dependents: ["loop_a"],
          },
        ],
        edges: [
          ...makeBranchingPlan().edges,
          { id: "edge_loop_a", from: "loop_a", to: "loop_b", label: "next" },
          { id: "edge_loop_b", from: "loop_b", to: "loop_a", label: "next" },
        ],
        entryNodeIds: ["choose"],
      },
      now: "2026-01-01T00:00:00.000Z",
    });

    const result = validatePlanGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("UNREACHABLE_NODE");
    expect(result.issues.map((issue) => issue.code)).toContain("CYCLE_DETECTED");
  });
});
