import { db } from "@/lib/db";

export async function getWorkProjection(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      runs: { orderBy: { createdAt: "desc" }, take: 5 },
      events: { orderBy: [{ runtimeTs: "asc" }, { ingestSequence: "asc" }] },
      approvals: { orderBy: { requestedAt: "desc" } },
      artifacts: { orderBy: { createdAt: "desc" } },
    },
  });

  const currentRun = task.runs[0] ?? null;

  return {
    taskShell: {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt,
      blockReason: task.blockReason,
    },
    currentRun,
    timeline: task.events,
    approvals: task.approvals,
    artifacts: task.artifacts,
  };
}
