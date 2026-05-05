import { TaskPriority, TaskStatus, type Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  getAcceptedCompiledPlan,
  getLatestCompiledPlan,
} from "@/modules/plan-execution/compiled-plan-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/plan-runner";
import { appendLayer, getLayers, getPlanRun, savePlanRun } from "@/modules/plan-execution/plan-run-store";
import { getRuntimeAdapterDefinition, resolveRuntimeAdapterKey } from "@/modules/task-execution/registry";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import type {
  RuntimeLayer,
  EffectivePlanNode,
  TaskConfig,
} from "@chrona/contracts/ai";

function normalizePriority(priority: string | null | undefined): TaskPriority {
  switch (priority) {
    case "Low":
      return TaskPriority.Low;
    case "High":
      return TaskPriority.High;
    case "Urgent":
      return TaskPriority.Urgent;
    default:
      return TaskPriority.Medium;
  }
}

function deriveTaskStatus(nodeStatus: string): TaskStatus {
  switch (nodeStatus) {
    case "running":
      return TaskStatus.Running;
    case "completed":
      return TaskStatus.Completed;
    case "blocked":
      return TaskStatus.Blocked;
    default:
      return TaskStatus.Ready;
  }
}

function createTaskProjectionData(params: {
  taskId: string;
  workspaceId: string;
  persistedStatus: TaskStatus;
  scheduleStatus: string;
}) {
  return {
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    persistedStatus: params.persistedStatus,
    displayState: params.persistedStatus,
    scheduleStatus: params.scheduleStatus,
  } satisfies Prisma.TaskProjectionUncheckedCreateInput;
}

function isMaterializableNode(node: EffectivePlanNode) {
  return node.mode === "auto" || node.mode === "assist"
    || (node as unknown as { mode?: string }).mode === "assisted"
    || (node as unknown as { mode?: string }).mode === "automatic"
    || (node as unknown as { mode?: string }).mode === "child_task";
}

function getTaskConfig(node: EffectivePlanNode): TaskConfig | null {
  if (node.type === "task" && node.config && "expectedOutput" in (node.config as Record<string, unknown>)) {
    return node.config as TaskConfig;
  }
  return null;
}

