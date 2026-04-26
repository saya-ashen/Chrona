import type { TaskPlanGraphResponse, TaskPlanNode } from "@/modules/ai/types";

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
    type: n.type,
    linkedTaskId: n.linkedTaskId,
    executionMode: n.executionMode,
    estimatedMinutes: n.estimatedMinutes,
    priority: n.priority,
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
    })),
  };
}
