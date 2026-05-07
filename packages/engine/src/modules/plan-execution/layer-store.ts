import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PlanOverlayLayer } from "@chrona/contracts/ai";

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function saveLayer(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  layer: PlanOverlayLayer;
}): Promise<void> {
  await db.taskPlanLayer.upsert({
    where: {
      layerId: input.layer.layerId,
    },
    create: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      layerId: input.layer.layerId,
      version: input.layer.version,
      layer: asJsonValue(input.layer),
    },
    update: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      version: input.layer.version,
      layer: asJsonValue(input.layer),
    },
  });
}

export async function replaceLayers(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  layers: PlanOverlayLayer[];
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.taskPlanLayer.deleteMany({
      where: {
        taskId: input.taskId,
        planId: input.planId,
      },
    });

    if (input.layers.length === 0) {
      return;
    }

    await tx.taskPlanLayer.createMany({
      data: input.layers.map((layer) => ({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        planId: input.planId,
        layerId: layer.layerId,
        version: layer.version,
        layer: asJsonValue(layer),
      })),
    });
  });
}

export async function loadLayers(
  taskId: string,
  planId: string,
): Promise<PlanOverlayLayer[]> {
  const rows = await db.taskPlanLayer.findMany({
    where: {
      taskId,
      planId,
    },
    orderBy: [{ version: "asc" }, { createdAt: "asc" }],
  });

  return rows.map((row) => row.layer as unknown as PlanOverlayLayer);
}
