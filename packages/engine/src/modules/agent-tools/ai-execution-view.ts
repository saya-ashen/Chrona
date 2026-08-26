import type {
  PublicEffectivePlanGraph,
  PublicEffectivePlanNode,
} from "@chrona/contracts/ai";
import {
  buildRuntimeNodeView,
  buildSemanticRefHistory,
  refForNode,
} from "@/modules/plan-execution/runtime/node-runtime-refs";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

export type AiNodeReadInput = {
  ref?: string;
  offset?: number;
  maxChars?: number;
};

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

function aiVisibleNodeResult(node: PublicEffectivePlanNode) {
  const result = node.result;
  if (!result) return null;
  return {
    ...(result.outputSummary !== undefined ? { summary: result.outputSummary } : {}),
    ...(result.inputFields !== undefined ? { inputFields: result.inputFields } : {}),
    ...(result.deliverables !== undefined ? { deliverables: result.deliverables } : {}),
    ...(result.findings !== undefined ? { findings: result.findings } : {}),
    ...(result.decisions !== undefined ? { decisions: result.decisions } : {}),
    ...(result.caveats !== undefined ? { caveats: result.caveats } : {}),
    ...(result.nextActions !== undefined ? { nextActions: result.nextActions } : {}),
    ...(result.resultEvidence !== undefined ? { evidence: result.resultEvidence } : {}),
  };
}

function nodeForRef(plan: PublicEffectivePlanGraph, ref: string) {
  const history = buildSemanticRefHistory(plan);
  const binding = history.nodeRefs.find((candidate) => candidate.ref === ref);
  const node = binding
    ? plan.nodes.find((candidate) =>
        candidate.id === binding.nodeId ||
        candidate.nodeId === binding.nodeId ||
        candidate.localId === binding.nodeId
      )
    : undefined;
  if (!node) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Node ref is not part of the current execution plan",
    );
  }
  return node;
}

export function readAiNodeView(value: unknown, input: AiNodeReadInput = {}) {
  if (!input.ref) return readAiExecutionView(value);
  const plan = effectivePlanFrom(value);
  if (!plan) {
    throw new EngineError(
      ENGINE_ERROR_CODES.PLAN_NOT_FOUND,
      "Accepted execution plan was not found",
    );
  }
  const node = nodeForRef(plan, input.ref);
  const content = JSON.stringify(aiVisibleNodeResult(node), null, 2);
  const offset = Math.max(0, input.offset ?? 0);
  const maxChars = Math.min(12_000, Math.max(1, input.maxChars ?? 12_000));
  const nextOffset = offset + maxChars < content.length ? offset + maxChars : null;
  return {
    node: {
      ref: input.ref,
      title: node.title,
      type: node.type,
      status: node.status,
    },
    result: {
      contentType: "text/plain",
      encoding: "json-fragment",
      content: content.slice(offset, offset + maxChars),
      offset,
      nextOffset,
      totalChars: content.length,
    },
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
