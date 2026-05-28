import { describe, expect, test } from "bun:test";
import { buildCompiledEdge, buildCompiledNode, buildCompiledPlan, buildLinearCompiledPlan } from "./builders";

describe("compiled plan test builders", () => {
  test("buildCompiledNode fills deterministic defaults", () => {
    expect(buildCompiledNode({ id: "write-tests" })).toEqual({
      id: "write-tests",
      localId: "write-tests",
      type: "task",
      title: "write tests",
      description: undefined,
      priority: "Medium",
      linkedTaskId: undefined,
      config: {},
      dependencies: [],
      dependents: [],
      executor: "ai",
      mode: "auto",
      estimatedMinutes: 10,
    });
  });

  test("buildCompiledEdge derives stable identifiers", () => {
    expect(buildCompiledEdge("collect", "review")).toEqual({
      id: "collect-to-review",
      from: "collect",
      to: "review",
      label: undefined,
    });
  });

  test("buildCompiledPlan derives entry, terminal, and topological metadata", () => {
    const collect = buildCompiledNode({ id: "collect", dependents: ["ship"] });
    const ship = buildCompiledNode({ id: "ship", dependencies: ["collect"] });

    const plan = buildCompiledPlan({ nodes: [collect, ship], edges: [buildCompiledEdge("collect", "ship")] });

    expect(plan.entryNodeIds).toEqual(["collect"]);
    expect(plan.terminalNodeIds).toEqual(["ship"]);
    expect(plan.topologicalOrder).toEqual(["collect", "ship"]);
    expect(plan.completionPolicy).toEqual({ type: "all_tasks_completed" });
  });

  test("buildLinearCompiledPlan creates a connected deterministic chain", () => {
    const plan = buildLinearCompiledPlan(["a", "b", "c"]);

    expect(plan.id).toBe("linear-test-plan");
    expect(plan.nodes.map((node) => [node.id, node.dependencies, node.dependents])).toEqual([
      ["a", [], ["b"]],
      ["b", ["a"], ["c"]],
      ["c", ["b"], []],
    ]);
    expect(plan.edges.map((edge) => edge.id)).toEqual(["a-to-b", "b-to-c"]);
  });
});