export async function materializeTaskPlan(input: { taskId: string }) {
  const accepted =
    (await getAcceptedCompiledPlan(input.taskId)) ??
    (await getLatestCompiledPlan(input.taskId));

  if (!accepted) {
    throw new Error("Task plan not found");
  }

  const parentTask = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: {
      id: true,
      workspaceId: true,
      runtimeAdapterKey: true,
      runtimeInputVersion: true,
      runtimeModel: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      dueAt: true,
      workspace: {
        select: {
          defaultRuntime: true,
        },
      },
    },
  });

  const planId = "planId" in accepted ? (accepted as { planId: string }).planId : accepted.compiledPlan.editablePlanId;

  const layers = await getLayers(input.taskId, planId);
  const effective = resolveEffectivePlanGraph(accepted.compiledPlan, layers);

  const createdTaskIds: string[] = [];
  const materializedNodeIds = new Set<string>();
  const resolvedLinkedTaskIds = new Map<string, string>();
  const runtimeAdapterKey = resolveRuntimeAdapterKey({
    runtimeAdapterKey: parentTask.runtimeAdapterKey,
    workspaceDefaultRuntime: parentTask.workspace.defaultRuntime,
  });
  const runtimeDefinition = getRuntimeAdapterDefinition(runtimeAdapterKey);

  for (const node of effective.nodes) {
    if (!isMaterializableNode(node)) {
      continue;
    }

    const taskConfig = getTaskConfig(node);
    let linkedTaskId = node.linkedTaskId;

    if (!linkedTaskId) {
      const objective = taskConfig?.expectedOutput ?? node.title;
      const createdTask = await db.task.create({
        data: {
          workspaceId: parentTask.workspaceId,
          title: node.title,
          description: node.description ?? null,
          status: deriveTaskStatus(node.status),
          priority: normalizePriority(node.priority),
          ownerType: "human",
          parentTaskId: parentTask.id,
          dueAt: parentTask.dueAt,
          scheduledStartAt: parentTask.scheduledStartAt,
          scheduledEndAt: parentTask.scheduledEndAt,
          runtimeAdapterKey,
          runtimeInput: {
            model: "gpt-5.4",
            prompt: objective,
          },
          runtimeInputVersion: parentTask.runtimeInputVersion ?? runtimeDefinition.inputVersion,
          runtimeModel: parentTask.runtimeModel ?? "gpt-5.4",
          prompt: objective,
          runtimeConfig: {
            sessionStrategy:
              node.metadata && typeof node.metadata === "object"
                ? (node.metadata as Record<string, unknown>).sessionStrategy ?? "per_subtask"
                : "per_subtask",
          },
        },
      });

      await db.taskProjection.upsert({
        where: { taskId: createdTask.id },
        create: createTaskProjectionData({
          taskId: createdTask.id,
          workspaceId: parentTask.workspaceId,
          persistedStatus: createdTask.status,
          scheduleStatus: createdTask.scheduleStatus,
        }),
        update: {
          persistedStatus: createdTask.status,
          displayState: createdTask.status,
          scheduleStatus: createdTask.scheduleStatus,
        },
      });

      linkedTaskId = createdTask.id;
      createdTaskIds.push(createdTask.id);
    } else {
      await db.task.update({
        where: { id: linkedTaskId },
        data: {
          title: node.title,
          description: node.description ?? null,
          priority: normalizePriority(node.priority),
          status: deriveTaskStatus(node.status),
          parentTaskId: parentTask.id,
        },
      });
    }

    materializedNodeIds.add(node.id);
    if (linkedTaskId) {
      resolvedLinkedTaskIds.set(node.id, linkedTaskId);
    }
  }

  // Create task dependencies from edges between materialized nodes
  const nodeTaskMap = new Map<string, string>();
  for (const node of effective.nodes) {
    const linkedTaskId = resolvedLinkedTaskIds.get(node.id) ?? node.linkedTaskId;
    if (materializedNodeIds.has(node.id) && linkedTaskId) {
      nodeTaskMap.set(node.id, linkedTaskId);
    }
  }

  for (const edge of effective.edges) {
    const fromTaskId = nodeTaskMap.get(edge.from);
    const toTaskId = nodeTaskMap.get(edge.to);
    if (!fromTaskId || !toTaskId) continue;

    await db.taskDependency.upsert({
      where: {
        taskId_dependsOnTaskId: {
          taskId: toTaskId,
          dependsOnTaskId: fromTaskId,
        },
      },
      create: {
        workspaceId: parentTask.workspaceId,
        taskId: toTaskId,
        dependsOnTaskId: fromTaskId,
        dependencyType: "blocks",
      },
      update: {
        dependencyType: "blocks",
      },
    });
  }

  // Append a RuntimeLayer with linkedTaskId for materialized nodes
  const nodeStates: Record<string, { linkedTaskId: string }> = {};
  for (const node of effective.nodes) {
    const linkedTaskId = resolvedLinkedTaskIds.get(node.id) ?? node.linkedTaskId;
    if (materializedNodeIds.has(node.id) && linkedTaskId) {
      nodeStates[node.id] = {
        linkedTaskId,
      };
    }
  }

  if (Object.keys(nodeStates).length > 0) {
    const layer: RuntimeLayer = {
      type: "runtime",
      planId,
      timestamp: new Date().toISOString(),
      layerId: `materialize_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      version: 1,
      active: true,
      source: "system",
      nodeStates: nodeStates as unknown as RuntimeLayer["nodeStates"],
    };

    const existingRun = await getPlanRun(input.taskId, planId);

    if (existingRun) {
      await appendLayer({
        workspaceId: parentTask.workspaceId,
        taskId: input.taskId,
        planId,
        layer,
      });
    } else {
      const persistedLayers = [...layers, layer];
      await savePlanRun({
        workspaceId: parentTask.workspaceId,
        taskId: input.taskId,
        planId,
        run: createPlanRunFromCompiledPlan(accepted.compiledPlan, persistedLayers),
        layers: persistedLayers,
      });
    }
  }

  return {
    taskId: parentTask.id,
    createdTaskIds,
    updatedNodeIds: [...materializedNodeIds],
  };
}
