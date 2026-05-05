import { describe, expect, it } from "bun:test";

import type {
  CompiledPlan,
  StructuralLayer,
  RuntimeLayer,
  ResultLayer,
  StructuralOperation,
} from "@chrona/contracts/ai";

import { compileEditablePlan } from "./compile";
import { resolveEffectivePlanGraph } from "./effective-graph";

// ─── Helpers (reuse from plan.bun.test.ts pattern) ───

import type {
  EditablePlan,
  EditableTaskNode,
  EditableCheckpointNode,
} from "@chrona/contracts/ai";

function makeTask(
  id: string,
  overrides?: Partial<EditableTaskNode>,
): EditableTaskNode {
  return {
    id,
    type: "task",
    title: `Task ${id}`,
    executor: "ai",
    mode: "auto",
    ...overrides,
  };
}

function makeCheckpoint(
  id: string,
  overrides?: Partial<EditableCheckpointNode>,
): EditableCheckpointNode {
  return {
    id,
    type: "checkpoint",
    title: `Checkpoint ${id}`,
    checkpointType: "confirm",
    prompt: "Are you sure?",
    required: true,
    ...overrides,
  };
}

function makePlan(
  id: string,
  nodes: EditablePlan["nodes"],
  edges: EditablePlan["edges"],
  overrides?: Partial<EditablePlan>,
): EditablePlan {
  return {
    id,
    version: 1,
    title: "Test plan",
    goal: "Test goal",
    nodes,
    edges,
    ...overrides,
  };
}

function makeCompiled(
  nodes: EditablePlan["nodes"],
  edges: EditablePlan["edges"],
): CompiledPlan {
  return compileEditablePlan(makePlan("test_plan", nodes, edges));
}

function makeStructuralLayer(
  version: number,
  operations: StructuralOperation[],
  active = true,
): StructuralLayer {
  return {
    layerId: `sl_${version}`,
    planId: "test_plan",
    type: "structural",
    version,
    source: "user",
    active,
    timestamp: new Date().toISOString(),
    operations,
  };
}

function makeRuntimeLayer(
  version: number,
  nodeStates: RuntimeLayer["nodeStates"],
  active = true,
): RuntimeLayer {
  return {
    layerId: `rl_${version}`,
    planId: "test_plan",
    type: "runtime",
    version,
    active,
    timestamp: new Date().toISOString(),
    nodeStates,
  };
}

function makeResultLayer(
  version: number,
  nodeResults: ResultLayer["nodeResults"],
  active = true,
): ResultLayer {
  return {
    layerId: `resl_${version}`,
    planId: "test_plan",
    type: "result",
    version,
    active,
    timestamp: new Date().toISOString(),
    nodeResults,
  };
}

// ═══════════════════════════════════════════════════════════════
// resolveEffectivePlanGraph tests
// ═══════════════════════════════════════════════════════════════

describe("resolveEffectivePlanGraph — base only", () => {
  it("1. returns all base nodes with default pending status", () => {
    const base = makeCompiled(
      [makeTask("a"), makeTask("b")],
      [{ from: "a", to: "b" }],
    );
    const graph = resolveEffectivePlanGraph(base, []);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.entryNodeIds).toHaveLength(1);
    expect(graph.terminalNodeIds).toHaveLength(1);
    expect(graph.readyNodeIds).toHaveLength(1); // entry node

    const nodeA = graph.nodes.find((n) => n.localId === "a")!;
    const nodeB = graph.nodes.find((n) => n.localId === "b")!;
    expect(nodeA.status).toBe("pending");
    expect(nodeA.ready).toBe(true);  // entry, no deps
    expect(nodeA.dependenciesSatisfied).toBe(true);
    expect(nodeB.status).toBe("pending");
    expect(nodeB.ready).toBe(false); // waiting for a
    expect(nodeB.dependenciesSatisfied).toBe(false);
  });

  it("2. baseVersion matches sourceVersion when no layers", () => {
    const base = makeCompiled([makeTask("a")], []);
    const graph = resolveEffectivePlanGraph(base, []);
    expect(graph.resolvedVersion).toBe(base.sourceVersion);
  });
});

