import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { GraphMutationStatus } from "@/generated/prisma/enums";

export type CreateGraphMutationInput = {
  workspaceId: string;
  taskId: string;
  baseGraphVersion: number;
  operation: string;
  payload: Prisma.InputJsonValue;
  createdBy: string;
};

export function createGraphMutation(input: CreateGraphMutationInput) {
  return db.graphMutationRecord.create({ data: input });
}

export function listPendingGraphMutations(taskId: string) {
  return db.graphMutationRecord.findMany({
    where: { taskId, status: "Pending" },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateGraphMutationStatus(input: {
  id: string;
  status: GraphMutationStatus;
  validationResult?: Prisma.InputJsonValue;
  affectedNodeIds?: string[];
  appliedAt?: Date | null;
}) {
  return db.graphMutationRecord.update({
    where: { id: input.id },
    data: {
      status: input.status,
      validationResult: input.validationResult ?? undefined,
      affectedNodeIds: input.affectedNodeIds ?? undefined,
      appliedAt: input.appliedAt ?? null,
    },
  });
}
