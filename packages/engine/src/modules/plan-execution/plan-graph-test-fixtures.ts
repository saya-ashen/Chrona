import type { CheckpointConfig, CompiledEdge, CompiledNode, CompiledPlan, ValidationWarning } from "@chrona/contracts/ai";

export type PlanGraphScenarioId =
  | "linear"
  | "branch"
  | "join"
  | "checkpoint"
  | "retry"
  | "blocked"
  | "failure"
  | "partial-branch-failure"
  | "missing-result"
  | "malformed-result"
  | "empty"
  | "cyclic"
  | "impossible";

export type PlanGraphScenario = {
  id: PlanGraphScenarioId;
  name: string;
  plan: CompiledPlan;
  expectedTransitions: Record<string, string[]>;
  expectedOutcome: "completed" | "blocked" | "failed" | "rejected";
  invalidReason?: string;
};

function taskNode(id: string, dependencies: string[] = [], dependents: string[] = []): CompiledNode {
  return {
    id,
    localId: id,
    type: "task",
    title: id.replaceAll("-", " "),
    description: `Execute ${id}`,
    config: {},
    dependencies,
    dependents,
  };
}

function checkpointNode(id: string, dependencies: string[] = [], dependents: string[] = []): CompiledNode {
  const config: CheckpointConfig = {
    checkpointType: "approve",
    prompt: `Review ${id}`,
    required: true,
  };

  return {
    ...taskNode(id, dependencies, dependents),
    type: "checkpoint",
    config,
  };
}

function edge(from: string, to: string): CompiledEdge {
  return { id: `${from}-to-${to}`, from, to };
}

export function createCompiledPlanFixture(input: {
  id: string;
  title?: string;
  nodes: CompiledNode[];
  edges?: CompiledEdge[];
  entryNodeIds?: string[];
  terminalNodeIds?: string[];
  topologicalOrder?: string[];
  warnings?: ValidationWarning[];
}): CompiledPlan {
  return {
    id: `compiled-${input.id}`,
    editablePlanId: input.id,
    sourceVersion: 1,
    title: input.title ?? input.id,
    goal: `Deterministic ${input.id} graph fixture`,
    assumptions: [],
    nodes: input.nodes,
    edges: input.edges ?? [],
    entryNodeIds: input.entryNodeIds ?? input.nodes.filter((node) => node.dependencies.length === 0).map((node) => node.id),
    terminalNodeIds: input.terminalNodeIds ?? input.nodes.filter((node) => node.dependents.length === 0).map((node) => node.id),
    topologicalOrder: input.topologicalOrder ?? input.nodes.map((node) => node.id),
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: input.warnings ?? [],
  };
}

