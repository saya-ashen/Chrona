import type {
  PlanExecutionResult,
} from "./orchestrator";
import { advancePlanExecution } from "./orchestrator";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import { appendLayer, getLayers } from "./plan-run-store";
import { appendMainSessionEvent, ensurePlanMainSession } from "./plan-state-store";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { db } from "@/lib/db";
import { TaskStatus, Prisma } from "@/generated/prisma/client";
import type { RuntimeLayer } from "@chrona/contracts/ai";

export async function settlePlanNodeFromRun(input: {
  taskId: string;
  runId: string;
  reason?: string;
}): Promise<PlanExecutionResult> {
  const savedCompiled = await getAcceptedCompiledPlan(input.taskId);
  if (!savedCompiled) {
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

  const compiledPlan = savedCompiled.compiledPlan;
  const planId = savedCompiled.compiledPlan.editablePlanId;
  const workspaceId = savedCompiled.workspaceId;
  let layers = await getLayers(input.taskId, planId);

  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId,
  });

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
    return advancePlanExecution({
      taskId: input.taskId,
      trigger: "system",
    });
  }

  const runArtifacts = await db.artifact.findMany({
    where: { runId: input.runId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, type: true },
  });

  const effective = resolveEffectivePlanGraph(compiledPlan, layers);

  // Find the node that corresponds to this child run
  const nodeToSettle = effective.nodes.find((n) => {
    const config = n.config as Record<string, unknown>;
    return config.childRunId === input.runId;
  });

  if (!nodeToSettle) {
    return advancePlanExecution({
      taskId: input.taskId,
      trigger: "system",
    });
  }

  const runStatusStr = run.status as string;
  let newNodeStatus: "completed" | "blocked" | "running";
  let eventType: "node_completed" | "node_waiting_for_user" | "node_waiting_for_approval" | "node_blocked";
  let eventPayload: Record<string, unknown>;
  let completionSummary: string | null = null;

  if (runStatusStr === "Completed" || runStatusStr === "Succeeded") {
    newNodeStatus = "completed";
    completionSummary = run.errorSummary ?? `Child run ${input.runId} completed`;
    eventType = "node_completed";
    eventPayload = {
      nodeId: nodeToSettle.id,
      runId: input.runId,
      summary: completionSummary,
      artifactIds: runArtifacts.map((a) => a.id),
    };
  } else if (runStatusStr === "WaitingForInput") {
    newNodeStatus = "blocked";
    eventType = "node_waiting_for_user";
    eventPayload = {
      nodeId: nodeToSettle.id,
      runId: input.runId,
      prompt: run.pendingInputPrompt,
    };
  } else if (runStatusStr === "WaitingForApproval") {
    newNodeStatus = "blocked";
    eventType = "node_waiting_for_approval";
    eventPayload = { nodeId: nodeToSettle.id, runId: input.runId };
  } else {
    newNodeStatus = "blocked";
    eventType = "node_blocked";
    eventPayload = {
      nodeId: nodeToSettle.id,
      runId: input.runId,
      reason: run.errorSummary ?? `Child run ${input.runId} failed`,
    };
  }

  // Append RuntimeLayer with the settled status
  const settleLayer: RuntimeLayer = {
    type: "runtime",
    planId: planId,
    timestamp: new Date().toISOString(),
    layerId: `settle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: layers.length + 1,
    active: true,
    source: "system",
    nodeStates: {
      [nodeToSettle.id]: {
        status: newNodeStatus,
        ...(completionSummary ? { lastError: undefined } : {}),
      },
    },
  };

  layers = await appendLayer({
    workspaceId,
    taskId: input.taskId,
    planId,
    layer: settleLayer,
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
        blockType: "human_input_required" as const,
        scope: "plan_node" as const,
        actionRequired: eventPayload.prompt ?? "User input required",
        nodeId: nodeToSettle.id,
      };
    }
    if (eventType === "node_waiting_for_approval") {
      return {
        blockType: "approval_required" as const,
        scope: "plan_node" as const,
        actionRequired: "Child run approval required",
        nodeId: nodeToSettle.id,
      };
    }
    if (eventType === "node_blocked") {
      return {
        blockType: "node_blocked" as const,
        scope: "plan_node" as const,
        actionRequired: eventPayload.reason ?? "Node blocked by child run failure",
        nodeId: nodeToSettle.id,
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

  if (newNodeStatus === "completed") {
    return advancePlanExecution({
      taskId: input.taskId,
      trigger: "system",
    });
  }

  return {
    taskId: input.taskId,
    planId,
    mainSessionId: mainSession.id,
    status: newNodeStatus === "blocked" ? "blocked" : "running",
    currentNodeId: nodeToSettle.id,
    executedNodeIds: [],
    waitingNodeIds: eventType === "node_waiting_for_user" ? [nodeToSettle.id] : [],
    blockedNodeIds: eventType === "node_blocked" ? [nodeToSettle.id] : [],
    message: `Node ${nodeToSettle.id} settled from child run ${input.runId} with status ${newNodeStatus}`,
  };
}
