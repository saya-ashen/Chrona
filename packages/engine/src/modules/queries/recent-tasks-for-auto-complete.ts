import { db } from "@/lib/db";

export async function getRecentTasksForAutoComplete(workspaceId: string) {
  const recentTasks = await db.taskProjection.findMany({
    where: { workspaceId },
    take: 10,
    orderBy: { updatedAt: "desc" },
    include: {
      task: {
        select: {
          title: true,
          status: true,
          priority: true,
          defaultSessionId: true,
          runtimeAdapterKey: true,
        },
      },
    },
  });

  return recentTasks.map((projection) => ({
    id: projection.taskId,
    title: projection.task.title,
    status: projection.task.status,
    priority: projection.task.priority ?? undefined,
    scheduledStartAt: projection.scheduledStartAt?.toISOString(),
    scheduledEndAt: projection.scheduledEndAt?.toISOString(),
  }));
}
