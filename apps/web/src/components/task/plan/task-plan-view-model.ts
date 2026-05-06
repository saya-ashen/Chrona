import type { CompiledPlan, CompiledNode } from "@chrona/contracts/ai";
import type { PlanStep, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph";

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

export function summarizeCompiledPlan(plan: CompiledPlan | null | undefined) {
  if (!plan) {
    return { totalEstimatedMinutes: 0, nodeCount: 0, warnings: [] as string[] };
  }

  const totalEstimatedMinutes = plan.nodes.reduce(
    (sum, node) => sum + (node.estimatedMinutes ?? 0),
    0,
  );
  const warnings = plan.validationWarnings.map(
    (w) => `${w.path}: ${w.message}`,
  );

  return {
    totalEstimatedMinutes,
    nodeCount: plan.nodes.length,
    warnings,
  };
}
