import { MemoryScope, MemorySourceType, MemoryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { PlanRun } from "@chrona/contracts/ai";

type StoredPlanRunPayload = {
  type: "plan_run_v1";
  planRun: PlanRun;
};

function serializePlanRun(run: PlanRun): string {
  const payload: StoredPlanRunPayload = {
    type: "plan_run_v1",
    planRun: run,
  };
  return JSON.stringify(payload);
}

function parsePlanRun(content: string): PlanRun | null {
  try {
    const parsed = JSON.parse(content) as StoredPlanRunPayload;
    if (parsed.type === "plan_run_v1" && parsed.planRun) {
      return parsed.planRun;
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

  const existingRunMemories = memories
    .filter((m) => {
      const parsed = parsePlanRun(m.content);
      return parsed !== null && parsed.compiledPlanId === input.planId;
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
      content: serializePlanRun(input.run),
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: 1,
    },
  });

  return input.run;
}

export async function getPlanRun(taskId: string, planId: string): Promise<PlanRun | null> {
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
    const run = parsePlanRun(memory.content);
    if (run && run.compiledPlanId === planId) {
      return run;
    }
  }

  return null;
}

export async function getLatestPlanRun(taskId: string): Promise<PlanRun | null> {
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
    const run = parsePlanRun(memory.content);
    if (run) return run;
  }

  return null;
}