describe("resolveEffectivePlanGraph — structural layers", () => {
  it("3. add_node appends a new node", () => {
    const base = makeCompiled([makeTask("a")], []);
    const layer = makeStructuralLayer(2, [
      {
        op: "add_node",
        nodeId: "cn_new_node",
        localId: "new_node",
        type: "task",
        title: "New Task",
        config: {},
        executor: "ai",
        mode: "auto",
      },
      { op: "add_edge", from: "cn_new_node", to: base.nodes[0].id },
    ]);

    const graph = resolveEffectivePlanGraph(base, [layer]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.some((n) => n.localId === "new_node")).toBe(true);
    expect(graph.resolvedVersion).toBe(2);
  });

  it("4. update_node patches existing node properties", () => {
    const base = makeCompiled([makeTask("a")], []);
    const nodeId = base.nodes[0].id;
    const layer = makeStructuralLayer(2, [
      {
        op: "update_node",
        nodeId,
        patch: { title: "Updated Title", estimatedMinutes: 45 },
      },
    ]);

    const graph = resolveEffectivePlanGraph(base, [layer]);
    const node = graph.nodes[0];
    expect(node.title).toBe("Updated Title");
    expect(node.estimatedMinutes).toBe(45);
  });

  it("5. delete_node removes node + connected edges", () => {
    const base = makeCompiled(
      [makeTask("a"), makeTask("b")],
      [{ from: "a", to: "b" }],
    );
    const nodeAId = base.nodes.find((n) => n.localId === "a")!.id;
    const layer = makeStructuralLayer(2, [{ op: "delete_node", nodeId: nodeAId }]);

    const graph = resolveEffectivePlanGraph(base, [layer]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.readyNodeIds).toHaveLength(1); // b is now entry
  });

  it("6. add_edge creates a new dependency", () => {
    const base = makeCompiled([makeTask("a"), makeTask("b")], []);
    const aId = base.nodes.find((n) => n.localId === "a")!.id;
    const bId = base.nodes.find((n) => n.localId === "b")!.id;
    const layer = makeStructuralLayer(2, [{ op: "add_edge", from: aId, to: bId }]);

    const graph = resolveEffectivePlanGraph(base, [layer]);
    expect(graph.edges).toHaveLength(1);

    const nodeB = graph.nodes.find((n) => n.localId === "b")!;
    expect(nodeB.dependencies).toHaveLength(1);
    expect(nodeB.dependencies[0]).toBe(aId);
    expect(nodeB.ready).toBe(false); // now depends on a
  });

  it("7. delete_edge removes dependency", () => {
    const base = makeCompiled(
      [makeTask("a"), makeTask("b")],
      [{ from: "a", to: "b" }],
    );
    const aId = base.nodes.find((n) => n.localId === "a")!.id;
    const bId = base.nodes.find((n) => n.localId === "b")!.id;
    const layer = makeStructuralLayer(2, [{ op: "delete_edge", from: aId, to: bId }]);

    const graph = resolveEffectivePlanGraph(base, [layer]);
    expect(graph.edges).toHaveLength(0);

    const nodeB = graph.nodes.find((n) => n.localId === "b")!;
    expect(nodeB.dependencies).toHaveLength(0);
    expect(nodeB.ready).toBe(true);
    expect(graph.readyNodeIds).toHaveLength(2);
  });

  it("8. multiple structural layers stack in order", () => {
    const base = makeCompiled([makeTask("a")], []);
    const nodeAId = base.nodes[0].id;

    const layer1 = makeStructuralLayer(2, [
      { op: "add_node", nodeId: "cn_b", localId: "b", type: "task", title: "B", config: {}, executor: "ai", mode: "auto" },
    ]);
    const layer2 = makeStructuralLayer(3, [
      { op: "add_edge", from: nodeAId, to: "cn_b" },
    ]);

    const graph = resolveEffectivePlanGraph(base, [layer1, layer2]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);

    const nodeB = graph.nodes.find((n) => n.localId === "b")!;
    expect(nodeB.dependencies).toEqual([nodeAId]);
  });

  it("9. inactive structural layer is ignored", () => {
    const base = makeCompiled([makeTask("a")], []);
    const layer = makeStructuralLayer(2, [
      { op: "add_node", nodeId: "cn_b", localId: "b", type: "task", title: "B", config: {}, executor: "ai", mode: "auto" },
    ], false);

    const graph = resolveEffectivePlanGraph(base, [layer]);
    expect(graph.nodes).toHaveLength(1);
  });
});

