import { TaskPriority, TaskStatus, type Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { TaskPlanEdge, TaskPlanNode } from "@/modules/ai/types";
import {
  getAcceptedTaskPlanGraph,
  getLatestTaskPlanGraph,
  saveTaskPlanGraph,
} from "@/modules/tasks/task-plan-graph-store";

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

function deriveTaskStatus(node: TaskPlanNode): TaskStatus {
  switch (node.status) {
    case "in_progress":
      return TaskStatus.Running;
    case "done":
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

function isMaterializableNode(node: TaskPlanNode) {
  const executionMode = (node as Record<string, unknown>).executionMode;
  // Canonical graph contract only emits automatic/manual/hybrid.
  // `child_task` is accepted here as a legacy persisted value to keep old plans re-materializable.
  // TODO(chrona-refactor): remove `child_task` fallback after all stored v1 plans are migrated.
  return executionMode === "automatic" || executionMode === "child_task";
}

function isSequentialMaterializedEdge(edge: TaskPlanEdge, materializedNodeIds: Set<string>) {
  return (
    edge.type === "sequential" &&
    materializedNodeIds.has(edge.fromNodeId) &&
    materializedNodeIds.has(edge.toNodeId)
  );
}

export async function materializeTaskPlan(input: { taskId: string }) {
  const savedPlan =
    (await getAcceptedTaskPlanGraph(input.taskId)) ??
    (await getLatestTaskPlanGraph(input.taskId));

  if (!savedPlan) {
    throw new Error("Task plan graph not found");
  }

  const parentTask = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: {
      id: true,
      workspaceId: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      dueAt: true,
    },
  });

  const nextNodes = savedPlan.plan.nodes.map((node) => ({ ...node }));
  const createdTaskIds: string[] = [];
  const updatedNodeIds: string[] = [];
  const materializedNodeIds = new Set<string>();

  for (const node of nextNodes) {
    if (!isMaterializableNode(node)) {
      continue;
    }

    let linkedTaskId = node.linkedTaskId;
    if (!linkedTaskId) {
      const createdTask = await db.task.create({
        data: {
          workspaceId: parentTask.workspaceId,
          title: node.title,
          description: node.description,
          status: deriveTaskStatus(node),
          priority: normalizePriority(node.priority),
          ownerType: "human",
          parentTaskId: parentTask.id,
          dueAt: parentTask.dueAt,
          scheduledStartAt: parentTask.scheduledStartAt,
          scheduledEndAt: parentTask.scheduledEndAt,
          runtimeAdapterKey: "openclaw",
          runtimeInput: {
            model: "gpt-5.4",
            prompt: node.objective,
          },
          // TODO(chrona-runtime): bump to a non-legacy runtime input version once
          // the runtime schema migration lands end-to-end.
          runtimeInputVersion: "openclaw-legacy-v1",
          runtimeModel: "gpt-5.4",
          prompt: node.objective,
          runtimeConfig: {
            sessionStrategy:
              node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
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
          description: node.description,
          priority: normalizePriority(node.priority),
          status: deriveTaskStatus(node),
          parentTaskId: parentTask.id,
        },
      });
    }

    node.linkedTaskId = linkedTaskId;
    updatedNodeIds.push(node.id);
    materializedNodeIds.add(node.id);
  }

  const nodeTaskMap = new Map(
    nextNodes
      .filter((node) => node.linkedTaskId)
      .map((node) => [node.id, node.linkedTaskId!] as const),
  );

  for (const edge of savedPlan.plan.edges) {
    if (!isSequentialMaterializedEdge(edge, materializedNodeIds)) {
      continue;
    }

    const fromTaskId = nodeTaskMap.get(edge.fromNodeId);
    const toTaskId = nodeTaskMap.get(edge.toNodeId);
    if (!fromTaskId || !toTaskId) {
      continue;
    }

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

  const updatedPlan = {
    ...savedPlan.plan,
    nodes: nextNodes,
  };

  await saveTaskPlanGraph({
    workspaceId: savedPlan.workspaceId,
    taskId: parentTask.id,
    plan: updatedPlan,
    prompt: savedPlan.prompt,
    status: savedPlan.status,
    source: savedPlan.source,
    generatedBy: savedPlan.generatedBy,
    summary: savedPlan.summary,
    changeSummary: savedPlan.changeSummary,
  });

  return {
    taskId: parentTask.id,
    createdTaskIds,
    updatedNodeIds,
  };
}
