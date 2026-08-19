import type {
  PublicEffectivePlanGraph,
  PublicEffectivePlanNode,
} from "@chrona/contracts/ai";
import {
  buildRuntimeNodeView,
  buildSemanticRefHistory,
  refForNode,
} from "@/modules/plan-execution/runtime/node-runtime-refs";

function isPublicEffectivePlanGraph(value: unknown): value is PublicEffectivePlanGraph {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.graphId === "string"
    && typeof record.basePlanId === "string"
    && typeof record.resolvedAt === "string"
    && Array.isArray(record.nodes)
    && Array.isArray(record.readyNodeIds)
    && Array.isArray(record.runningNodeIds)
    && Array.isArray(record.blockedNodeIds)
    && Array.isArray(record.completedNodeIds);
}

function effectivePlanFrom(value: unknown): PublicEffectivePlanGraph | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const savedPlan = record.savedPlan && typeof record.savedPlan === "object"
    ? record.savedPlan as Record<string, unknown>
    : record.task && typeof record.task === "object"
      ? ((record.task as Record<string, unknown>).savedPlan as Record<string, unknown> | undefined)
      : null;
  return isPublicEffectivePlanGraph(savedPlan?.effectivePlan)
    ? savedPlan.effectivePlan
    : null;
}

function currentNodeFromEffective(plan: PublicEffectivePlanGraph): PublicEffectivePlanNode | null {
  return plan.nodes.find((node) => node.status === "running") ??
    plan.nodes.find((node) =>
      node.status === "waiting_for_user" ||
      node.status === "waiting_for_approval" ||
      node.status === "blocked" ||
      node.status === "failed"
    ) ??
    plan.nodes.find((node) => plan.readyNodeIds.includes(node.id)) ??
    null;
}

function runtimeNodeView(
  plan: PublicEffectivePlanGraph,
  node: PublicEffectivePlanNode,
) {
  const history = buildSemanticRefHistory(plan);
  const runtimeNode = buildRuntimeNodeView(node, refForNode(history, node.id).ref);
  const branchOptions = node.type === "condition"
    ? history.branchRefs
      .filter((branch) => branch.nodeId === node.id && !branch.retiredAt)
      .map((branch) => ({
        ref: branch.ref,
        key: branch.branchKey ?? branch.ref,
        label: branch.label,
      }))
    : undefined;
  return { runtimeNode, branchOptions };
}

export function readAiExecutionView(value: unknown) {
  const plan = effectivePlanFrom(value);
  if (!plan) return redactBackendIds(value);
  const history = buildSemanticRefHistory(plan);
  const currentNode = currentNodeFromEffective(plan);
  const task = value && typeof value === "object" && "task" in value && typeof (value as { task?: unknown }).task === "object"
    ? (value as { task: Record<string, unknown> }).task
    : null;
  const savedPlan = value && typeof value === "object" && "savedPlan" in value
    ? (value as { savedPlan?: Record<string, unknown> | null }).savedPlan
    : task?.savedPlan as Record<string, unknown> | null | undefined;

  return {
    task: task
      ? {
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueAt: task.dueAt,
          blockReason: task.blockReason,
        }
      : undefined,
    plan: {
      ref: history.planRef.ref,
      status: savedPlan?.status,
      revision: savedPlan?.revision,
      summary: savedPlan?.summary,
    },
    execution: {
      currentNode: currentNode
        ? runtimeNodeView(plan, currentNode).runtimeNode
        : null,
      readyNodeRefs: plan.readyNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      runningNodeRefs: plan.runningNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      blockedNodeRefs: plan.blockedNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      completedNodeRefs: plan.completedNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
    },
    nodes: plan.nodes.map((node) => {
      const runtime = runtimeNodeView(plan, node);
      return {
        ref: runtime.runtimeNode.ref,
        title: runtime.runtimeNode.title,
        type: runtime.runtimeNode.type,
        status: node.status,
        objective: runtime.runtimeNode.objective,
        expectedOutput: runtime.runtimeNode.expectedOutput,
        completionCriteria: runtime.runtimeNode.completionCriteria,
        condition: runtime.runtimeNode.condition,
        checkpoint: runtime.runtimeNode.checkpoint,
        wait: runtime.runtimeNode.wait,
        branchOptions: runtime.branchOptions,
      };
    }),
  };
}

function redactBackendIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBackendIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^(id|.*Id|.*Ids)$/.test(key))
      .map(([key, entry]) => [key, redactBackendIds(entry)]),
  );
}
