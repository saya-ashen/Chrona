import type {
  AiVisibleRefBinding,
  ConditionConfig,
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeRuntimeInput,
  SemanticRefHistory,
} from "@chrona/contracts/ai";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function dateToken(input: string | undefined): string {
  const parsed = input ? new Date(input) : null;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function branchKey(index: number): string {
  if (index < LETTERS.length) return LETTERS[index];
  return `B${index + 1}`;
}

function nodeObjective(node: EffectivePlanNode): string | undefined {
  const config = node.config as Record<string, unknown>;
  if (typeof config.objective === "string" && config.objective.trim()) {
    return config.objective;
  }
  if (typeof node.definition.objective === "string" && node.definition.objective.trim()) {
    return node.definition.objective;
  }
  return node.description ?? node.title;
}

function outputSummary(node: EffectivePlanNode): string | undefined {
  const summary = node.result?.outputSummary;
  return typeof summary === "string" && summary.trim() ? summary : undefined;
}

function publicNodeConfig(node: EffectivePlanNode): EffectivePlanNode["config"] {
  if (node.type !== "condition") return node.config;
  const config = node.config as ConditionConfig;
  return {
    condition: config.condition,
    evaluationBy: config.evaluationBy,
    branches: config.branches.map((branch) => ({ label: branch.label })),
  } as EffectivePlanNode["config"];
}

function resolveBranchTarget(plan: EffectivePlanGraph, nextNodeId: string): EffectivePlanNode | undefined {
  return plan.nodes.find((node) =>
    node.id === nextNodeId || node.localId === nextNodeId || node.nodeId === nextNodeId,
  );
}

export function buildSemanticRefHistory(plan: EffectivePlanGraph): SemanticRefHistory {
  const token = dateToken(plan.resolvedAt);
  const taskRef: AiVisibleRefBinding = {
    ref: `T${token}-01`,
    kind: "task",
    label: "Current task",
    version: 1,
    backendId: plan.basePlanId,
  };
  const planRef: AiVisibleRefBinding = {
    ref: `P${token}-01`,
    kind: "plan",
    label: "Current plan",
    version: 1,
    backendId: plan.graphId,
  };
  const nodeRefs = plan.nodes.map((node, index): AiVisibleRefBinding => ({
    ref: `N${token}-${ordinal(index)}`,
    kind: "node",
    label: node.title,
    version: 1,
    backendId: node.id,
    nodeId: node.id,
    nodeLayerId: node.activeLayerId,
  }));
  const branchRefs = plan.nodes.flatMap((node, nodeIndex) => {
    if (node.type !== "condition") return [];
    const config = node.config as ConditionConfig;
    return config.branches.map((branch, branchIndex): AiVisibleRefBinding => {
      const key = branchKey(branchIndex);
      const target = resolveBranchTarget(plan, branch.nextNodeId);
      return {
        ref: `B${token}-${ordinal(nodeIndex)}-${key}`,
        kind: "branch",
        label: branch.label,
        version: 1,
        backendId: `${node.id}:${key}`,
        nodeId: node.id,
        nodeLayerId: node.activeLayerId,
        branchKey: key,
        nextNodeId: target?.id ?? branch.nextNodeId,
        nextNodeLayerId: target?.activeLayerId ?? null,
      };
    });
  });

  return {
    taskRef,
    planRef,
    nodeRefs,
    branchRefs,
    createdAt: plan.resolvedAt,
    version: 1,
  };
}

export function refForNode(history: SemanticRefHistory, nodeId: string): AiVisibleRefBinding {
  const ref = history.nodeRefs.find((candidate) => candidate.nodeId === nodeId || candidate.backendId === nodeId);
  if (!ref) throw new Error(`No AI-visible ref found for node ${nodeId}`);
  return ref;
}

export function branchBindingForRef(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  branchRef: string;
}): AiVisibleRefBinding {
  const history = buildSemanticRefHistory(input.plan);
  const binding = history.branchRefs.find((candidate) =>
    candidate.ref === input.branchRef && candidate.nodeId === input.node.id,
  );
  if (!binding) {
    throw new Error("condition branchRef is not valid for the current node");
  }
  if (binding.retiredAt) {
    throw new Error("condition branchRef is retired and cannot be selected");
  }
  if (!binding.nextNodeId) {
    throw new Error("condition branchRef has no resolved next node");
  }
  return binding;
}

export function buildNodeRuntimeInput(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  allowedTerminalTools: string[];
}): NodeRuntimeInput {
  const history = buildSemanticRefHistory(input.plan);
  const currentRef = refForNode(history, input.node.id);
  const branchOptions = input.node.type === "condition"
    ? history.branchRefs
        .filter((branch) => branch.nodeId === input.node.id && !branch.retiredAt)
        .map((branch) => ({
          ref: branch.ref,
          key: branch.branchKey ?? branch.ref,
          label: branch.label,
        }))
    : undefined;

  return {
    taskRef: history.taskRef.ref,
    planRef: history.planRef.ref,
    node: {
      ref: currentRef.ref,
      type: input.node.type,
      title: input.node.title,
      objective: nodeObjective(input.node),
      status: input.node.status,
      config: publicNodeConfig(input.node),
    },
    branchOptions,
    previousResults: input.plan.nodes
      .filter((node) => node.status === "completed" || node.status === "skipped")
      .map((node) => ({
        nodeRef: refForNode(history, node.id).ref,
        title: node.title,
        summary: outputSummary(node),
      })),
    allowedTerminalTools: input.allowedTerminalTools,
  };
}
