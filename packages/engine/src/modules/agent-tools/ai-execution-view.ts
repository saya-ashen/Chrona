import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";
import { buildNodeRuntimeInput, buildSemanticRefHistory, refForNode } from "@/modules/plan-execution/runtime/node-runtime-refs";

function effectivePlanFrom(value: unknown): EffectivePlanGraph | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const savedPlan = record.savedPlan && typeof record.savedPlan === "object"
    ? record.savedPlan as Record<string, unknown>
    : record.task && typeof record.task === "object"
      ? ((record.task as Record<string, unknown>).savedPlan as Record<string, unknown> | undefined)
      : null;
  const effectivePlan = savedPlan?.effectivePlan;
  if (!effectivePlan || typeof effectivePlan !== "object") return null;
  return effectivePlan as EffectivePlanGraph;
}

function currentNodeFromEffective(plan: EffectivePlanGraph): EffectivePlanNode | null {
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
        ? buildNodeRuntimeInput({
            plan,
            node: currentNode,
          }).node
        : null,
      readyNodeRefs: plan.readyNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      runningNodeRefs: plan.runningNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      blockedNodeRefs: plan.blockedNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
      completedNodeRefs: plan.completedNodeIds.map((nodeId) => refForNode(history, nodeId).ref),
    },
    nodes: plan.nodes.map((node) => {
      const runtime = buildNodeRuntimeInput({
        plan,
        node,
      });
      return {
        ref: runtime.node.ref,
        title: runtime.node.title,
        type: runtime.node.type,
        status: node.status,
        objective: runtime.node.objective,
        expectedOutput: runtime.node.expectedOutput,
        completionCriteria: runtime.node.completionCriteria,
        condition: runtime.node.condition,
        checkpoint: runtime.node.checkpoint,
        wait: runtime.node.wait,
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
