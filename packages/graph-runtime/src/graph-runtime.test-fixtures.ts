import { createPlanGraphFromCompiledPlan } from "./index";
import type { CompiledPlan, ConditionConfig } from "./index";

export function makeConditionConfig(input: {
  condition: string;
  evaluationBy: "user" | "ai";
  branches: Array<{ label: string; nextNodeId: string }>;
  defaultNextNodeId?: string;
}): ConditionConfig {
  return {
    condition: input.condition,
    evaluationBy: input.evaluationBy,
    branches: input.branches,
    defaultNextNodeId: input.defaultNextNodeId,
  };
}

export function makeBranchingPlan(): CompiledPlan {
  return {
    id: "compiled_branching",
    editablePlanId: "graph_branching",
    sourceVersion: 1,
    nodes: [
      {
        id: "choose",
        localId: "choose",
        type: "condition",
        title: "Choose path",
        description: "User chooses branch",
        config: makeConditionConfig({
          condition: "Pick route",
          evaluationBy: "user",
          branches: [{ label: "yes", nextNodeId: "done" }],
        }),
        dependencies: [],
        dependents: ["done"],
      },
      {
        id: "done",
        localId: "done",
        type: "condition",
        title: "Finish",
        description: "Terminal node",
        config: makeConditionConfig({
          condition: "Finish",
          evaluationBy: "user",
          branches: [{ label: "complete", nextNodeId: "done" }],
          defaultNextNodeId: "done",
        }),
        dependencies: ["choose"],
        dependents: [],
      },
    ],
    edges: [{ id: "edge_yes", from: "choose", to: "done", label: "yes" }],
    entryNodeIds: ["choose"],
  };
}

export function makeForkedBranchingPlan(): CompiledPlan {
  return {
    id: "compiled_forked_branching",
    editablePlanId: "graph_forked_branching",
    sourceVersion: 1,
    nodes: [
      {
        id: "choose",
        localId: "choose",
        type: "condition",
        title: "Choose path",
        description: "User chooses branch",
        config: makeConditionConfig({
          condition: "Pick route",
          evaluationBy: "user",
          branches: [
            { label: "needs config", nextNodeId: "configure" },
            { label: "skip config", nextNodeId: "build" },
          ],
        }),
        dependencies: [],
        dependents: ["configure", "build"],
      },
      {
        id: "configure",
        localId: "configure",
        type: "task",
        title: "Configure",
        description: "Skipped branch node",
        config: { expectedOutput: "Configuration gathered" },
        dependencies: ["choose"],
        dependents: ["build"],
      },
      {
        id: "build",
        localId: "build",
        type: "task",
        title: "Build",
        description: "Selected branch node",
        config: { expectedOutput: "Build complete" },
        dependencies: ["choose", "configure"],
        dependents: [],
      },
    ],
    edges: [
      { id: "edge_choose_configure", from: "choose", to: "configure", label: "needs config" },
      { id: "edge_choose_build", from: "choose", to: "build", label: "skip config" },
      { id: "edge_configure_build", from: "configure", to: "build", label: "after config" },
    ],
    entryNodeIds: ["choose"],
  };
}

export function activeDefinitionLayerId(
  graph: ReturnType<typeof createPlanGraphFromCompiledPlan>,
  nodeId: string,
) {
  const layer = graph.nodes
    .find((node) => node.id === nodeId)
    ?.layers.find((candidate) => candidate.type === "definition");
  if (!layer) throw new Error(`Missing definition layer for ${nodeId}`);
  return layer.id;
}

export function makeParallelPlan(): CompiledPlan {
  return {
    id: "compiled_parallel",
    editablePlanId: "graph_parallel",
    sourceVersion: 1,
    nodes: [
      {
        id: "left",
        localId: "left",
        type: "task",
        title: "Left",
        description: "Left task",
        config: { expectedOutput: "Left done" },
        dependencies: [],
        dependents: [],
      },
      {
        id: "right",
        localId: "right",
        type: "task",
        title: "Right",
        description: "Right task",
        config: { expectedOutput: "Right done" },
        dependencies: [],
        dependents: [],
      },
    ],
    edges: [],
    entryNodeIds: ["left", "right"],
  };
}

export function makeLinearPlan(): CompiledPlan {
  return {
    id: "compiled_linear",
    editablePlanId: "graph_linear",
    sourceVersion: 1,
    nodes: [
      {
        id: "first",
        localId: "first",
        type: "task",
        title: "First",
        description: "Required upstream task",
        config: { expectedOutput: "First done" },
        dependencies: [],
        dependents: ["second"],
      },
      {
        id: "second",
        localId: "second",
        type: "task",
        title: "Second",
        description: "Downstream task",
        config: { expectedOutput: "Second done" },
        dependencies: ["first"],
        dependents: [],
      },
    ],
    edges: [{ id: "edge_first_second", from: "first", to: "second" }],
    entryNodeIds: ["first"],
  };
}
