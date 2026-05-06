import { MemoryScope, MemorySourceType, MemoryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type {
  CompiledPlan,
  EditablePlan,
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
  editablePlan: EditablePlan | null;
  status: "draft" | "accepted" | "superseded" | "archived";
  prompt: string | null;
  summary: string | null;
  generatedBy: string | null;
  changeSummary: string | null;
  legacyNodeStatuses?: Record<string, string>;
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

type LegacyTaskPlanGraphPayload = {
  type: "task_plan_graph_v1";
  status?: string;
  revision?: number;
  prompt?: string | null;
  summary?: string | null;
  changeSummary?: string | null;
  generatedBy?: string | null;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
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

function parseLegacyTaskPlanGraph(content: string): LegacyTaskPlanGraphPayload | null {
  try {
    const parsed = JSON.parse(content) as LegacyTaskPlanGraphPayload;
    return parsed.type === "task_plan_graph_v1" ? parsed : null;
  } catch {
    return null;
  }
}

function serializeLegacyTaskPlanGraph(payload: LegacyTaskPlanGraphPayload): string {
  return JSON.stringify(payload);
}

function normalizeLegacyNodeType(type: unknown): "task" | "checkpoint" | "condition" | "wait" {
  return type === "checkpoint" || type === "condition" || type === "wait" ? type : "task";
}

function buildLegacyNodeConfig(node: Record<string, unknown>, type: "task" | "checkpoint" | "condition" | "wait") {
  if (type === "checkpoint") {
    const checkpointType = node.requiresHumanApproval === true ? "approve" : node.requiresHumanInput === true ? "input" : "confirm";
    return {
      checkpointType,
      prompt: typeof node.objective === "string" ? node.objective : typeof node.title === "string" ? node.title : "Review step",
      required: true,
    } as const;
  }

  if (type === "condition") {
    return {
      condition: typeof node.objective === "string" ? node.objective : "Evaluate condition",
      evaluationBy: "system",
      branches: [],
    } as const;
  }

  if (type === "wait") {
    return {
      waitFor: typeof node.objective === "string" ? node.objective : "dependency",
    } as const;
  }

  return {
    expectedOutput: typeof node.objective === "string" ? node.objective : typeof node.title === "string" ? node.title : "Complete task",
    checkpointType: node.requiresHumanApproval === true ? "approve" : node.requiresHumanInput === true ? "input" : undefined,
  } as const;
}

function buildLegacyCompiledPlan(memoryId: string, payload: LegacyTaskPlanGraphPayload): CompiledPlan {
  const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const rawEdges = Array.isArray(payload.edges) ? payload.edges : [];
  const dependenciesByNodeId = new Map<string, string[]>();
  const dependentsByNodeId = new Map<string, string[]>();

  for (const edge of rawEdges) {
    const from = typeof edge.fromNodeId === "string" ? edge.fromNodeId : null;
    const to = typeof edge.toNodeId === "string" ? edge.toNodeId : null;
    if (!from || !to) continue;
    const dependencies = dependenciesByNodeId.get(to) ?? [];
    dependencies.push(from);
    dependenciesByNodeId.set(to, dependencies);
    const dependents = dependentsByNodeId.get(from) ?? [];
    dependents.push(to);
    dependentsByNodeId.set(from, dependents);
  }

  const nodes: CompiledPlan["nodes"] = rawNodes.map((node, index) => {
    const id = typeof node.id === "string" ? node.id : `legacy-node-${index + 1}`;
    const type = normalizeLegacyNodeType(node.type);
    const executionMode = typeof node.executionMode === "string" ? node.executionMode : null;

    return {
      id,
      localId: id,
      type,
      title: typeof node.title === "string" ? node.title : id,
      description: typeof node.description === "string" ? node.description : undefined,
      priority:
        node.priority === "Low" || node.priority === "Medium" || node.priority === "High" || node.priority === "Urgent"
          ? node.priority
          : undefined,
      linkedTaskId: typeof node.linkedTaskId === "string" ? node.linkedTaskId : undefined,
      config: buildLegacyNodeConfig(node, type),
      dependencies: dependenciesByNodeId.get(id) ?? [],
      dependents: dependentsByNodeId.get(id) ?? [],
      executor: node.requiresHumanInput === true || node.requiresHumanApproval === true ? "user" : "ai",
      mode:
        executionMode === "manual"
          ? "manual"
          : executionMode === "hybrid"
            ? "assist"
            : "auto",
      estimatedMinutes: typeof node.estimatedMinutes === "number" ? node.estimatedMinutes : undefined,
    };
  });

  const edges = rawEdges.flatMap((edge, index) => {
    const from = typeof edge.fromNodeId === "string" ? edge.fromNodeId : null;
    const to = typeof edge.toNodeId === "string" ? edge.toNodeId : null;
    if (!from || !to) return [];
    return [{
      id: typeof edge.id === "string" ? edge.id : `legacy-edge-${index + 1}`,
      from,
      to,
      label: typeof edge.type === "string" ? edge.type : undefined,
    }];
  });

  const entryNodeIds = nodes.filter((node) => node.dependencies.length === 0).map((node) => node.id);
  const terminalNodeIds = nodes.filter((node) => node.dependents.length === 0).map((node) => node.id);

  return {
    id: `legacy-compiled-${memoryId}`,
    editablePlanId: memoryId,
    sourceVersion: typeof payload.revision === "number" ? payload.revision : 1,
    title: typeof payload.summary === "string" && payload.summary.length > 0 ? payload.summary : "Plan",
    goal: typeof payload.summary === "string" ? payload.summary : "",
    assumptions: [],
    nodes,
    edges,
    entryNodeIds,
    terminalNodeIds,
    topologicalOrder: nodes.map((node) => node.id),
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

type CompiledPlanMemoryRecord = Awaited<ReturnType<typeof findCompiledPlanMemories>>[number];

type ParsedCompiledPlanMemory = {
  memory: CompiledPlanMemoryRecord;
  parsed: ParsedCompiledPlan;
};

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

async function findParsedCompiledPlanMemories(taskId: string): Promise<ParsedCompiledPlanMemory[]> {
  const memories = await findCompiledPlanMemories(taskId);
  return memories.flatMap((memory) => {
    const parsed = parseCompiledPlan(memory.content);
    return parsed ? [{ memory, parsed }] : [];
  });
}

async function findLegacyTaskPlanMemories(taskId: string) {
  const memories = await findCompiledPlanMemories(taskId);
  return memories.flatMap((memory) => {
    const parsed = parseLegacyTaskPlanGraph(memory.content);
    return parsed ? [{ memory, parsed }] : [];
  });
}

function toSavedCompiledPlanFromLegacy(memory: CompiledPlanMemoryRecord, parsed: LegacyTaskPlanGraphPayload, taskId: string): SavedCompiledPlan {
  const legacyNodeStatuses: Record<string, string> = {};
  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  for (const node of rawNodes) {
    const id = typeof node.id === "string" ? node.id : null;
    const status = typeof node.status === "string" ? node.status : null;
    if (id && status) {
      legacyNodeStatuses[id] = status;
    }
  }

  return {
    memoryId: memory.id,
    workspaceId: memory.workspaceId,
    taskId: memory.taskId ?? taskId,
    compiledPlan: buildLegacyCompiledPlan(memory.id, parsed),
    editablePlan: null,
    status: (parsed.status === "accepted" || parsed.status === "draft" || parsed.status === "superseded" || parsed.status === "archived"
      ? parsed.status
      : "draft") as SavedCompiledPlan["status"],
    prompt: typeof parsed.prompt === "string" ? parsed.prompt : null,
    summary: typeof parsed.summary === "string" ? parsed.summary : null,
    changeSummary: typeof parsed.changeSummary === "string" ? parsed.changeSummary : null,
    generatedBy: typeof parsed.generatedBy === "string" ? parsed.generatedBy : null,
    legacyNodeStatuses: Object.keys(legacyNodeStatuses).length > 0 ? legacyNodeStatuses : undefined,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
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

  // Supersede older active plans when saving a new accepted one.
  if (input.status === "accepted") {
    const memories = await findParsedCompiledPlanMemories(input.taskId);
    const supersedable = memories.filter(({ parsed }) => {
      return parsed.compiledPlan.editablePlanId !== input.compiledPlan.editablePlanId
        && (parsed.status === "draft" || parsed.status === "accepted");
    });

    for (const { memory, parsed } of supersedable) {
      await db.memory.update({
        where: { id: memory.id },
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

    const legacyMemories = await findLegacyTaskPlanMemories(input.taskId);
    const legacySupersedable = legacyMemories.filter(({ memory, parsed }) => {
      return memory.id !== input.compiledPlan.editablePlanId
        && (parsed.status === "draft" || parsed.status === "accepted");
    });

    for (const { memory, parsed } of legacySupersedable) {
      await db.memory.update({
        where: { id: memory.id },
        data: {
          content: serializeLegacyTaskPlanGraph({
            ...parsed,
            status: "superseded",
          }),
        },
      });
    }
  }

  // Find existing memory for this task with compiled_plan content
  const memories = await findParsedCompiledPlanMemories(input.taskId);
  const existing = memories.find(({ parsed }) => parsed.compiledPlan.editablePlanId === input.compiledPlan.editablePlanId)
    ?? memories[0]
    ?? null;

  if (existing) {
    await db.memory.update({
      where: { id: existing.memory.id },
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
  const memories = await findParsedCompiledPlanMemories(taskId);
  for (const { parsed } of memories) {
    if (parsed) return parsed.compiledPlan;
  }
  return null;
}

export async function getAcceptedCompiledPlan(taskId: string): Promise<SavedCompiledPlan | null> {
  const memories = await findParsedCompiledPlanMemories(taskId);
  for (const { memory, parsed } of memories) {
    if (parsed.status === "accepted") {
      return {
        memoryId: memory.id,
        workspaceId: memory.workspaceId,
        taskId: memory.taskId ?? taskId,
        compiledPlan: parsed.compiledPlan,
        editablePlan: parsed.editablePlan,
        status: parsed.status as SavedCompiledPlan["status"],
        prompt: parsed.prompt,
        summary: parsed.summary,
        changeSummary: null,
        generatedBy: parsed.generatedBy,
        createdAt: memory.createdAt.toISOString(),
        updatedAt: memory.updatedAt.toISOString(),
      };
    }
  }

  const legacyMemories = await findLegacyTaskPlanMemories(taskId);
  for (const { memory, parsed } of legacyMemories) {
    if (parsed.status === "accepted") {
      return toSavedCompiledPlanFromLegacy(memory, parsed, taskId);
    }
  }

  return null;
}

export async function getLatestCompiledPlan(taskId: string): Promise<SavedCompiledPlan | null> {
  const memories = await findParsedCompiledPlanMemories(taskId);
  for (const { memory, parsed } of memories) {
    if (parsed) {
      return {
        memoryId: memory.id,
        workspaceId: memory.workspaceId,
        taskId: memory.taskId ?? taskId,
        compiledPlan: parsed.compiledPlan,
        editablePlan: parsed.editablePlan,
        status: parsed.status as SavedCompiledPlan["status"],
        prompt: parsed.prompt,
        summary: parsed.summary,
        changeSummary: null,
        generatedBy: parsed.generatedBy,
        createdAt: memory.createdAt.toISOString(),
        updatedAt: memory.updatedAt.toISOString(),
      };
    }
  }

  const legacyMemories = await findLegacyTaskPlanMemories(taskId);
  for (const { memory, parsed } of legacyMemories) {
    return toSavedCompiledPlanFromLegacy(memory, parsed, taskId);
  }

  return null;
}

export async function getEditablePlan(taskId: string): Promise<EditablePlan | null> {
  const memories = await findParsedCompiledPlanMemories(taskId);
  for (const { parsed } of memories) {
    if (parsed.editablePlan) return parsed.editablePlan;
  }
  return null;
}
