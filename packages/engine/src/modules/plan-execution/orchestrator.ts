import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getAcceptedTaskPlanGraph, saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ensurePlanMainSession, appendMainSessionEvent } from "./plan-state-store";
import { computeExecutablePath } from "./executable-path";
import { decideNodeExecutionSession } from "./session-policy";
import { executePlanNode } from "./node-executor";
import { detectPlanDrift } from "./replan-detector";
import { applyPlanPatch } from "./apply-plan-patch";
import { savePlanRun, getPlanRun } from "./plan-run-store";
import {
  createPlanRunFromGraph,
  syncGraphStateToRun,
} from "./plan-run-bridge";
import { upgradeBlueprintToEditable } from "@chrona/contracts/ai";
import { compileEditablePlan } from "@chrona/domain";
import type { TaskPlanNode, TaskPlanGraph, PlanRun, CompiledPlan } from "@chrona/contracts/ai";
import type { PlanExecutablePath } from "./executable-path";

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

function mapTerminalReasonToStatus(
  reason: PlanExecutablePath["terminalReason"],
): PlanExecutionStatus {
  switch (reason) {
    case "has_ready_nodes":
      return "running";
    case "waiting_for_child":
      return "running";
    case "waiting_for_dependencies":
      return "blocked";
    case "waiting_for_user":
      return "waiting_for_user";
    case "waiting_for_approval":
      return "waiting_for_approval";
    case "blocked":
      return "blocked";
    case "all_done":
      return "completed";
    case "empty_plan":
      return "no_plan";
  }
}

function updateNodeStatus(
  plan: TaskPlanGraph,
  nodeId: string,
  updates: Partial<TaskPlanNode>,
): TaskPlanGraph {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      return { ...node, ...updates };
    }),
  };
}

function pickNextNodeId(path: PlanExecutablePath): string | null {
  return path.readyNodeIds.length > 0 ? path.readyNodeIds[0] : null;
}

