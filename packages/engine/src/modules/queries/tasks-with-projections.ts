import { db } from "@/lib/db";

export async function getTasksWithProjections(taskIds: string[]) {
  return db.task.findMany({
    where: { id: { in: taskIds } },
    include: { projection: true },
    orderBy: { createdAt: "asc" },
  });
}
