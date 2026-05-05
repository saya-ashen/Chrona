import { MemoryScope, MemorySourceType, MemoryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PlanRun, PlanOverlayLayer } from "@chrona/contracts/ai";

type StoredPlanRunPayload = {
  type: "plan_run_v2";
  planRun: PlanRun;
  layers: PlanOverlayLayer[];
};

function serializePlanRun(run: PlanRun, layers: PlanOverlayLayer[] = []): string {
  const payload: StoredPlanRunPayload = {
    type: "plan_run_v2",
    planRun: run,
    layers,
  };
  return JSON.stringify(payload);
}

function parsePlanRun(content: string): { planRun: PlanRun; layers: PlanOverlayLayer[] } | null {
  try {
    const parsed = JSON.parse(content) as StoredPlanRunPayload;
    if (parsed.type === "plan_run_v2" && parsed.planRun) {
      return {
        planRun: parsed.planRun,
        layers: Array.isArray(parsed.layers) ? parsed.layers : [],
      };
    }
    // Backward compat: v1 payloads (no layers)
    if ((parsed as { type: string }).type === "plan_run_v1" && (parsed as { planRun: PlanRun }).planRun) {
      return { planRun: (parsed as { planRun: PlanRun }).planRun, layers: [] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function savePlanRun(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  run: PlanRun;
  layers?: PlanOverlayLayer[];
}): Promise<PlanRun> {
  const memories = await db.memory.findMany({
    where: {
      taskId: input.taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
    },
    orderBy: { createdAt: "desc" },
  });

  const existingRunMemories = memories.filter((m) => {
    const parsed = parsePlanRun(m.content);
    return parsed !== null && parsed.planRun.compiledPlanId === input.planId;
  });

  if (existingRunMemories.length > 0) {
    await db.memory.updateMany({
      where: { id: { in: existingRunMemories.map((m) => m.id) } },
      data: { status: MemoryStatus.Inactive },
    });
  }

  const content = serializePlanRun(input.run, input.layers);

  await db.memory.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      content,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: 1,
    },
  });

  return input.run;
}

export async function getPlanRun(taskId: string, planId: string): Promise<{ planRun: PlanRun; layers: PlanOverlayLayer[] } | null> {
  const memories = await db.memory.findMany({
    where: {
      taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
    },
    orderBy: { createdAt: "desc" },
  });

  for (const memory of memories) {
    const parsed = parsePlanRun(memory.content);
    if (parsed && parsed.planRun.compiledPlanId === planId) {
      return parsed;
    }
  }

  return null;
}

export async function getLatestPlanRun(taskId: string): Promise<{ planRun: PlanRun; layers: PlanOverlayLayer[] } | null> {
  const memories = await db.memory.findMany({
    where: {
      taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
    },
    orderBy: { createdAt: "desc" },
  });

  for (const memory of memories) {
    const parsed = parsePlanRun(memory.content);
    if (parsed) return parsed;
  }

  return null;
}

export async function appendLayer(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  layer: PlanOverlayLayer;
}): Promise<PlanOverlayLayer[]> {
  const existing = await getPlanRun(input.taskId, input.planId);
  if (!existing) {
    throw new Error(`PlanRun not found for plan ${input.planId} task ${input.taskId}`);
  }

  const layers = [...existing.layers, input.layer];
  const updated = serializePlanRun(existing.planRun, layers);

  const memories = await db.memory.findMany({
    where: {
      taskId: input.taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
    },
    orderBy: { createdAt: "desc" },
  });

  const existingRunMemories = memories.filter((m) => {
    const parsed = parsePlanRun(m.content);
    return parsed !== null && parsed.planRun.compiledPlanId === input.planId;
  });

  if (existingRunMemories.length > 0) {
    await db.memory.updateMany({
      where: { id: { in: existingRunMemories.map((m) => m.id) } },
      data: { status: MemoryStatus.Inactive },
    });
  }

  await db.memory.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      content: updated,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: 1,
    },
  });

  return layers;
}

export async function getLayers(taskId: string, planId: string): Promise<PlanOverlayLayer[]> {
  const runAndLayers = await getPlanRun(taskId, planId);
  return runAndLayers?.layers ?? [];
}
