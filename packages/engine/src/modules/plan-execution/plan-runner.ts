import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ensurePlanMainSession, appendMainSessionEvent } from "./plan-state-store";
import { DEFAULT_RUNTIME_ADAPTER_KEY } from "@chrona/providers-core";
import { detectPlanDrift } from "./replan-detector";
import { applyPlanPatch } from "./apply-plan-patch";
import {
  savePlanRun,
  getPlanRun,
  appendLayer,
  getLayers,
} from "./plan-run-store";
import { getAcceptedCompiledPlan } from "./compiled-plan-store";
import { resolveEffectivePlanGraph, createPlanRun } from "@chrona/domain";
import type {
  PlanRun,
  CompiledPlan,
  EffectivePlanGraph,
  EffectivePlanNode,
  PlanOverlayLayer,
  RuntimeLayer,
} from "@chrona/contracts/ai";
import type { NodeExecutor, NodeExecutionResult } from "./node-executors/types";
import { TaskNodeExecutor } from "./node-executors/task-executor";
import { CheckpointNodeExecutor } from "./node-executors/checkpoint-executor";
import { ConditionNodeExecutor } from "./node-executors/condition-executor";
import { WaitNodeExecutor } from "./node-executors/wait-executor";

type PlanExecutionStatus =
  | "started"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "completed"
  | "no_plan";

type PlanExecutionResult = {
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
  return task.runtimeAdapterKey ?? DEFAULT_RUNTIME_ADAPTER_KEY;
}

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

type OrchestratorTrigger = "manual" | "scheduler" | "system" | "auto";

const executors: NodeExecutor[] = [
  new TaskNodeExecutor(),
  new CheckpointNodeExecutor(),
  new ConditionNodeExecutor(),
  new WaitNodeExecutor(),
];

function dispatchExecutor(node: EffectivePlanNode): NodeExecutor | null {
  return executors.find((e) => e.canExecute(node)) ?? null;
}

