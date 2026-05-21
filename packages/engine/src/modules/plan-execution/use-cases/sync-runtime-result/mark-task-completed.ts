import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function markTaskCompleted(taskId: string) {
  await db.task.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.Completed,
      completedAt: new Date(),
      blockReason: Prisma.DbNull,
    },
  });
  await rebuildTaskProjection(taskId);
}
