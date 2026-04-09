import { db } from "@/lib/db";

export async function getMemoryConsole() {
  const items = await db.memory.findMany({
    include: { task: true },
    orderBy: { updatedAt: "desc" },
  });

  return items.map((item) => ({
    id: item.id,
    content: item.content,
    sourceType: item.sourceType,
    scope: item.scope,
    status: item.status,
    taskTitle: item.task?.title ?? null,
    runLabel: item.sourceRunId ?? null,
  }));
}
