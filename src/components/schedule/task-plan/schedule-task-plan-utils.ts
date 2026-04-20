import type { TaskPlanGraphResponse } from "@/modules/ai/types";

export async function applyTaskPlanGraphResult({
  taskId,
  result,
}: {
  taskId: string;
  result: TaskPlanGraphResponse;
}) {
  try {
    const res = await fetch("/api/ai/batch-apply-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        nodes: result.planGraph.nodes,
        edges: result.planGraph.edges,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to apply task plan");
    }

    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error : new Error("Failed to apply task plan"),
    };
  }
}
