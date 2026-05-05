import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ensurePlanMainSession, appendMainSessionEvent } from "./plan-state-store";
import { decideNodeExecutionSession } from "./session-policy";
import { executePlanNode } from "./node-executor";
import { detectPlanDrift } from "./replan-detector";
import { applyPlanPatch } from "./apply-plan-patch";
import {
  savePlanRun,
  getPlanRun,
  appendLayer,
  getLayers,
} from "./plan-run-store";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import {
  createPlanRunFromCompiledPlan,
  applyCommandAndProduceLayer,
} from "./plan-run-bridge";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import type {
  PlanRun,
  CompiledPlan,
  EffectivePlanGraph,
  EffectivePlanNode,
  PlanOverlayLayer,
  RuntimeLayer,
} from "@chrona/contracts/ai";

async function activateWorkBlock(taskId: string) {
  await db.workBlock.updateMany({
    where: { taskId, status: "Scheduled" },
    data: { status: "Active", startedAt: new Date() },
  });
}

async function completeWorkBlock(taskId: string) {
  await db.workBlock.updateMany({
    where: { taskId, status: "Active" },
    data: { status: "Completed", completedAt: new Date() },
  });
}

export type PlanExecutionStatus =
  | "started"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "completed"
  | "no_plan";

export type PlanExecutionResult = {
  taskId: string;
  planId: string | null;
  mainSessionId: string | null;
  status: PlanExecutionStatus;
  currentNodeId: string | null;
  executedNodeIds: string[];
  waitingNodeIds: string[];
  blockedNodeIds: string[];
  message: string;
};

type OrchestratorTrigger = "manual" | "scheduler" | "system" | "auto";

const DEFAULT_MAX_STEPS = 10;

function mapTerminalReasonToStatus(effective: EffectivePlanGraph): PlanExecutionStatus {
  if (effective.readyNodeIds.length > 0) return "running";
  if (effective.runningNodeIds.length > 0) return "running";
  if (effective.blockedNodeIds.length > 0) return "blocked";
  if (effective.failedNodeIds.length > 0) return "blocked";
  if (effective.pendingNodeIds.length > 0) return "blocked";
  if (effective.completedNodeIds.length === effective.nodes.length) return "completed";
  return "blocked";
}

function pickNextNodeId(effective: EffectivePlanGraph): string | null {
  return effective.readyNodeIds.length > 0 ? effective.readyNodeIds[0] : null;
}

async function getRuntimeName(taskId: string): Promise<string> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { runtimeAdapterKey: true },
  });
  return task.runtimeAdapterKey ?? "openclaw";
}

