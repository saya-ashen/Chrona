import { describe, expect, it } from "bun:test";
import {
  createGraphRuntime,
  createPlanGraphFromCompiledPlan,
  executeBuiltinGraphNode,
  getDownstreamNodeIds,
  getUpstreamNodeIds,
  resolveEdgeSemantics,
  resolveEffectivePlanGraph,
  selectReadyNodeIds,
} from "./index";
import type { CompiledPlan } from "./index";
import {
  activeDefinitionLayerId,
  makeBranchingPlan,
  makeForkedBranchingPlan,
} from "./graph-runtime.test-fixtures";

describe("graph-runtime selection", () => {
  it("marks unselected branch subgraphs skipped and keeps them out of active entry nodes", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeForkedBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });

    const effective = resolveEffectivePlanGraph({
      graph,
      attempts: [
        {
          id: "attempt_choose_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: activeDefinitionLayerId(graph, "choose"),
          executionContextSnapshotId: "snapshot_choose_1",
          status: "succeeded",
          attemptNumber: 1,
          idempotencyKey: "choose:1",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      results: [
        {
          id: "result_choose_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: activeDefinitionLayerId(graph, "choose"),
          attemptId: "attempt_choose_1",
          status: "current",
          selectedBranch: { label: "skip config", nextNodeId: "build", source: "system" },
        },
      ],
    });

    const configure = effective.nodes.find((node) => node.id === "configure");
    const build = effective.nodes.find((node) => node.id === "build");

    expect(configure?.reachable).toBe(false);
    expect(configure?.status).toBe("skipped");
    expect(build?.reachable).toBe(true);
    expect(build?.ready).toBe(true);
    expect(effective.entryNodeIds).toEqual(["choose"]);
    expect(effective.readyNodeIds).toEqual(["build"]);
    expect(effective.pendingNodeIds).not.toContain("configure");
    expect(effective.completedNodeIds).toContain("configure");
  });

  it("activates only the selected task exit for either XOR branch", () => {
    const compiledPlan: CompiledPlan = {
      id: "compiled_preview_exits",
      editablePlanId: "preview_exits",
      sourceVersion: 1,
      nodes: [
        {
          id: "preview_available",
          localId: "preview_available",
          type: "condition" as const,
          title: "Preview available",
          config: {
            condition: "Preview generated",
            evaluationBy: "ai" as const,
            branches: [
              { label: "blocked", nextNodeId: "report_blocked_preview" },
              { label: "ready", nextNodeId: "publish_preview_report" },
            ],
          },
          dependencies: [],
          dependents: ["report_blocked_preview", "publish_preview_report"],
        },
        {
          id: "report_blocked_preview",
          localId: "report_blocked_preview",
          type: "task" as const,
          title: "Report blocked preview",
          config: {},
          dependencies: ["preview_available"],
          dependents: [],
        },
        {
          id: "publish_preview_report",
          localId: "publish_preview_report",
          type: "task" as const,
          title: "Publish preview report",
          config: {},
          dependencies: ["preview_available"],
          dependents: [],
        },
      ],
      edges: [
        { id: "preview_blocked", from: "preview_available", to: "report_blocked_preview", label: "blocked" },
        { id: "preview_ready", from: "preview_available", to: "publish_preview_report", label: "ready" },
      ],
      entryNodeIds: ["preview_available"],
    };

    for (const [label, selected, skipped] of [
      ["blocked", "report_blocked_preview", "publish_preview_report"],
      ["ready", "publish_preview_report", "report_blocked_preview"],
    ] as const) {
      const graph = createPlanGraphFromCompiledPlan({ taskId: `task_${label}`, compiledPlan });
      const effective = resolveEffectivePlanGraph({
        graph,
        results: [{
          nodeId: "preview_available",
          nodeLayerId: activeDefinitionLayerId(graph, "preview_available"),
          status: "current",
          selectedBranch: { label, nextNodeId: selected, source: "system" },
        }],
      });

      expect(effective.readyNodeIds).toEqual([selected]);
      expect(effective.terminalNodeIds).toEqual([selected]);
      expect(effective.nodes.find((node) => node.id === skipped)?.status).toBe("skipped");
    }
  });

  it("does not expose all branch targets when a completed condition result lacks selectedBranch", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeForkedBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });

    const effective = resolveEffectivePlanGraph({
      graph,
      attempts: [
        {
          id: "attempt_choose_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: activeDefinitionLayerId(graph, "choose"),
          executionContextSnapshotId: "snapshot_choose_1",
          status: "succeeded",
          attemptNumber: 1,
          idempotencyKey: "choose:1",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      results: [
        {
          id: "result_choose_1",
          taskId: "task_1",
          graphId: graph.id,
          nodeId: "choose",
          nodeLayerId: activeDefinitionLayerId(graph, "choose"),
          attemptId: "attempt_choose_1",
          status: "current",
          outputSummary: "已选择 skip config 分支。",
        },
      ],
    });

    expect(effective.readyNodeIds).toEqual([]);
    expect(effective.nodes.find((node) => node.id === "configure")?.ready).toBe(false);
    expect(effective.nodes.find((node) => node.id === "build")?.ready).toBe(false);
  });

  it("resolves edge semantics and traverses dependencies", () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(resolveEdgeSemantics(graph.edges[0]!).selectsBranch).toBe(true);
    expect(getDownstreamNodeIds(graph, ["choose"])).toEqual(["done"]);
    expect(getUpstreamNodeIds(graph, ["done"])).toEqual(["choose"]);
    expect(getDownstreamNodeIds(graph, ["choose"], { maxDepth: 0 })).toEqual([]);
  });

  it("selects ready nodes with runtime selection options", async () => {
    const graph = createPlanGraphFromCompiledPlan({
      taskId: "task_1",
      compiledPlan: makeBranchingPlan(),
      now: "2026-01-01T00:00:00.000Z",
    });
    const runtime = createGraphRuntime({
      taskId: "task_1",
      runtimeName: "test",
      executors: {
        condition: async ({ node, plan, userInput }) =>
          executeBuiltinGraphNode({ node, plan, userInput }),
      },
    });
    const outcome = await runtime.dispatch({
      type: "start",
      state: { graph, attempts: [], results: [], executionContextSnapshots: [] },
      trigger: "manual",
      context: null,
    });

    expect(selectReadyNodeIds(outcome.effective, { maxNodes: 1 }).selectedNodeIds).toEqual([]);
    expect(selectReadyNodeIds(outcome.effective, { includeWaitingNodes: true }).selectedNodeIds).toEqual([]);
  });
});