describe("resolveEffectivePlanGraph — runtime layers", () => {
  it("10. runtime layer sets node status", () => {
    const base = makeCompiled(
      [makeTask("a"), makeTask("b")],
      [{ from: "a", to: "b" }],
    );
    const aId = base.nodes.find((n) => n.localId === "a")!.id;

    const runtimeLayer = makeRuntimeLayer(2, {
      [aId]: { status: "completed", attempts: 1, completedAt: "2026-01-01T00:00:00Z" },
    });

    const graph = resolveEffectivePlanGraph(base, [runtimeLayer]);

    const nodeA = graph.nodes.find((n) => n.localId === "a")!;
    expect(nodeA.status).toBe("completed");
    expect(nodeA.attempts).toBe(1);

    const nodeB = graph.nodes.find((n) => n.localId === "b")!;
    expect(nodeB.ready).toBe(true); // deps satisfied now
    expect(graph.completedNodeIds).toContain(aId);
    expect(graph.readyNodeIds).toContain(nodeB.id);
  });

  it("11. later runtime layer overrides earlier one", () => {
    const base = makeCompiled([makeTask("a")], []);
    const aId = base.nodes[0].id;

    const layer1 = makeRuntimeLayer(2, { [aId]: { status: "running", attempts: 1 } });
    const layer2 = makeRuntimeLayer(3, { [aId]: { status: "completed", attempts: 1 } });

    const graph = resolveEffectivePlanGraph(base, [layer1, layer2]);
    const nodeA = graph.nodes[0];
    expect(nodeA.status).toBe("completed");
  });

  it("12. inactive runtime layer is ignored (falls back to previous)", () => {
    const base = makeCompiled([makeTask("a")], []);
    const aId = base.nodes[0].id;

    const layer1 = makeRuntimeLayer(2, { [aId]: { status: "running", attempts: 1 } });
    const layer2 = makeRuntimeLayer(3, { [aId]: { status: "failed", attempts: 2 } }, false);

    const graph = resolveEffectivePlanGraph(base, [layer1, layer2]);
    const nodeA = graph.nodes[0];
    expect(nodeA.status).toBe("running"); // layer1 wins, layer2 inactive
  });
});

describe("resolveEffectivePlanGraph — result layers", () => {
  it("13. result layer attaches output to nodes", () => {
    const base = makeCompiled([makeTask("a")], []);
    const aId = base.nodes[0].id;

    const runtime = makeRuntimeLayer(2, { [aId]: { status: "completed", attempts: 1 } });
    const result = makeResultLayer(3, {
      [aId]: { outputSummary: "All done", artifactRefs: [] },
    });

    const graph = resolveEffectivePlanGraph(base, [runtime, result]);
    const nodeA = graph.nodes[0];
    expect(nodeA.result?.outputSummary).toBe("All done");
  });

  it("14. later result layer overrides earlier one", () => {
    const base = makeCompiled([makeTask("a")], []);
    const aId = base.nodes[0].id;

    const result1 = makeResultLayer(2, { [aId]: { outputSummary: "First" } });
    const result2 = makeResultLayer(3, { [aId]: { outputSummary: "Final" } });

    const graph = resolveEffectivePlanGraph(base, [result1, result2]);
    const nodeA = graph.nodes[0];
    expect(nodeA.result?.outputSummary).toBe("Final");
  });

  it("15. result layers merge with runtime layers correctly", () => {
    const base = makeCompiled([makeTask("a")], []);
    const aId = base.nodes[0].id;

    const runtime = makeRuntimeLayer(2, { [aId]: { status: "completed", attempts: 1 } });
    const result = makeResultLayer(3, {
      [aId]: { outputSummary: "Done", error: undefined },
    });

    const graph = resolveEffectivePlanGraph(base, [runtime, result]);
    const nodeA = graph.nodes[0];
    expect(nodeA.status).toBe("completed");
    expect(nodeA.result?.outputSummary).toBe("Done");
    expect(nodeA.result?.error).toBeUndefined();
  });
});