export async function advancePlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  maxSteps?: number;
}): Promise<PlanExecutionResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;

  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, title: true, workspaceId: true, status: true },
  });

  // Load compiled plan
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
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const { compiledPlan, planId, workspaceId } = savedCompiled;
  let layers = await getLayers(input.taskId, planId);

  // Load or create PlanRun
  const planRunData = await getPlanRun(input.taskId, planId);
  let planRun: PlanRun;

  if (!planRunData) {
    planRun = createPlanRunFromCompiledPlan(compiledPlan, layers);
    await savePlanRun({
      workspaceId,
      taskId: input.taskId,
      planId,
      run: planRun,
      layers,
    });
  } else {
    planRun = planRunData.planRun;
  }

  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId,
  });

  const runtimeName = await getRuntimeName(input.taskId);
  const executedNodeIds: string[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const effective = resolveEffectivePlanGraph(compiledPlan, layers);

    await appendMainSessionEvent({
      taskId: input.taskId,
      planId,
      sessionId: mainSession.id,
      eventType: "executable_path_computed",
      payload: {
        readyCount: effective.readyNodeIds.length,
        blockedCount: effective.blockedNodeIds.length,
        completedCount: effective.completedNodeIds.length,
        runningCount: effective.runningNodeIds.length,
        failedCount: effective.failedNodeIds.length,
        pendingCount: effective.pendingNodeIds.length,
      },
    });

    // Check terminal conditions
    if (
      effective.readyNodeIds.length === 0 &&
      effective.runningNodeIds.length === 0
    ) {
      const execStatus = mapTerminalReasonToStatus(effective);

      await db.task.update({
        where: { id: input.taskId },
        data: {
          status:
            execStatus === "completed"
              ? TaskStatus.Completed
              : execStatus === "blocked"
                ? TaskStatus.Blocked
                : TaskStatus.Running,
          completedAt: execStatus === "completed" ? new Date() : undefined,
          blockReason:
            execStatus === "blocked"
              ? {
                  blockType: "node_blocked" as const,
                  scope: "plan_execution" as const,
                  actionRequired: "Review blocked nodes",
                }
              : Prisma.DbNull,
        },
      });

      await rebuildTaskProjection(input.taskId);

      if (execStatus === "completed") {
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "execution_completed",
          payload: { totalSteps: executedNodeIds.length },
        });
        await completeWorkBlock(input.taskId);
      }

      return {
        taskId: input.taskId,
        planId,
        mainSessionId: mainSession.id,
        status: execStatus,
        currentNodeId: null,
        executedNodeIds,
        waitingNodeIds: [],
        blockedNodeIds: effective.blockedNodeIds,
        message: `Execution ${execStatus}: no ready nodes`,
      };
    }

    const nextNodeId = pickNextNodeId(effective);
    if (!nextNodeId) break;

    const effectiveNode = effective.nodes.find((n) => n.id === nextNodeId);
    if (!effectiveNode) break;

    const sessionDecision = decideNodeExecutionSession({
      node: effectiveNode,
      plan: effective,
      parentTaskId: input.taskId,
    });

    // Mark node as running via a new RuntimeLayer
    const startingLayer: RuntimeLayer = {
      type: "runtime",
      planId,
      timestamp: new Date().toISOString(),
      layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      version: layers.length + 1,
      active: true,
      source: "system",
      nodeStates: {
        [nextNodeId]: { status: "running" },
      },
    };
    layers = await appendLayer({
      workspaceId,
      taskId: input.taskId,
      planId,
      layer: startingLayer,
    });

    await db.task.update({
      where: { id: input.taskId },
      data: { status: TaskStatus.Running, blockReason: Prisma.DbNull },
    });

    await appendMainSessionEvent({
      taskId: input.taskId,
      planId,
      sessionId: mainSession.id,
      eventType: "node_started",
      payload: {
        nodeId: nextNodeId,
        nodeTitle: effectiveNode.title,
        nodeType: effectiveNode.type,
      },
    });

    const result = await executePlanNode({
      taskId: input.taskId,
      planId,
      mainSession,
      node: effectiveNode,
      plan: effective,
      sessionDecision,
      trigger: input.trigger,
      runtimeName,
    });

    // Replan detection
    const drift = detectPlanDrift({
      node: effectiveNode,
      nodeResult: result,
      plan: effective,
    });

    if (drift.needsReplan) {
      if (drift.requiresUserConfirmation || drift.risk !== "low") {
        const blockedLayer: RuntimeLayer = {
          type: "runtime",
          layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          version: layers.length + 1,
          active: true,
          planId,
          timestamp: new Date().toISOString(),
          source: "system",
          nodeStates: {
            [nextNodeId]: { status: "blocked", lastError: drift.reason },
          },
        };
        layers = await appendLayer({
          workspaceId,
          taskId: input.taskId,
          planId,
          layer: blockedLayer,
        });

        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "replan_proposed",
          payload: {
            nodeId: nextNodeId,
            reason: drift.reason,
            risk: drift.risk,
            proposedPatch: drift.proposedPatch,
          },
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.WaitingForApproval,
            blockReason: {
              blockType: "replan_required" as const,
              scope: "plan" as const,
              actionRequired: drift.reason,
              nodeId: nextNodeId,
            },
          },
        });

        await rebuildTaskProjection(input.taskId);

        return {
          taskId: input.taskId,
          planId,
          mainSessionId: mainSession.id,
          status: "waiting_for_approval",
          currentNodeId: nextNodeId,
          executedNodeIds,
          waitingNodeIds: [],
          blockedNodeIds: [nextNodeId],
          message: drift.reason,
        };
      }

      // Auto-apply low-risk replan
      if (drift.proposedPatch) {
        const patchResult = await applyPlanPatch({
          taskId: input.taskId,
          patch: drift.proposedPatch,
          compiledPlanId: compiledPlan.id,
          effectiveGraph: effective,
          source: "system" as const,
        });

        if (patchResult.newLayers.length > 0) {
          for (const newLayer of patchResult.newLayers) {
          layers = await appendLayer({
            workspaceId,
            taskId: input.taskId,
            planId,
            layer: newLayer,
          }          );
        }
        }

        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "replan_proposed",
          payload: {
            nodeId: nextNodeId,
            reason: drift.reason,
            autoApplied: true,
          },
        });
        continue;
      }
    }

    executedNodeIds.push(nextNodeId);

    switch (result.status) {
      case "done": {
        const doneLayer: RuntimeLayer = {
          type: "runtime",
          layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          version: layers.length + 1,
          active: true,
          planId,
          timestamp: new Date().toISOString(),
          source: "system",
          nodeStates: {
            [nextNodeId]: { status: "completed" },
          },
        };
        layers = await appendLayer({
          workspaceId,
          taskId: input.taskId,
          planId,
          layer: doneLayer,
        });

        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "node_completed",
          payload: { nodeId: nextNodeId, summary: result.summary },
        });
        break;
      }

      case "waiting_for_user": {
        const waitLayer: RuntimeLayer = {
          type: "runtime",
          layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          version: layers.length + 1,
          active: true,
          planId,
          timestamp: new Date().toISOString(),
          source: "system",
          nodeStates: {
            [nextNodeId]: { status: "blocked" },
          },
        };
        layers = await appendLayer({
          workspaceId,
          taskId: input.taskId,
          planId,
          layer: waitLayer,
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.WaitingForInput,
            blockReason: {
              blockType: "human_input_required" as const,
              scope: "plan_node" as const,
              actionRequired: result.prompt,
              nodeId: nextNodeId,
            },
          },
        });

        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "node_waiting_for_user",
          payload: { nodeId: nextNodeId, prompt: result.prompt },
        });

        await rebuildTaskProjection(input.taskId);

        return {
          taskId: input.taskId,
          planId,
          mainSessionId: mainSession.id,
          status: "waiting_for_user",
          currentNodeId: nextNodeId,
          executedNodeIds,
          waitingNodeIds: [nextNodeId],
          blockedNodeIds: [],
          message: result.prompt,
        };
      }

      case "waiting_for_approval": {
        const approvalLayer: RuntimeLayer = {
          type: "runtime",
          layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          version: layers.length + 1,
          active: true,
          planId,
          timestamp: new Date().toISOString(),
          source: "system",
          nodeStates: {
            [nextNodeId]: { status: "blocked" },
          },
        };
        layers = await appendLayer({
          workspaceId,
          taskId: input.taskId,
          planId,
          layer: approvalLayer,
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.WaitingForApproval,
            blockReason: {
              blockType: "approval_required" as const,
              scope: "plan_node" as const,
              actionRequired: result.prompt,
              nodeId: nextNodeId,
            },
          },
        });

        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "node_waiting_for_approval",
          payload: { nodeId: nextNodeId, prompt: result.prompt },
        });

        await rebuildTaskProjection(input.taskId);

        return {
          taskId: input.taskId,
          planId,
          mainSessionId: mainSession.id,
          status: "waiting_for_approval",
          currentNodeId: nextNodeId,
          executedNodeIds,
          waitingNodeIds: [],
          blockedNodeIds: [],
          message: result.prompt,
        };
      }

      case "child_running": {
        const childLayer: RuntimeLayer = {
          type: "runtime",
          layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          version: layers.length + 1,
          active: true,
          planId,
          timestamp: new Date().toISOString(),
          source: "system",
          nodeStates: {
            [nextNodeId]: { status: "running" },
          },
        };
        layers = await appendLayer({
          workspaceId,
          taskId: input.taskId,
          planId,
          layer: childLayer,
        });

        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "child_run_started",
          payload: {
            nodeId: nextNodeId,
            childSessionId: result.evidence.childSessionId,
            childRunId: result.evidence.runId,
            childTaskId: result.evidence.childTaskId,
          },
        });

        await rebuildTaskProjection(input.taskId);

        return {
          taskId: input.taskId,
          planId,
          mainSessionId: mainSession.id,
          status: "running",
          currentNodeId: nextNodeId,
          executedNodeIds,
          waitingNodeIds: [],
          blockedNodeIds: [],
          message: result.summary,
        };
      }

      case "blocked":
      case "failed": {
        const blockMessage = result.status === "blocked" ? result.reason : result.error;

        const blockedLayer: RuntimeLayer = {
          type: "runtime",
          layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          version: layers.length + 1,
          active: true,
          planId,
          timestamp: new Date().toISOString(),
          source: "system",
          nodeStates: {
            [nextNodeId]: { status: "blocked", lastError: blockMessage },
          },
        };
        layers = await appendLayer({
          workspaceId,
          taskId: input.taskId,
          planId,
          layer: blockedLayer,
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.Blocked,
            blockReason: {
              blockType: "node_blocked" as const,
              scope: "plan_node" as const,
              actionRequired: blockMessage,
              nodeId: nextNodeId,
            },
          },
        });

        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "node_blocked",
          payload: { nodeId: nextNodeId, reason: blockMessage },
        });

        await rebuildTaskProjection(input.taskId);

        return {
          taskId: input.taskId,
          planId,
          mainSessionId: mainSession.id,
          status: "blocked",
          currentNodeId: nextNodeId,
          executedNodeIds,
          waitingNodeIds: [],
          blockedNodeIds: [nextNodeId],
          message: blockMessage,
        };
      }

      case "replan_required": {
        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "replan_proposed",
          payload: { nodeId: nextNodeId, reason: result.reason },
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.WaitingForApproval,
            blockReason: {
              blockType: "replan_required" as const,
              scope: "plan" as const,
              actionRequired: result.reason,
              nodeId: nextNodeId,
            },
          },
        });

        await rebuildTaskProjection(input.taskId);

        return {
          taskId: input.taskId,
          planId,
          mainSessionId: mainSession.id,
          status: "waiting_for_approval",
          currentNodeId: nextNodeId,
          executedNodeIds,
          waitingNodeIds: [],
          blockedNodeIds: [],
          message: result.reason,
        };
      }
    }
  }

  await rebuildTaskProjection(input.taskId);

  return {
    taskId: input.taskId,
    planId,
    mainSessionId: mainSession.id,
    status: "running",
    currentNodeId: null,
    executedNodeIds,
    waitingNodeIds: [],
    blockedNodeIds: [],
    message: "Max steps reached. Call advancePlanExecution again to continue.",
  };
}

