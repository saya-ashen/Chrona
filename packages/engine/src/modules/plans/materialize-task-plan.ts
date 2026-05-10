import { TaskPriority, TaskStatus, type Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  getAcceptedCompiledPlan,
  getLatestCompiledPlan,
} from "@/modules/plan-execution/compiled-plan-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/plan-runner";
import {
  createPlanGraphFromCompiledPlan,
  getPlanRun,
  savePlanRun,
} from "@/modules/plan-execution/plan-run-store";
import { resolveSavedPlanEffectiveGraph } from "@/modules/plans/task-plan-read-model";
import { resolveExecutionRuntime } from "@/modules/task-execution/registry";
import type {
  EffectivePlanNode,
  PlanGraph,
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

function pushLinkedTaskDefinitionLayer(input: {
  graph: PlanGraph;
  nodeId: string;
  linkedTaskId: string;
}) {
  const timestamp = new Date().toISOString();
  input.graph.nodes = input.graph.nodes.map((node: PlanGraph["nodes"][number]) => {
    if (node.id !== input.nodeId) {
      return node;
    }
    const activeDefinition = [...node.layers]
      .reverse()
      .find((layer) => layer.type === "definition");
    if (!activeDefinition || activeDefinition.type !== "definition") {
      return node;
    }
    return {
      ...node,
      updatedAt: timestamp,
      layers: [
        ...node.layers,
        {
          ...activeDefinition,
          id: `node_layer_${input.graph.id}_${node.id}_${Date.now()}`,
          createdAt: timestamp,
          createdBy: "system",
          reason: "linked_task_materialized",
          definition: {
            ...activeDefinition.definition,
            semantics: {
              ...activeDefinition.definition.semantics,
              linkedTaskId: input.linkedTaskId,
            },
          },
        },
      ],
    };
  });
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
      executionRuntime: true,
      dueAt: true,
      workspace: {
        select: {
          defaultRuntime: true,
        },
      },
    },
  });

  const planId = accepted.compiledPlan.editablePlanId;
  const effective = await resolveSavedPlanEffectiveGraph(accepted);

  const createdTaskIds: string[] = [];
  const materializedNodeIds = new Set<string>();
  const resolvedLinkedTaskIds = new Map<string, string>();
  const executionRuntime = resolveExecutionRuntime({
    executionRuntime: parentTask.executionRuntime,
    workspaceDefaultRuntime: parentTask.workspace.defaultRuntime,
  });

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
          parentTaskId: parentTask.id,
          dueAt: parentTask.dueAt,
          executionRuntime,
          executionConfig: {
            model: "gpt-5.4",
            prompt: objective,
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
          scheduleStatus: "Unscheduled",
        }),
        update: {
          persistedStatus: createdTask.status,
          displayState: createdTask.status,
          scheduleStatus: "Unscheduled",
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

  const existingRun = await getPlanRun(input.taskId, planId);
  const graph = structuredClone(
    existingRun?.graph ??
      createPlanGraphFromCompiledPlan({
        taskId: input.taskId,
        compiledPlan: accepted.compiledPlan,
      }),
  );

  for (const node of effective.nodes) {
    const linkedTaskId = resolvedLinkedTaskIds.get(node.id) ?? node.linkedTaskId;
    if (materializedNodeIds.has(node.id) && linkedTaskId) {
      pushLinkedTaskDefinitionLayer({
        graph,
        nodeId: node.id,
        linkedTaskId,
      });
    }
  }

  if (materializedNodeIds.size > 0) {
    await savePlanRun({
      workspaceId: parentTask.workspaceId,
      taskId: input.taskId,
      planId,
      run:
        existingRun?.planRun ?? createPlanRunFromCompiledPlan(accepted.compiledPlan),
      compiledPlan: accepted.compiledPlan,
      graph,
      attempts: existingRun?.attempts ?? [],
      results: existingRun?.results ?? [],
      executionContextSnapshots: existingRun?.executionContextSnapshots ?? [],
    });
  }

  return {
    taskId: parentTask.id,
    createdTaskIds,
    updatedNodeIds: [...materializedNodeIds],
  };
}