export function createPlanGraphScenario(id: PlanGraphScenarioId): PlanGraphScenario {
  const scenarios: Record<PlanGraphScenarioId, PlanGraphScenario> = {
    linear: {
      id,
      name: "Linear three-step graph",
      plan: createCompiledPlanFixture({
        id,
        nodes: [taskNode("collect", [], ["implement"]), taskNode("implement", ["collect"], ["review"]), taskNode("review", ["implement"])],
        edges: [edge("collect", "implement"), edge("implement", "review")],
      }),
      expectedTransitions: { collect: ["ready", "running", "succeeded"], implement: ["pending", "ready", "running", "succeeded"], review: ["pending", "ready", "running", "succeeded"] },
      expectedOutcome: "completed",
    },
    branch: {
      id,
      name: "Independent branch graph",
      plan: createCompiledPlanFixture({
        id,
        nodes: [taskNode("root", [], ["left", "right"]), taskNode("left", ["root"]), taskNode("right", ["root"])],
        edges: [edge("root", "left"), edge("root", "right")],
      }),
      expectedTransitions: { root: ["ready", "succeeded"], left: ["pending", "ready", "succeeded"], right: ["pending", "ready", "succeeded"] },
      expectedOutcome: "completed",
    },
    join: {
      id,
      name: "Branch join graph",
      plan: createCompiledPlanFixture({
        id,
        nodes: [taskNode("root", [], ["left", "right"]), taskNode("left", ["root"], ["join"]), taskNode("right", ["root"], ["join"]), taskNode("join", ["left", "right"])],
        edges: [edge("root", "left"), edge("root", "right"), edge("left", "join"), edge("right", "join")],
      }),
      expectedTransitions: { join: ["pending", "waiting", "ready", "running", "succeeded"] },
      expectedOutcome: "completed",
    },
    checkpoint: {
      id,
      name: "Review checkpoint graph",
      plan: createCompiledPlanFixture({ id, nodes: [taskNode("draft", [], ["review"]), checkpointNode("review", ["draft"])], edges: [edge("draft", "review")] }),
      expectedTransitions: { review: ["pending", "waiting_for_user", "succeeded"] },
      expectedOutcome: "completed",
    },
    retry: {
      id,
      name: "Retryable failure graph",
      plan: createCompiledPlanFixture({ id, nodes: [taskNode("retryable")] }),
      expectedTransitions: { retryable: ["ready", "running", "failed", "retryable", "running", "succeeded"] },
      expectedOutcome: "completed",
    },
    blocked: {
      id,
      name: "Blocked node graph",
      plan: createCompiledPlanFixture({ id, nodes: [taskNode("blocked")] }),
      expectedTransitions: { blocked: ["ready", "running", "blocked"] },
      expectedOutcome: "blocked",
    },
    failure: {
      id,
      name: "Dependent failure containment graph",
      plan: createCompiledPlanFixture({ id, nodes: [taskNode("fail", [], ["dependent"]), taskNode("dependent", ["fail"])], edges: [edge("fail", "dependent")] }),
      expectedTransitions: { fail: ["ready", "running", "failed"], dependent: ["pending", "blocked"] },
      expectedOutcome: "failed",
    },
    "partial-branch-failure": {
      id,
      name: "Partial branch failure graph",
      plan: createCompiledPlanFixture({ id, nodes: [taskNode("root", [], ["safe", "fail"]), taskNode("safe", ["root"]), taskNode("fail", ["root"])], edges: [edge("root", "safe"), edge("root", "fail")] }),
      expectedTransitions: { safe: ["pending", "ready", "succeeded"], fail: ["pending", "ready", "failed"] },
      expectedOutcome: "failed",
    },
    "missing-result": {
      id,
      name: "Missing checkpoint result graph",
      plan: createCompiledPlanFixture({ id, nodes: [checkpointNode("missing-result")] }),
      expectedTransitions: { "missing-result": ["waiting_for_user", "blocked"] },
      expectedOutcome: "blocked",
    },
    "malformed-result": {
      id,
      name: "Malformed checkpoint result graph",
      plan: createCompiledPlanFixture({ id, nodes: [checkpointNode("malformed-result")] }),
      expectedTransitions: { "malformed-result": ["waiting_for_user", "failed"] },
      expectedOutcome: "failed",
    },
    empty: {
      id,
      name: "Empty graph rejection",
      plan: createCompiledPlanFixture({ id, nodes: [], entryNodeIds: [], terminalNodeIds: [], warnings: [{ path: "nodes", message: "empty graph" }] }),
      expectedTransitions: {},
      expectedOutcome: "rejected",
      invalidReason: "empty graph",
    },
    cyclic: {
      id,
      name: "Cyclic graph rejection",
      plan: createCompiledPlanFixture({ id, nodes: [taskNode("a", ["b"], ["b"]), taskNode("b", ["a"], ["a"])], edges: [edge("a", "b"), edge("b", "a")], entryNodeIds: [], terminalNodeIds: [], warnings: [{ path: "edges", message: "cycle detected" }] }),
      expectedTransitions: {},
      expectedOutcome: "rejected",
      invalidReason: "cycle detected",
    },
    impossible: {
      id,
      name: "Impossible dependency rejection",
      plan: createCompiledPlanFixture({ id, nodes: [taskNode("blocked", ["missing"])], entryNodeIds: [], warnings: [{ path: "nodes.blocked.dependencies", message: "missing dependency" }] }),
      expectedTransitions: { blocked: ["pending", "blocked"] },
      expectedOutcome: "rejected",
      invalidReason: "missing dependency",
    },
  };

  return scenarios[id];
}

export const requiredPlanGraphScenarioIds: PlanGraphScenarioId[] = [
  "linear",
  "branch",
  "join",
  "checkpoint",
  "retry",
  "blocked",
  "failure",
  "partial-branch-failure",
  "missing-result",
  "malformed-result",
  "empty",
  "cyclic",
  "impossible",
];

export function createAllPlanGraphScenarios() {
  return requiredPlanGraphScenarioIds.map(createPlanGraphScenario);
}
