import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type CreateGraphVersionInput = {
  workspaceId: string;
  taskId: string;
  version: number;
  graph: Prisma.InputJsonValue;
  createdBy: string;
};

export function createGraphVersion(input: CreateGraphVersionInput) {
  return db.graphVersion.create({ data: input });
}

export function getLatestGraphVersion(taskId: string) {
  return db.graphVersion.findFirst({
    where: { taskId },
    orderBy: { version: "desc" },
  });
}

export async function assertCurrentGraphVersion(taskId: string, expectedVersion: number) {
  const latest = await getLatestGraphVersion(taskId);
  return latest?.version === expectedVersion;
}
