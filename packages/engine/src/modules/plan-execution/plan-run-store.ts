import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PlanRun, PlanOverlayLayer } from "@chrona/contracts/ai";
import { loadLayers, replaceLayers, saveLayer } from "./layer-store";

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function savePlanRun(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  run: PlanRun;
  layers?: PlanOverlayLayer[];
}): Promise<PlanRun> {
  await db.taskPlanRun.upsert({
    where: {
      taskId_planId: {
        taskId: input.taskId,
        planId: input.planId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      planRun: asJsonValue(input.run),
    },
    update: {
      workspaceId: input.workspaceId,
      planRun: asJsonValue(input.run),
    },
  });

  if (input.layers) {
    await replaceLayers({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      layers: input.layers,
    });
  }

  return input.run;
}

export async function getPlanRun(
  taskId: string,
  planId: string,
): Promise<{ planRun: PlanRun; layers: PlanOverlayLayer[] } | null> {
  const row = await db.taskPlanRun.findUnique({
    where: {
      taskId_planId: {
        taskId,
        planId,
      },
    },
  });

  if (!row) {
    return null;
  }

  return {
    planRun: row.planRun as unknown as PlanRun,
    layers: await loadLayers(taskId, planId),
  };
}

export async function getLatestPlanRun(
  taskId: string,
): Promise<{ planRun: PlanRun; layers: PlanOverlayLayer[] } | null> {
  const row = await db.taskPlanRun.findFirst({
    where: { taskId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!row) {
    return null;
  }

  return {
    planRun: row.planRun as unknown as PlanRun,
    layers: await loadLayers(taskId, row.planId),
  };
}

export async function appendLayer(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  layer: PlanOverlayLayer;
}): Promise<PlanOverlayLayer[]> {
  const existing = await getPlanRun(input.taskId, input.planId);
  if (!existing) {
    throw new Error(
      `PlanRun not found for plan ${input.planId} task ${input.taskId}`,
    );
  }

  await saveLayer(input);
  return loadLayers(input.taskId, input.planId);
}

export async function getLayers(
  taskId: string,
  planId: string,
): Promise<PlanOverlayLayer[]> {
  return loadLayers(taskId, planId);
}
