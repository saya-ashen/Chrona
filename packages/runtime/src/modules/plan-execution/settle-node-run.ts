import type {
  PlanExecutionResult,
} from "./orchestrator";
import { advancePlanExecution } from "./orchestrator";
import { getAcceptedTaskPlanGraph, saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import { appendMainSessionEvent, ensurePlanMainSession } from "./plan-state-store";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { db } from "@/lib/db";
import { TaskStatus, Prisma } from "@/generated/prisma/client";
import type { TaskPlanGraph } from "@chrona/contracts/ai";

export async function settlePlanNodeFromRun(input: {
  taskId: string;
  runId: string;
  reason?: string;
}): Promise<PlanExecutionResult> {
  const acceptedPlan = await getAcceptedTaskPlanGraph(input.taskId);
  if (!acceptedPlan) {
    return {
      taskId: input.taskId,
      planId: null,
      mainSessionId: null,
      status: "no_plan",
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "No accepted plan to settle against.",
    };
  }

  const planId = acceptedPlan.id;
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId,
  });

  const currentPlan = acceptedPlan.plan;

  const nodeIndex = currentPlan.nodes.findIndex((n) => {
    const meta = (n.metadata as Record<string, unknown> | null) ?? {};
    return meta.childRunId === input.runId;
  });

  if (nodeIndex === -1) {
    return advancePlanExecution({
      taskId: input.taskId,
      trigger: "system",
    });
  }

  const node = currentPlan.nodes[nodeIndex]!;
  const nodeMeta = ((node.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;

  const run = await db.run.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      status: true,
      errorSummary: true,
      pendingInputPrompt: true,
    },
  });

  if (!run) {
    return {
      taskId: input.taskId,
      planId,
      mainSessionId: mainSession.id,
      status: "blocked",
      currentNodeId: node.id,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [node.id],
      message: `Run ${input.runId} not found for node ${node.id}`,
    };
  }

  const runArtifacts = await db.artifact.findMany({
    where: { runId: input.runId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, type: true },
  });

  const runStatusStr = run.status as string;
  let newNodeStatus: string;
  let completionSummary: string | null = null;
  let eventType:
    | "node_completed"
    | "node_waiting_for_user"
    | "node_waiting_for_approval"
    | "node_blocked";
  let eventPayload: Record<string, unknown>;

  const settledMeta: Record<string, unknown> = {
    ...nodeMeta,
    childRunId: input.runId,
    settledAt: new Date().toISOString(),
    settledFrom: runStatusStr,
  };

  if (runStatusStr === "Completed" || runStatusStr === "Succeeded") {
    newNodeStatus = "done";
    completionSummary = run.errorSummary ?? `Child run ${input.runId} completed`;
    eventType = "node_completed";
    eventPayload = {
      nodeId: node.id,
      runId: input.runId,
      summary: completionSummary,
      artifactIds: runArtifacts.map((a) => a.id),
    };
    settledMeta.evidence = run.errorSummary;
  } else if (runStatusStr === "WaitingForInput") {
    newNodeStatus = "waiting_for_user";
    eventType = "node_waiting_for_user";
    eventPayload = {
      nodeId: node.id,
      runId: input.runId,
      prompt: run.pendingInputPrompt,
    };
    settledMeta.pendingInputPrompt = run.pendingInputPrompt;
  } else if (runStatusStr === "WaitingForApproval") {
    newNodeStatus = "waiting_for_approval";
    eventType = "node_waiting_for_approval";
    eventPayload = { nodeId: node.id, runId: input.runId };
  } else {
    newNodeStatus = "blocked";
    eventType = "node_blocked";
    eventPayload = {
      nodeId: node.id,
      runId: input.runId,
      reason: run.errorSummary ?? `Child run ${input.runId} failed`,
    };
    settledMeta.errorSummary = run.errorSummary;
  }

  const updatedPlan: TaskPlanGraph = {
    ...currentPlan,
    nodes: currentPlan.nodes.map((n, i) => {
      if (i !== nodeIndex) return n;
      return {
        ...n,
        status: newNodeStatus as TaskPlanGraph["nodes"][number]["status"],
        completionSummary: completionSummary ?? n.completionSummary,
        metadata: settledMeta,
      };
    }),
  };

  await saveTaskPlanGraph({
    workspaceId: acceptedPlan.workspaceId,
    taskId: input.taskId,
    plan: updatedPlan,
    status: acceptedPlan.status,
    source: acceptedPlan.source,
    generatedBy: acceptedPlan.generatedBy,
    summary: acceptedPlan.summary,
    changeSummary: acceptedPlan.changeSummary,
  });

  await appendMainSessionEvent({
    taskId: input.taskId,
    planId,
    sessionId: mainSession.id,
    eventType,
    payload: eventPayload,
  });

  const newTaskStatus = (() => {
    switch (eventType) {
      case "node_completed":
        return TaskStatus.Running;
      case "node_waiting_for_user":
        return TaskStatus.WaitingForInput;
      case "node_waiting_for_approval":
        return TaskStatus.WaitingForApproval;
      case "node_blocked":
        return TaskStatus.Blocked;
    }
  })();

  const blockReason = (() => {
    if (eventType === "node_waiting_for_user") {
      return {
        blockType: "human_input_required",
        scope: "plan_node",
        actionRequired: eventPayload.prompt ?? "User input required",
        nodeId: node.id,
      };
    }
    if (eventType === "node_waiting_for_approval") {
      return {
        blockType: "approval_required",
        scope: "plan_node",
        actionRequired: "Child run approval required",
        nodeId: node.id,
      };
    }
    if (eventType === "node_blocked") {
      return {
        blockType: "node_blocked",
        scope: "plan_node",
        actionRequired: eventPayload.reason ?? "Node blocked by child run failure",
        nodeId: node.id,
      };
    }
    return undefined;
  })();

  await db.task.update({
    where: { id: input.taskId },
    data: {
      status: newTaskStatus,
      ...(blockReason ? { blockReason } : { blockReason: Prisma.DbNull }),
    } as Parameters<typeof db.task.update>[0]["data"],
  });

  await rebuildTaskProjection(input.taskId);

  if (newNodeStatus === "done") {
    return advancePlanExecution({
      taskId: input.taskId,
      trigger: "system",
    });
  }

  return {
    taskId: input.taskId,
    planId,
    mainSessionId: mainSession.id,
    status: newNodeStatus as PlanExecutionResult["status"],
    currentNodeId: node.id,
    executedNodeIds: [],
    waitingNodeIds: eventType === "node_waiting_for_user" ? [node.id] : [],
    blockedNodeIds: eventType === "node_blocked" ? [node.id] : [],
    message: `Node ${node.id} settled from child run ${input.runId} with status ${newNodeStatus}`,
  };
}