export async function startPlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  prompt?: string;
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
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: savedCompiled.planId,
  });

  await activateWorkBlock(input.taskId);

  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: savedCompiled.planId,
    sessionId: mainSession.id,
    eventType: "execution_started",
    payload: {
      trigger: input.trigger,
      prompt: input.prompt,
    },
  });

  return advancePlanExecution({
    taskId: input.taskId,
    trigger: input.trigger,
  });
}

export async function continuePlanExecution(input: {
  taskId: string;
  reason: string;
  userInput?: string;
}): Promise<PlanExecutionResult> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, title: true, workspaceId: true },
  });

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
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const { compiledPlan, planId, workspaceId } = savedCompiled;
  let layers = await getLayers(input.taskId, planId);

  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId,
  });

  if (input.userInput) {
    await appendMainSessionEvent({
      taskId: input.taskId,
      planId,
      sessionId: mainSession.id,
      eventType: "user_input_received",
      payload: { input: input.userInput, reason: input.reason },
    });

    // Find the waiting nodes and mark them ready via a RuntimeLayer
    const effective = resolveEffectivePlanGraph(compiledPlan, layers);
    const waitingNodes = effective.nodes.filter(
      (n) => n.status === "blocked" || n.status === "failed"
    );

    if (waitingNodes.length > 0) {
      const nodeStates: Record<string, { status: "ready" }> = {};
      for (const n of waitingNodes) {
        nodeStates[n.id] = { status: "ready" };
      }

      const resumeLayer: RuntimeLayer = {
        type: "runtime",
        planId,
        timestamp: new Date().toISOString(),
        layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        version: layers.length + 1,
        active: true,
        source: "system",
        nodeStates,
      };

      layers = await appendLayer({
        workspaceId,
        taskId: input.taskId,
        planId,
        layer: resumeLayer,
      });

      await db.task.update({
        where: { id: input.taskId },
        data: {
          status: TaskStatus.Ready,
          blockReason: Prisma.DbNull,
        },
      });

      await rebuildTaskProjection(input.taskId);
    }
  }

  return advancePlanExecution({
    taskId: input.taskId,
    trigger: "manual",
  });
}
