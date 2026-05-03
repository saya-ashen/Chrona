import type { TaskPlanGraphResponse, TaskPlanNode } from "@/modules/ai/types";

export type PlanDisplayType = "task" | "checkpoint" | "condition" | "wait";

export function normalizePlanNodeTypeForDisplay(rawType: unknown): PlanDisplayType {
  switch (rawType) {
    case "task":
    case "checkpoint":
    case "condition":
    case "wait":
      return rawType;
    // Legacy type mappings
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

export function toPlanGraphPlan(res: TaskPlanGraphResponse | null) {
  if (!res?.planGraph?.nodes?.length) return null;
  const g = res.planGraph;
  const steps = g.nodes.map((n: TaskPlanNode) => ({
    id: n.id,
    title: n.title,
    objective: n.objective,
    phase: n.phase ?? n.type,
    status: (n.status === "skipped" ? "done" : n.status) as
      | "pending"
      | "in_progress"
      | "waiting_for_user"
      | "done"
      | "blocked",
    requiresHumanInput: n.requiresHumanInput || n.status === "waiting_for_user",
    requiresHumanApproval: n.requiresHumanApproval ?? false,
    type: n.type,
    displayType: normalizePlanNodeTypeForDisplay(n.type),
    linkedTaskId: n.linkedTaskId,
    executionMode: n.executionMode,
    estimatedMinutes: n.estimatedMinutes,
    priority: n.priority,
    metadata: n.metadata as Record<string, unknown> | null,
  }));
  const currentStepId =
    steps.find((s) => ["in_progress", "waiting_for_user", "blocked"].includes(s.status))?.id ?? null;
  return {
    state: "ready" as const,
    currentStepId,
    steps,
    edges: g.edges.map((e) => ({
      id: e.id,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      type: e.type,
      label: e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
        ? (e.metadata as Record<string, unknown>).label as string | undefined
        : undefined,
    })),
  };
}