describe("resolveEffectivePlanGraph — full integration", () => {
  it("16. complex execution: structural add → runtime → result → runtime", () => {
    const base = makeCompiled([makeTask("a")], []);
    const aId = base.nodes[0].id;

    // Add node b
    const structural = makeStructuralLayer(2, [
      {
        op: "add_node",
        nodeId: "cn_b",
        localId: "b",
        type: "task",
        title: "B",
        config: {},
        executor: "ai",
        mode: "auto",
      },
      { op: "add_edge", from: aId, to: "cn_b" },
    ]);

    // Execute a
    const runtime1 = makeRuntimeLayer(3, { [aId]: { status: "completed", attempts: 1 } });
    const result1 = makeResultLayer(4, { [aId]: { outputSummary: "A done" } });

    // Execute b
    const runtime2 = makeRuntimeLayer(5, { ["cn_b"]: { status: "running", attempts: 1 } });
    const result2 = makeResultLayer(6, { ["cn_b"]: { outputSummary: "B done" } });

    const graph = resolveEffectivePlanGraph(base, [
      structural,
      runtime1,
      result1,
      runtime2,
      result2,
    ]);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.resolvedVersion).toBe(6);

    const nodeA = graph.nodes.find((n) => n.localId === "a")!;
    expect(nodeA.status).toBe("completed");
    expect(nodeA.result?.outputSummary).toBe("A done");

    const nodeB = graph.nodes.find((n) => n.localId === "b")!;
    expect(nodeB.status).toBe("running");
    expect(nodeB.dependencies[0]).toBe(aId);
    expect(nodeB.result?.outputSummary).toBe("B done");
  });

  it("17. plan with 3 parallel entry nodes becomes ready", () => {
    const base = makeCompiled(
      [makeTask("a"), makeTask("b"), makeTask("c")],
      [], // no edges — all parallel
    );
    const graph = resolveEffectivePlanGraph(base, []);

    expect(graph.readyNodeIds).toHaveLength(3);
    expect(graph.entryNodeIds).toHaveLength(3);
    expect(graph.terminalNodeIds).toHaveLength(3);
    expect(graph.pendingNodeIds).toHaveLength(0); // all are "pending" but ready
  });

  it("18. blocked node appears in blockedNodeIds", () => {
    const base = makeCompiled([makeTask("a")], []);
    const aId = base.nodes[0].id;

    const runtime = makeRuntimeLayer(2, { [aId]: { status: "blocked", attempts: 1 } });

    const graph = resolveEffectivePlanGraph(base, [runtime]);
    const nodeA = graph.nodes[0];
    expect(nodeA.status).toBe("blocked");
    expect(graph.blockedNodeIds).toContain(aId);
    expect(graph.readyNodeIds).toHaveLength(0);
  });

  it("19. failed node appears in failedNodeIds", () => {
    const base = makeCompiled([makeTask("a")], []);
    const aId = base.nodes[0].id;

    const runtime = makeRuntimeLayer(2, { [aId]: { status: "failed", lastError: "Something broke" } });

    const graph = resolveEffectivePlanGraph(base, [runtime]);
    const nodeA = graph.nodes[0];
    expect(nodeA.status).toBe("failed");
    expect(nodeA.lastError).toBe("Something broke");
    expect(graph.failedNodeIds).toContain(aId);
  });

  it("20. topologicalOrder is carried from base plan", () => {
    const base = makeCompiled(
      [makeTask("a"), makeTask("b"), makeTask("c")],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    );
    expect(base.topologicalOrder).toHaveLength(3);

    // a comes before b, b before c
    const aId = base.nodes.find((n) => n.localId === "a")!.id;
    const bId = base.nodes.find((n) => n.localId === "b")!.id;
    const cId = base.nodes.find((n) => n.localId === "c")!.id;

    const aIdx = base.topologicalOrder.indexOf(aId);
    const bIdx = base.topologicalOrder.indexOf(bId);
    const cIdx = base.topologicalOrder.indexOf(cId);
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });
});
