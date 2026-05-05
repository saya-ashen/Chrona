import { MemoryScope, MemorySourceType, MemoryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PlanOverlayLayer } from "@chrona/contracts/ai";

type StoredLayerPayload = {
  type: "plan_layer_v1";
  planId: string;
  layerId: string;
  version: number;
  layer: PlanOverlayLayer;
};

export async function saveLayer(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  layer: PlanOverlayLayer;
}): Promise<void> {
  const payload: StoredLayerPayload = {
    type: "plan_layer_v1",
    planId: input.planId,
    layerId: input.layer.layerId,
    version: input.layer.version,
    layer: input.layer,
  };

  await db.memory.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      content: JSON.stringify(payload),
      scope: MemoryScope.task,
      sourceType: MemorySourceType.plan_layer,
      status: MemoryStatus.Active,
      confidence: 1,
    },
  });
}

export async function loadLayers(
  taskId: string,
  planId: string,
): Promise<PlanOverlayLayer[]> {
  const memories = await db.memory.findMany({
    where: {
      taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.plan_layer,
      status: MemoryStatus.Active,
    },
    orderBy: { createdAt: "asc" },
  });

  const layers: PlanOverlayLayer[] = [];

  for (const m of memories) {
    try {
      const parsed = JSON.parse(m.content) as StoredLayerPayload;
      if (parsed.type === "plan_layer_v1" && parsed.planId === planId && parsed.layer) {
        layers.push(parsed.layer);
      }
    } catch {
      // skip malformed rows
    }
  }

  return layers;
}

export async function deactivateLayer(memoryId: string): Promise<void> {
  await db.memory.update({
    where: { id: memoryId },
    data: { status: MemoryStatus.Inactive },
  });
}

export async function deactivateLayers(
  taskId: string,
  _planId: string,
): Promise<void> {
  await db.memory.updateMany({
    where: {
      taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.plan_layer,
      status: MemoryStatus.Active,
    },
    data: { status: MemoryStatus.Inactive },
  });
}
