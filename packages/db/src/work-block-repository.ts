import { db } from "./db";
import type { WorkBlock, Prisma } from "./generated/prisma/client";

export async function getActiveWorkBlock(taskId: string): Promise<WorkBlock | null> {
  return db.workBlock.findFirst({
    where: { taskId, status: "Active" },
    orderBy: { startedAt: "desc" },
  });
}

export async function getWorkBlocksByTask(
  taskId: string,
  status?: "Scheduled" | "Active" | "Completed" | "Cancelled",
): Promise<WorkBlock[]> {
  return db.workBlock.findMany({
    where: { taskId, ...(status ? { status } : {}) },
    orderBy: { scheduledStartAt: "desc" },
  });
}

export async function createWorkBlock(
  data: Prisma.WorkBlockCreateInput,
): Promise<WorkBlock> {
  return db.workBlock.create({ data });
}
