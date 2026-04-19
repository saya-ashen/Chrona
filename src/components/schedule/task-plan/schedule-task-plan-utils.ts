import type { TaskPlanGraphResponse } from "@/modules/ai/types";

function planGraphResponseToProvidedSubtasks(result: TaskPlanGraphResponse) {
  const edgesByToNode = new Set(
    result.planGraph.edges
      .filter((edge) => edge.type === "sequential")
      .map((edge) => edge.toNodeId),
  );

  return [...result.planGraph.nodes]
    .sort((left, right) => {
      const leftOrder =
        typeof left.metadata?.order === "number"
          ? left.metadata.order
          : Number.MAX_SAFE_INTEGER;
      const rightOrder =
        typeof right.metadata?.order === "number"
          ? right.metadata.order
          : Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.title.localeCompare(right.title);
    })
    .map((node, index) => ({
      title: node.title,
      description: node.description ?? undefined,
      priority: node.priority ?? "Medium",
      estimatedMinutes: node.estimatedMinutes ?? 30,
      order:
        typeof node.metadata?.order === "number"
          ? node.metadata.order
          : index + 1,
      dependsOnPrevious: edgesByToNode.has(node.id),
    }));
}

export async function applyTaskPlanGraphResult({
  taskId,
  result,
}: {
  taskId: string;
  result: TaskPlanGraphResponse;
}) {
  try {
    const res = await fetch("/api/ai/batch-decompose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        replaceExisting: true,
        subtasks: planGraphResponseToProvidedSubtasks(result),
      }),
    });

    if (!res.ok) {
      throw new Error("Batch decompose failed");
    }

    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error : new Error("Batch decompose failed"),
    };
  }
}
