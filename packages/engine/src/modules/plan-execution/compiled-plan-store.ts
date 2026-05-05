import { MemoryScope, MemorySourceType, MemoryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type {
  CompiledPlan,
  EditablePlan,
  PlanRun,
  PlanOverlayLayer,
} from "@chrona/contracts/ai";

// ─── Types ───

type StoredCompiledPlanPayload = {
  type: "compiled_plan_v1";
  compiledPlan: CompiledPlan;
  editablePlan: EditablePlan | null;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt: string | null;
  summary: string | null;
  generatedBy: string | null;
};

export type SavedCompiledPlan = {
  memoryId: string;
  workspaceId: string;
  taskId: string;
  compiledPlan: CompiledPlan;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt: string | null;
  summary: string | null;
  generatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── Serialization ───

function serializeCompiledPlan(input: {
  compiledPlan: CompiledPlan;
  editablePlan?: EditablePlan | null;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt?: string | null;
  summary?: string | null;
  generatedBy?: string | null;
}): string {
  const payload: StoredCompiledPlanPayload = {
    type: "compiled_plan_v1",
    compiledPlan: input.compiledPlan,
    editablePlan: input.editablePlan ?? null,
    status: input.status,
    prompt: input.prompt ?? null,
    summary: input.summary ?? null,
    generatedBy: input.generatedBy ?? null,
  };
  return JSON.stringify(payload);
}

type ParsedCompiledPlan = {
  compiledPlan: CompiledPlan;
  editablePlan: EditablePlan | null;
  status: string;
  prompt: string | null;
  summary: string | null;
  generatedBy: string | null;
};

function parseCompiledPlan(content: string): ParsedCompiledPlan | null {
  try {
    const parsed = JSON.parse(content) as StoredCompiledPlanPayload;
    if (parsed.type === "compiled_plan_v1" && parsed.compiledPlan) {
      return {
        compiledPlan: parsed.compiledPlan,
        editablePlan: parsed.editablePlan ?? null,
        status: parsed.status,
        prompt: parsed.prompt,
        summary: parsed.summary,
        generatedBy: parsed.generatedBy,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Queries ───

async function findCompiledPlanMemories(taskId: string) {
  return db.memory.findMany({
    where: {
      taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

function isCompiledPayload(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { type?: string };
    return parsed.type === "compiled_plan_v1";
  } catch {
    return false;
  }
}

export async function saveCompiledPlan(input: {
  workspaceId: string;
  taskId: string;
  compiledPlan: CompiledPlan;
  editablePlan?: EditablePlan | null;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt?: string | null;
  summary?: string | null;
  generatedBy?: string | null;
}): Promise<void> {
  const content = serializeCompiledPlan(input);

  // Supersede existing accepted compiled plans if saving a new accepted one
  if (input.status === "accepted") {
    const memories = await findCompiledPlanMemories(input.taskId);
    const supersedable = memories.filter((m) => {
      if (!isCompiledPayload(m.content)) return false;
      const parsed = parseCompiledPlan(m.content);
      return parsed?.status === "accepted";
    });
    for (const m of supersedable) {
      const parsed = parseCompiledPlan(m.content);
      if (parsed) {
        await db.memory.update({
          where: { id: m.id },
          data: {
            content: serializeCompiledPlan({
              compiledPlan: parsed.compiledPlan,
              editablePlan: parsed.editablePlan,
              status: "superseded",
              prompt: parsed.prompt,
              summary: parsed.summary,
              generatedBy: parsed.generatedBy,
            }),
          },
        });
      }
    }
  }

  // Find existing memory for this task with compiled_plan content
  const memories = await findCompiledPlanMemories(input.taskId);
  const existing = memories.length > 0 ? memories[0] : null;

  if (existing) {
    await db.memory.update({
      where: { id: existing.id },
      data: { content },
    });
  } else {
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
  }
}

export async function getCompiledPlan(taskId: string): Promise<CompiledPlan | null> {
  const memories = await findCompiledPlanMemories(taskId);
  for (const memory of memories) {
    const parsed = parseCompiledPlan(memory.content);
    if (parsed) return parsed.compiledPlan;
  }
  return null;
}

export async function getAcceptedCompiledPlan(taskId: string): Promise<{ compiledPlan: CompiledPlan; planId: string; memoryId: string; workspaceId: string } | null> {
  const memories = await findCompiledPlanMemories(taskId);
  for (const memory of memories) {
    const parsed = parseCompiledPlan(memory.content);
    if (parsed?.status === "accepted" || parsed?.status === "draft") {
      return {
        compiledPlan: parsed.compiledPlan,
        planId: parsed.compiledPlan.editablePlanId,
        memoryId: memory.id,
        workspaceId: memory.workspaceId,
      };
    }
  }
  return null;
}

export async function getLatestCompiledPlan(taskId: string): Promise<SavedCompiledPlan | null> {
  const memories = await findCompiledPlanMemories(taskId);
  for (const memory of memories) {
    const parsed = parseCompiledPlan(memory.content);
    if (parsed) {
      return {
        memoryId: memory.id,
        workspaceId: memory.workspaceId,
        taskId: memory.taskId ?? taskId,
        compiledPlan: parsed.compiledPlan,
        status: parsed.status as SavedCompiledPlan["status"],
        prompt: parsed.prompt,
        summary: parsed.summary,
        generatedBy: parsed.generatedBy,
        createdAt: memory.createdAt.toISOString(),
        updatedAt: memory.updatedAt.toISOString(),
      };
    }
  }
  return null;
}

export async function getEditablePlan(taskId: string): Promise<EditablePlan | null> {
  const memories = await findCompiledPlanMemories(taskId);
  for (const memory of memories) {
    const parsed = parseCompiledPlan(memory.content);
    if (parsed?.editablePlan) return parsed.editablePlan;
  }
  return null;
}
