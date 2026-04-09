import { db } from "@/lib/db";

export async function getMemoryConsole(workspaceId: string) {
  const items = await db.memory.findMany({
    where: { workspaceId },
    include: { task: true },
    orderBy: { updatedAt: "desc" },
  });

  return items.map((item) => ({
    id: item.id,
    content: item.content,
    sourceType: item.sourceType,
    scope: item.scope,
    status: item.status,
    workspaceId: item.workspaceId,
    taskId: item.taskId,
    taskTitle: item.task?.title ?? null,
    runLabel: item.sourceRunId ?? null,
  }));
}
