import type { CompiledPlan, CompiledNode, TaskPlanGraphResponse } from "@chrona/contracts/ai";
import type { LegacyPlanGraph, LegacyPlanGraphEdge, LegacyPlanGraphNode } from "@/components/schedule/schedule-page-types";
import type { PlanStep, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph";

type LegacyPlanGraphNodeExtras = LegacyPlanGraphNode & {
  readiness?: PlanStep["readiness"];
  dependencies?: string[];
  executionClassification?: PlanStep["executionClassification"];
  nextAction?: string | null;
  requiredInfo?: string[];
};

type PlanDisplayType = "task" | "checkpoint" | "condition" | "wait";

function normalizePlanNodeTypeForDisplay(rawType: unknown): PlanDisplayType {
  switch (rawType) {
    case "task":
    case "checkpoint":
    case "condition":
    case "wait":
      return rawType;
    case "step":
    case "deliverable":
    case "tool_action":
      return "task";
    case "decision":
      return "condition";
    case "user_input":
      return "checkpoint";
    default:
      return "task";
  }
}

function currentStepIdFromSteps(steps: PlanStep[]) {
  return steps.find((step) => ["in_progress", "waiting_for_user", "blocked"].includes(step.status))?.id ?? null;
}

export function compiledPlanToGraphPlan(
  plan: CompiledPlan | null | undefined,
  meta?: Partial<Omit<TaskPlanGraphPlan, "state" | "currentStepId" | "steps" | "edges">>,
): TaskPlanGraphPlan | null {
  if (!plan?.nodes?.length) {
    return null;
  }

  const steps: PlanStep[] = plan.nodes.map((node: CompiledNode) => ({
    id: node.id,
    title: node.title,
    objective: node.description ?? node.title,
    phase: node.type,
    status: "pending",
    requiresHumanInput: node.mode === "manual",
    type: node.type,
    displayType: normalizePlanNodeTypeForDisplay(node.type),
    linkedTaskId: node.linkedTaskId,
    executionMode: node.mode ?? null,
    estimatedMinutes: node.estimatedMinutes ?? null,
    priority: node.priority ?? null,
  }));

  return {
    state: "ready",
    currentStepId: currentStepIdFromSteps(steps),
    steps,
    edges: (plan.edges ?? []).map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      type: "sequential",
    })),
    ...meta,
  };
}

export function legacyPlanGraphToGraphPlan(graph: LegacyPlanGraph | null | undefined): TaskPlanGraphPlan | null {
  if (!graph?.nodes?.length) {
    return null;
  }

  const steps: PlanStep[] = graph.nodes.map((node: LegacyPlanGraphNode) => {
    const extraNode = node as LegacyPlanGraphNodeExtras;

    return ({
    id: node.id,
    title: node.title,
    objective: node.objective,
    phase: node.phase ?? node.type,
    status: (node.status === "skipped" ? "done" : node.status) as PlanStep["status"],
    requiresHumanInput: node.requiresHumanInput || node.status === "waiting_for_user",
    requiresHumanApproval: node.requiresHumanApproval ?? false,
    type: node.type,
    displayType: normalizePlanNodeTypeForDisplay(node.type),
    linkedTaskId: node.linkedTaskId,
    executionMode: node.executionMode,
    estimatedMinutes: node.estimatedMinutes,
    priority: node.priority,
    completionSummary: node.completionSummary ?? null,
    metadata: node.metadata as Record<string, unknown> | null,
    readiness: extraNode.readiness,
    dependencies: extraNode.dependencies,
    executionClassification: extraNode.executionClassification,
    nextAction: extraNode.nextAction,
    requiredInfo: extraNode.requiredInfo,
  });
  });

  return {
    state: "ready",
    revision: typeof graph.revision === "number" ? `r${graph.revision}` : null,
    generatedBy: graph.generatedBy,
    isMock: false,
    summary: graph.summary,
    updatedAt: graph.updatedAt,
    changeSummary: graph.changeSummary,
    currentStepId: currentStepIdFromSteps(steps),
    steps,
    edges: graph.edges.map((edge: LegacyPlanGraphEdge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      type: edge.type,
      label: edge.metadata && typeof edge.metadata === "object" && !Array.isArray(edge.metadata)
        ? (edge.metadata as Record<string, unknown>).label as string | undefined
        : undefined,
    })),
  };
}

export function taskPlanResponseToGraphPlan(response: TaskPlanGraphResponse | null | undefined) {
  return legacyPlanGraphToGraphPlan((response?.planGraph as LegacyPlanGraph | undefined) ?? null);
}

export function summarizeLegacyPlanGraph(graph: LegacyPlanGraph | null | undefined) {
  if (!graph) {
    return { totalEstimatedMinutes: 0, nodeCount: 0, warnings: [] as string[] };
  }

  const totalEstimatedMinutes = graph.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0);
  const warnings = graph.nodes.flatMap((node) => {
    const rawWarnings = node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>).warnings
      : null;
    return Array.isArray(rawWarnings)
      ? rawWarnings.filter((warning): warning is string => typeof warning === "string")
      : [];
  });

  return {
    totalEstimatedMinutes,
    nodeCount: graph.nodes.length,
    warnings,
  };
}