export function createPlanRunFromCompiledPlan(compiled: CompiledPlan, layers: PlanOverlayLayer[]): PlanRun {
  const run = createPlanRun(compiled);

  for (const layer of layers) {
    if (layer.type === "runtime" && layer.active) {
      for (const [nodeId, state] of Object.entries(layer.nodeStates)) {
        if (run.nodeStates[nodeId]) {
          run.nodeStates[nodeId].status = state.status;
        }
      }
    }
    if (layer.type === "result" && layer.active) {
      for (const [nodeId, result] of Object.entries(layer.nodeResults)) {
        if (result.artifactRefs && run.nodeStates[nodeId]) {
          for (const ref of result.artifactRefs) {
            run.artifactRefs.push({
              id: `${ref.artifactType}_${ref.artifactId}_${nodeId}`,
              planRunId: run.id,
              nodeId,
              artifactType: ref.artifactType,
              artifactId: ref.artifactId,
            });
          }
        }
        if (result.checkpointResponse && run.nodeStates[nodeId]) {
          run.checkpointResponses.push({
            id: `cr_${nodeId}_${Date.now()}`,
            planRunId: run.id,
            nodeId,
            response: result.checkpointResponse,
            submittedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  return run;
}

function makeRuntimeLayer(
  planId: string,
  nodeId: string,
  status: string,
  version: number,
  extra?: { lastError?: string },
): RuntimeLayer {
  return {
    type: "runtime",
    layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version,
    active: true,
    planId,
    timestamp: new Date().toISOString(),
    source: "system",
    nodeStates: {
      [nodeId]: {
        status: status as RuntimeLayer["nodeStates"][string]["status"],
        ...(extra ?? {}),
      },
    },
  };
}

async function handleNodeResult(params: {
  nextNodeId: string;
  result: NodeExecutionResult;
  effective: EffectivePlanGraph;
  compiledPlan: CompiledPlan;
  planId: string;
  workspaceId: string;
  taskId: string;
  mainSession: { id: string };
  layers: readonly PlanOverlayLayer[];
  executedNodeIds: string[];
}): Promise<{ layers: PlanOverlayLayer[]; decision: "continue" | "return"; returnValue?: PlanExecutionResult }> {
  const {
    nextNodeId, result, effective, compiledPlan,
    planId, workspaceId, taskId, mainSession,
    executedNodeIds,
  } = params;
  let layers = [...params.layers];

  // Replan detection
  const node = effective.nodes.find((n) => n.id === nextNodeId)!;
  const drift = detectPlanDrift({ node, nodeResult: result, plan: effective });

  if (drift.needsReplan) {
    if (drift.requiresUserConfirmation || drift.risk !== "low") {
      const blockedLayer = makeRuntimeLayer(planId, nextNodeId, "blocked", layers.length + 1, { lastError: drift.reason });
      layers = await appendLayer({ workspaceId, taskId, planId, layer: blockedLayer });

      await appendMainSessionEvent({
        taskId, planId, sessionId: mainSession.id,
        eventType: "replan_proposed",
        payload: { nodeId: nextNodeId, reason: drift.reason, risk: drift.risk, proposedPatch: drift.proposedPatch },
      });

      await db.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.WaitingForApproval,
          blockReason: { blockType: "replan_required" as const, scope: "plan" as const, actionRequired: drift.reason, nodeId: nextNodeId },
        },
      });

      await rebuildTaskProjection(taskId);

      return {
        layers,
        decision: "return",
        returnValue: {
          taskId, planId, mainSessionId: mainSession.id,
          status: "waiting_for_approval", currentNodeId: nextNodeId,
          executedNodeIds, waitingNodeIds: [], blockedNodeIds: [nextNodeId],
          message: drift.reason,
        },
      };
    }

    if (drift.proposedPatch) {
      const patchResult = await applyPlanPatch({
        taskId, patch: drift.proposedPatch,
        compiledPlanId: compiledPlan.id,
        effectiveGraph: effective,
        source: "system" as const,
      });

      for (const newLayer of patchResult.newLayers) {
        layers = await appendLayer({ workspaceId, taskId, planId, layer: newLayer });
      }

      await appendMainSessionEvent({
        taskId, planId, sessionId: mainSession.id,
        eventType: "replan_proposed",
        payload: { nodeId: nextNodeId, reason: drift.reason, autoApplied: true },
      });
    }

    return { layers, decision: "continue" };
  }

  executedNodeIds.push(nextNodeId);

  switch (result.status) {
    case "done": {
      const doneLayer = makeRuntimeLayer(planId, nextNodeId, "completed", layers.length + 1);
      layers = await appendLayer({ workspaceId, taskId, planId, layer: doneLayer });

      await appendMainSessionEvent({
        taskId, planId, sessionId: mainSession.id,
        eventType: "node_completed", payload: { nodeId: nextNodeId, summary: result.summary },
      });
      return { layers, decision: "continue" };
    }

    case "waiting_for_user": {
      const waitLayer = makeRuntimeLayer(planId, nextNodeId, "blocked", layers.length + 1);
      layers = await appendLayer({ workspaceId, taskId, planId, layer: waitLayer });

      await db.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.WaitingForInput,
          blockReason: { blockType: "human_input_required" as const, scope: "plan_node" as const, actionRequired: result.prompt, nodeId: nextNodeId },
        },
      });

      await appendMainSessionEvent({
        taskId, planId, sessionId: mainSession.id,
        eventType: "node_waiting_for_user", payload: { nodeId: nextNodeId, prompt: result.prompt },
      });

      await rebuildTaskProjection(taskId);

      return {
        layers, decision: "return",
        returnValue: {
          taskId, planId, mainSessionId: mainSession.id,
          status: "waiting_for_user", currentNodeId: nextNodeId,
          executedNodeIds, waitingNodeIds: [nextNodeId], blockedNodeIds: [],
          message: result.prompt,
        },
      };
    }

    case "waiting_for_approval": {
      const approvalLayer = makeRuntimeLayer(planId, nextNodeId, "blocked", layers.length + 1);
      layers = await appendLayer({ workspaceId, taskId, planId, layer: approvalLayer });

      await db.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.WaitingForApproval,
          blockReason: { blockType: "approval_required" as const, scope: "plan_node" as const, actionRequired: result.prompt, nodeId: nextNodeId },
        },
      });

      await appendMainSessionEvent({
        taskId, planId, sessionId: mainSession.id,
        eventType: "node_waiting_for_approval", payload: { nodeId: nextNodeId, prompt: result.prompt },
      });

      await rebuildTaskProjection(taskId);

      return {
        layers, decision: "return",
        returnValue: {
          taskId, planId, mainSessionId: mainSession.id,
          status: "waiting_for_approval", currentNodeId: nextNodeId,
          executedNodeIds, waitingNodeIds: [], blockedNodeIds: [],
          message: result.prompt,
        },
      };
    }

    case "child_running": {
      const childLayer = makeRuntimeLayer(planId, nextNodeId, "running", layers.length + 1);
      layers = await appendLayer({ workspaceId, taskId, planId, layer: childLayer });

      await appendMainSessionEvent({
        taskId, planId, sessionId: mainSession.id,
        eventType: "child_run_started",
        payload: { nodeId: nextNodeId, childSessionId: result.evidence.childSessionId, childRunId: result.evidence.runId, childTaskId: result.evidence.childTaskId },
      });

      await rebuildTaskProjection(taskId);

      return {
        layers, decision: "return",
        returnValue: {
          taskId, planId, mainSessionId: mainSession.id,
          status: "running", currentNodeId: nextNodeId,
          executedNodeIds, waitingNodeIds: [], blockedNodeIds: [],
          message: result.summary,
        },
      };
    }

    case "blocked":
    case "failed": {
      const blockMessage = result.status === "blocked" ? result.reason : result.error;

      const blockedLayer = makeRuntimeLayer(planId, nextNodeId, "blocked", layers.length + 1, { lastError: blockMessage });
      layers = await appendLayer({ workspaceId, taskId, planId, layer: blockedLayer });

      await db.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.Blocked,
          blockReason: { blockType: "node_blocked" as const, scope: "plan_node" as const, actionRequired: blockMessage, nodeId: nextNodeId },
        },
      });

      await appendMainSessionEvent({
        taskId, planId, sessionId: mainSession.id,
        eventType: "node_blocked", payload: { nodeId: nextNodeId, reason: blockMessage },
      });

      await rebuildTaskProjection(taskId);

      return {
        layers, decision: "return",
        returnValue: {
          taskId, planId, mainSessionId: mainSession.id,
          status: "blocked", currentNodeId: nextNodeId,
          executedNodeIds, waitingNodeIds: [], blockedNodeIds: [nextNodeId],
          message: blockMessage,
        },
      };
    }

    case "replan_required": {
      await appendMainSessionEvent({
        taskId, planId, sessionId: mainSession.id,
        eventType: "replan_proposed", payload: { nodeId: nextNodeId, reason: result.reason },
      });

      await db.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.WaitingForApproval,
          blockReason: { blockType: "replan_required" as const, scope: "plan" as const, actionRequired: result.reason, nodeId: nextNodeId },
        },
      });

      await rebuildTaskProjection(taskId);

      return {
        layers, decision: "return",
        returnValue: {
          taskId, planId, mainSessionId: mainSession.id,
          status: "waiting_for_approval", currentNodeId: nextNodeId,
          executedNodeIds, waitingNodeIds: [], blockedNodeIds: [],
          message: result.reason,
        },
      };
    }
  }
}

