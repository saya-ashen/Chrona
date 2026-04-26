import { db } from "@/lib/db";
import { syncTaskRunForRead } from "@/modules/runtime-sync/freshness";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";
import { isTaskPlanGenerationRunning } from "@/modules/commands/task-plan-generation-registry";
import { getAcceptedTaskPlanGraph, getLatestTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

type TaskPlanGenerationStatus = "idle" | "generating" | "waiting_acceptance" | "accepted";

function readBlockReason(
  task: {
    blockReason: unknown;
    projection:
      | {
          blockType: string | null;
          actionRequired: string | null;
          blockScope: string | null;
          blockSince: Date | null;
        }
      | null;
  },
) {
  return (
    (task.blockReason as {
      blockType?: string;
      actionRequired?: string;
      scope?: string;
      since?: string;
    } | null) ??
    (task.projection
      ? {
          blockType: task.projection.blockType ?? undefined,
          actionRequired: task.projection.actionRequired ?? undefined,
          scope: task.projection.blockScope ?? undefined,
          since: task.projection.blockSince?.toISOString(),
        }
      : null)
  );
}

export async function getTaskPage(taskId: string) {
  await syncTaskRunForRead(taskId);

  const savedAiPlan = (await getAcceptedTaskPlanGraph(taskId)) ?? (await getLatestTaskPlanGraph(taskId));
  const aiPlanGenerationStatus: TaskPlanGenerationStatus = isTaskPlanGenerationRunning(taskId)
    ? "generating"
    : savedAiPlan?.status === "accepted"
      ? "accepted"
      : savedAiPlan
        ? "waiting_acceptance"
        : "idle";

  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      projection: true,
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      approvals: { orderBy: { requestedAt: "desc" }, take: 5 },
      artifacts: { orderBy: { createdAt: "desc" }, take: 5 },
      scheduleProposals: {
        where: { status: "Pending" },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      workspace: {
        select: { defaultRuntime: true },
      },
      dependencies: {
        include: {
          dependsOnTask: {
            select: { id: true, title: true, status: true },
          },
        },
      },
    },
  });

  const latestRun = task.runs[0] ?? null;
  const runnability = deriveTaskRunnability({
    runtimeAdapterKey: task.runtimeAdapterKey,
    workspaceDefaultRuntime: task.workspace.defaultRuntime,
    runtimeInput: task.runtimeInput,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
  });

  return {
    task: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      description: task.description,
      runtimeAdapterKey: task.runtimeAdapterKey,
      runtimeInput: task.runtimeInput,
      runtimeInputVersion: task.runtimeInputVersion,
      runtimeModel: task.runtimeModel,
      prompt: task.prompt,
      runtimeConfig: task.runtimeConfig,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      scheduledStartAt: task.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: task.scheduledEndAt?.toISOString() ?? null,
      scheduleStatus: task.scheduleStatus,
      scheduleSource: task.scheduleSource,
      isRunnable: runnability.isRunnable,
      runnabilitySummary: runnability.summary,
      runnabilityState: runnability.state,
      ownerType: task.ownerType,
      savedAiPlan: savedAiPlan
        ? {
            id: savedAiPlan.id,
            status: savedAiPlan.status,
            prompt: savedAiPlan.prompt,
            revision: savedAiPlan.revision,
            summary: savedAiPlan.summary,
            updatedAt: savedAiPlan.updatedAt,
            plan: savedAiPlan.plan,
          }
        : null,
      aiPlanGenerationStatus,
      blockReason: readBlockReason(task),
      dependencies: task.dependencies.map((dependency) => ({
        id: dependency.id,
        dependencyType: dependency.dependencyType,
        dependsOnTask: dependency.dependsOnTask,
      })),
    },
    latestRunSummary: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt?.toISOString() ?? null,
          syncStatus: latestRun.syncStatus,
        }
      : null,
    scheduleProposals: task.scheduleProposals.map((proposal) => ({
      id: proposal.id,
      source: proposal.source,
      proposedBy: proposal.proposedBy,
      summary: proposal.summary,
      status: proposal.status,
      dueAt: proposal.dueAt?.toISOString() ?? null,
      scheduledStartAt: proposal.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: proposal.scheduledEndAt?.toISOString() ?? null,
    })),
    approvals: task.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
      riskLevel: approval.riskLevel,
      requestedAt: approval.requestedAt.toISOString(),
    })),
    artifacts: task.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
    })),
  };
}
