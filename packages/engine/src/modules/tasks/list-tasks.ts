import { db } from "@/lib/db";
import type { TaskStatus } from "@/generated/prisma/client";

export async function listTasksByWorkspace(input: {
  workspaceId: string;
  status?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const tasks = await db.task.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.status ? { status: input.status as TaskStatus } : {}),
    },
    include: { projection: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return { tasks, count: tasks.length };
}