async function advancePlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  maxSteps?: number;
}): Promise<PlanExecutionResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;

  const _task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, title: true, workspaceId: true, status: true },
  });

  const savedCompiled = await getAcceptedCompiledPlan(input.taskId);
  if (!savedCompiled) {
    return {
      taskId: input.taskId, planId: null, mainSessionId: null,
      status: "no_plan", currentNodeId: null,
      executedNodeIds: [], waitingNodeIds: [], blockedNodeIds: [],
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const { compiledPlan, workspaceId } = savedCompiled;
  const planId = compiledPlan.editablePlanId;
  let layers = await getLayers(input.taskId, planId);

  const planRunData = await getPlanRun(input.taskId, planId);
  let planRun: PlanRun;

  if (!planRunData) {
    planRun = createPlanRunFromCompiledPlan(compiledPlan, layers);
    await savePlanRun({ workspaceId, taskId: input.taskId, planId, run: planRun, layers });
  } else {
    planRun = planRunData.planRun;
  }

  const mainSession = await ensurePlanMainSession({ taskId: input.taskId, planId });
  const runtimeName = await getRuntimeName(input.taskId);
  const executedNodeIds: string[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const effective = resolveEffectivePlanGraph(compiledPlan, layers);

    await appendMainSessionEvent({
      taskId: input.taskId, planId, sessionId: mainSession.id,
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

    if (effective.readyNodeIds.length === 0 && effective.runningNodeIds.length === 0) {
      const execStatus = mapTerminalReasonToStatus(effective);

      await db.task.update({
        where: { id: input.taskId },
        data: {
          status: execStatus === "completed" ? TaskStatus.Completed
            : execStatus === "blocked" ? TaskStatus.Blocked
            : TaskStatus.Running,
          completedAt: execStatus === "completed" ? new Date() : undefined,
          blockReason: execStatus === "blocked"
            ? { blockType: "node_blocked" as const, scope: "plan_execution" as const, actionRequired: "Review blocked nodes" }
            : Prisma.DbNull,
        },
      });

      await rebuildTaskProjection(input.taskId);

      if (execStatus === "completed") {
        await appendMainSessionEvent({
          taskId: input.taskId, planId, sessionId: mainSession.id,
          eventType: "execution_completed", payload: { totalSteps: executedNodeIds.length },
        });
        await completeWorkBlock(input.taskId);
      }

      return {
        taskId: input.taskId, planId, mainSessionId: mainSession.id,
        status: execStatus, currentNodeId: null,
        executedNodeIds, waitingNodeIds: [], blockedNodeIds: effective.blockedNodeIds,
        message: `Execution ${execStatus}: no ready nodes`,
      };
    }

    const nextNodeId = pickNextNodeId(effective);
    if (!nextNodeId) break;

    const effectiveNode = effective.nodes.find((n) => n.id === nextNodeId);
    if (!effectiveNode) break;

    const executor = dispatchExecutor(effectiveNode);
    if (!executor) {
      const blockedLayer = makeRuntimeLayer(planId, nextNodeId, "blocked", layers.length + 1, { lastError: `No executor for node type: ${effectiveNode.type}` });
      layers = await appendLayer({ workspaceId, taskId: input.taskId, planId, layer: blockedLayer });
      continue;
    }

    // Mark node as running
    const startingLayer = makeRuntimeLayer(planId, nextNodeId, "running", layers.length + 1);
    layers = await appendLayer({ workspaceId, taskId: input.taskId, planId, layer: startingLayer });

    await db.task.update({
      where: { id: input.taskId },
      data: { status: TaskStatus.Running, blockReason: Prisma.DbNull },
    });

    await appendMainSessionEvent({
      taskId: input.taskId, planId, sessionId: mainSession.id,
      eventType: "node_started",
      payload: { nodeId: nextNodeId, nodeTitle: effectiveNode.title, nodeType: effectiveNode.type },
    });

    const result = await executor.execute({
      taskId: input.taskId,
      planId,
      mainSession,
      node: effectiveNode,
      plan: effective,
      trigger: input.trigger,
      runtimeName,
    });

    const handled = await handleNodeResult({
      nextNodeId,
      result,
      effective,
      compiledPlan,
      planId,
      workspaceId,
      taskId: input.taskId,
      mainSession,
      layers,
      executedNodeIds,
    });

    layers = handled.layers;
    if (handled.decision === "return" && handled.returnValue) {
      return handled.returnValue;
    }
  }

  await rebuildTaskProjection(input.taskId);

  return {
    taskId: input.taskId, planId, mainSessionId: mainSession.id,
    status: "running", currentNodeId: null,
    executedNodeIds, waitingNodeIds: [], blockedNodeIds: [],
    message: "Max steps reached. Call advancePlanExecution again to continue.",
  };
}

function resumeBlockedNodes(
  compiledPlan: CompiledPlan,
  layers: PlanOverlayLayer[],
): { resumeLayer: RuntimeLayer } | null {
  const effective = resolveEffectivePlanGraph(compiledPlan, layers);
  const waitingNodes = effective.nodes.filter((n) => n.status === "blocked" || n.status === "failed");
  if (waitingNodes.length === 0) return null;

  const nodeStates: Record<string, { status: string }> = {};
  for (const n of waitingNodes) {
    nodeStates[n.id] = { status: "ready" };
  }

  return {
    resumeLayer: {
      type: "runtime",
      planId: compiledPlan.editablePlanId,
      timestamp: new Date().toISOString(),
      layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      version: layers.length + 1,
      active: true,
      source: "system",
      nodeStates: nodeStates as Record<string, { status: string }>,
    } as RuntimeLayer,
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
      taskId: input.taskId, planId: null, mainSessionId: null,
      status: "no_plan", currentNodeId: null,
      executedNodeIds: [], waitingNodeIds: [], blockedNodeIds: [],
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const planId = savedCompiled.compiledPlan.editablePlanId;
  const mainSession = await ensurePlanMainSession({ taskId: input.taskId, planId });
  await activateWorkBlock(input.taskId);

  await appendMainSessionEvent({
    taskId: input.taskId, planId, sessionId: mainSession.id,
    eventType: "execution_started", payload: { trigger: input.trigger, prompt: input.prompt },
  });

  return advancePlanExecution({ taskId: input.taskId, trigger: input.trigger });
}

export async function continuePlanExecution(input: {
  taskId: string;
  reason: string;
  userInput?: string;
}): Promise<PlanExecutionResult> {
  const _task2 = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, title: true, workspaceId: true },
  });

  const savedCompiled = await getAcceptedCompiledPlan(input.taskId);
  if (!savedCompiled) {
    return {
      taskId: input.taskId, planId: null, mainSessionId: null,
      status: "no_plan", currentNodeId: null,
      executedNodeIds: [], waitingNodeIds: [], blockedNodeIds: [],
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const { compiledPlan, workspaceId } = savedCompiled;
  const planId = compiledPlan.editablePlanId;
  let layers = await getLayers(input.taskId, planId);

  const mainSession = await ensurePlanMainSession({ taskId: input.taskId, planId });

  if (input.userInput) {
    await appendMainSessionEvent({
      taskId: input.taskId, planId, sessionId: mainSession.id,
      eventType: "user_input_received", payload: { input: input.userInput, reason: input.reason },
    });

    const resume = resumeBlockedNodes(compiledPlan, layers);
    if (resume) {
      layers = await appendLayer({ workspaceId, taskId: input.taskId, planId, layer: resume.resumeLayer });

      await db.task.update({
        where: { id: input.taskId },
        data: { status: TaskStatus.Ready, blockReason: Prisma.DbNull },
      });

      await rebuildTaskProjection(input.taskId);
    }
  }

  return advancePlanExecution({ taskId: input.taskId, trigger: "manual" });
}