export async function advancePlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  maxSteps?: number;
}): Promise<PlanExecutionResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, title: true, workspaceId: true, status: true },
  });

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
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const planId = acceptedPlan.id;

  // Load or create PlanRun for layered tracking
  let planRun = await getPlanRun(input.taskId, planId);
  let compiled: CompiledPlan | null = null;
  if (!planRun) {
    const result = createPlanRunFromGraph(acceptedPlan.plan);
    if (result) {
      planRun = result.run;
      compiled = result.compiled;
    }
  } else if (acceptedPlan.plan.blueprint) {
    const editable = upgradeBlueprintToEditable(acceptedPlan.plan.blueprint, planId);
    compiled = compileEditablePlan(editable);
  }

  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId,
  });

  const executedNodeIds: string[] = [];
  let currentPlan = acceptedPlan.plan;

  for (let step = 0; step < maxSteps; step++) {
    const path = computeExecutablePath(currentPlan);

    await appendMainSessionEvent({
      taskId: input.taskId,
      planId,
      sessionId: mainSession.id,
      eventType: "executable_path_computed",
      payload: {
        terminalReason: path.terminalReason,
        readyCount: path.readyNodeIds.length,
        waitingForChildCount: path.waitingForChildNodeIds.length,
        waitingForDependencyCount: path.waitingForDependencyNodeIds.length,
        waitingForUserCount: path.waitingForUserNodeIds.length,
        waitingForApprovalCount: path.waitingForApprovalNodeIds.length,
        blockedCount: path.blockedNodeIds.length,
        doneCount: path.doneNodeIds.length,
        inProgressCount: path.inProgressNodeIds.length,
      },
    });

    if (path.terminalReason !== "has_ready_nodes" && path.terminalReason !== "waiting_for_child") {
      const execStatus = mapTerminalReasonToStatus(path.terminalReason);
      const taskStatus = (() => {
        switch (execStatus) {
          case "completed":
            return TaskStatus.Completed;
          case "waiting_for_user":
            return TaskStatus.WaitingForInput;
          case "waiting_for_approval":
            return TaskStatus.WaitingForApproval;
          case "blocked":
          case "no_plan":
            return TaskStatus.Blocked;
          default:
            return TaskStatus.Running;
        }
      })();

      await db.task.update({
        where: { id: input.taskId },
        data: {
          status: taskStatus,
          completedAt: ["Completed", "Done"].includes(taskStatus)
            ? new Date()
            : undefined,
          blockReason:
            execStatus === "blocked" || execStatus === "no_plan"
              ? {
                  blockType: execStatus === "no_plan" ? "no_plan" : "node_blocked",
                  scope: "plan_execution",
                  actionRequired:
                    execStatus === "no_plan"
                      ? "Create or accept a plan"
                      : "Review blocked nodes",
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
        currentNodeId: path.currentNodeId,
        executedNodeIds,
        waitingNodeIds: path.waitingForUserNodeIds,
        blockedNodeIds: path.blockedNodeIds,
        message: `Execution ${execStatus}: ${path.terminalReason}`,
      };
    }

    const nextNodeId = pickNextNodeId(path);
    if (!nextNodeId) break;

    const node = currentPlan.nodes.find((n) => n.id === nextNodeId);
    if (!node) {
      return {
        taskId: input.taskId,
        planId,
        mainSessionId: mainSession.id,
        status: "blocked",
        currentNodeId: null,
        executedNodeIds,
        waitingNodeIds: [],
        blockedNodeIds: [],
        message: `Node ${nextNodeId} not found in plan`,
      };
    }

    const sessionDecision = decideNodeExecutionSession({
      node,
      plan: currentPlan,
      parentTaskId: input.taskId,
    });

    currentPlan = updateNodeStatus(currentPlan, nextNodeId, {
      status: "in_progress",
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
        nodeTitle: node.title,
        nodeType: node.type,
      },
    });

    const executingNode = {
      ...node,
      status: "in_progress" as const,
    };

    const result = await executePlanNode({
      taskId: input.taskId,
      planId,
      mainSession,
      node: executingNode,
      plan: currentPlan,
      sessionDecision,
      trigger: input.trigger,
    });

    const drift = detectPlanDrift({
      node: executingNode,
      nodeResult: result,
      plan: currentPlan,
      mainSessionSummary: null,
    });

    if (drift.needsReplan) {
      if (drift.requiresUserConfirmation || drift.risk !== "low") {
        currentPlan = updateNodeStatus(currentPlan, nextNodeId, {
          status: "blocked",
          metadata: {
            ...((node.metadata as Record<string, unknown>) ?? {}),
            replan: {
              risk: drift.risk,
              reason: drift.reason,
              proposedPatch: drift.proposedPatch,
            },
          },
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
              blockType: "replan_required",
              scope: "plan",
              actionRequired: drift.reason,
              nodeId: nextNodeId,
            },
          },
        });

        await savePlanState(currentPlan, acceptedPlan, planRun && compiled ? { run: planRun, compiled, planId } : null);
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

      const patchResult = await applyPlanPatch({
        taskId: input.taskId,
        patch: drift.proposedPatch,
        currentPlan: {
          saved: {
            ...acceptedPlan,
            plan: currentPlan,
          },
          graph: currentPlan,
        },
      });

      if (patchResult.success) {
        const refreshed = await getAcceptedTaskPlanGraph(input.taskId);
        if (refreshed) {
          currentPlan = refreshed.plan;
          await appendMainSessionEvent({
            taskId: input.taskId,
            planId,
            sessionId: mainSession.id,
            eventType: "replan_proposed",
            payload: {
              nodeId: nextNodeId,
              reason: drift.reason,
              risk: drift.risk,
              autoApplied: true,
            },
          });
          continue;
        }
      }
    }

    executedNodeIds.push(nextNodeId);

    switch (result.status) {
      case "done": {
        currentPlan = updateNodeStatus(currentPlan, nextNodeId, {
          status: "done",
          completionSummary: result.summary,
        });

        await appendMainSessionEvent({
          taskId: input.taskId,
          planId,
          sessionId: mainSession.id,
          eventType: "node_completed",
          payload: {
            nodeId: nextNodeId,
            summary: result.summary,
          },
        });
        break;
      }

      case "waiting_for_user": {
        currentPlan = updateNodeStatus(currentPlan, nextNodeId, {
          status: "waiting_for_user",
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.WaitingForInput,
            blockReason: {
              blockType: "human_input_required",
              scope: "plan_node",
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

        await savePlanState(currentPlan, acceptedPlan, planRun && compiled ? { run: planRun, compiled, planId } : null);
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
        currentPlan = updateNodeStatus(currentPlan, nextNodeId, {
          status: "waiting_for_approval",
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.WaitingForApproval,
            blockReason: {
              blockType: "approval_required",
              scope: "plan_node",
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

        await savePlanState(currentPlan, acceptedPlan, planRun && compiled ? { run: planRun, compiled, planId } : null);
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
        currentPlan = updateNodeStatus(currentPlan, nextNodeId, {
          status: "waiting_for_child",
          metadata: {
            ...((node.metadata as Record<string, unknown>) ?? {}),
            childSessionId: result.evidence.childSessionId,
            childRunId: result.evidence.runId,
            childTaskId: result.evidence.childTaskId,
            dispatchedAt: new Date().toISOString(),
          },
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

        await savePlanState(currentPlan, acceptedPlan, planRun && compiled ? { run: planRun, compiled, planId } : null);
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

        currentPlan = updateNodeStatus(currentPlan, nextNodeId, {
          status: "blocked",
          completionSummary: null,
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.Blocked,
            blockReason: {
              blockType: "node_blocked",
              scope: "plan_node",
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

        await savePlanState(currentPlan, acceptedPlan, planRun && compiled ? { run: planRun, compiled, planId } : null);
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
          payload: {
            nodeId: nextNodeId,
            reason: result.reason,
          },
        });

        await db.task.update({
          where: { id: input.taskId },
          data: {
            status: TaskStatus.WaitingForApproval,
            blockReason: {
              blockType: "replan_required",
              scope: "plan",
              actionRequired: result.reason,
              nodeId: nextNodeId,
            },
          },
        });

        await savePlanState(currentPlan, acceptedPlan, planRun && compiled ? { run: planRun, compiled, planId } : null);
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

    await savePlanState(currentPlan, acceptedPlan, planRun && compiled ? { run: planRun, compiled, planId } : null);
    await rebuildTaskProjection(input.taskId);
  }

  await savePlanState(currentPlan, acceptedPlan, planRun && compiled ? { run: planRun, compiled, planId } : null);
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
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: acceptedPlan.id,
  });

  await activateWorkBlock(input.taskId);

  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: acceptedPlan.id,
    sessionId: mainSession.id,
    eventType: "execution_started",
    payload: {
      trigger: input.trigger,
      prompt: input.prompt,
      planRevision: acceptedPlan.revision,
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
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: acceptedPlan.id,
  });

  const planRun = await getPlanRun(input.taskId, acceptedPlan.id);
  let compiled: CompiledPlan | null = null;
  if (planRun && acceptedPlan.plan.blueprint) {
    const editable = upgradeBlueprintToEditable(acceptedPlan.plan.blueprint, acceptedPlan.id);
    compiled = compileEditablePlan(editable);
  }

  if (input.userInput) {
    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: acceptedPlan.id,
      sessionId: mainSession.id,
      eventType: "user_input_received",
      payload: {
        input: input.userInput,
        reason: input.reason,
      },
    });

    const path = computeExecutablePath(acceptedPlan.plan);
    if (path.waitingForUserNodeIds.length > 0) {
      const waitingNodeId = path.waitingForUserNodeIds[0];
      const updatedPlan = {
        ...acceptedPlan.plan,
        nodes: acceptedPlan.plan.nodes.map((node) => {
          if (node.id !== waitingNodeId) return node;
          return {
            ...node,
            status: "pending" as const,
            completionSummary: input.userInput ?? node.completionSummary,
            metadata: {
              ...((node.metadata as Record<string, unknown>) ?? {}),
              userProvidedInput: input.userInput,
            },
          };
        }),
      };

      await saveTaskPlanGraph({
        workspaceId: task.workspaceId,
        taskId: input.taskId,
        plan: updatedPlan,
        status: acceptedPlan.status,
        source: acceptedPlan.source,
        generatedBy: acceptedPlan.generatedBy,
        summary: acceptedPlan.summary,
        changeSummary: acceptedPlan.changeSummary,
      });

      if (planRun && compiled) {
        syncGraphStateToRun(updatedPlan, compiled, planRun);
        await savePlanRun({
          workspaceId: task.workspaceId,
          taskId: input.taskId,
          planId: acceptedPlan.id,
          run: planRun,
        });
      }

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

async function savePlanState(
  currentPlan: TaskPlanGraph,
  savedPlan: { workspaceId: string; status: string; source: "ai" | "user" | "mixed"; generatedBy: string | null; summary: string | null; changeSummary: string | null },
  planRunContext?: { run: PlanRun; compiled: CompiledPlan; planId: string } | null,
) {
  await saveTaskPlanGraph({
    workspaceId: savedPlan.workspaceId,
    taskId: currentPlan.taskId,
    plan: currentPlan,
    status: savedPlan.status as "accepted" | "draft" | "superseded" | "archived",
    source: savedPlan.source,
    generatedBy: savedPlan.generatedBy,
    summary: savedPlan.summary,
    changeSummary: savedPlan.changeSummary,
  });

  if (planRunContext) {
    syncGraphStateToRun(currentPlan, planRunContext.compiled, planRunContext.run);
    await savePlanRun({
      workspaceId: savedPlan.workspaceId,
      taskId: currentPlan.taskId,
      planId: planRunContext.planId,
      run: planRunContext.run,
    });
  }
}
