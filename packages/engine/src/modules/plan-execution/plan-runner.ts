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
import type { Prisma as PrismaNS } from "@/generated/prisma/client";

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

// ── Result handler strategies ──

type ResultOf<S extends NodeExecutionResult["status"]> = Extract<NodeExecutionResult, { status: S }>;

interface ResultContext {
  nextNodeId: string;
  result: NodeExecutionResult;
  effective: EffectivePlanGraph;
  compiledPlan: CompiledPlan;
  planId: string;
  workspaceId: string;
  taskId: string;
  mainSession: { id: string };
  layers: PlanOverlayLayer[];
  executedNodeIds: string[];
}

interface ResultStrategy {
  layerStatus: string;
  decision: "continue" | "return";
  eventType: string;
  eventPayload: (r: NodeExecutionResult, ctx: ResultContext) => Record<string, unknown>;
  taskUpdate?: (r: NodeExecutionResult, ctx: ResultContext) => { status: TaskStatus; blockReason: PrismaNS.InputJsonValue };
  executionStatus: PlanExecutionStatus;
  getMessage: (r: NodeExecutionResult) => string;
}

const RESULT_STRATEGIES: Record<string, ResultStrategy> = {
  done: {
    layerStatus: "completed",
    decision: "continue",
    eventType: "node_completed",
    eventPayload: (r, ctx) => ({ nodeId: ctx.nextNodeId, summary: (r as ResultOf<"done">).summary }),
    executionStatus: "running",
    getMessage: (r) => (r as ResultOf<"done">).summary,
  },

  waiting_for_user: {
    layerStatus: "blocked",
    decision: "return",
    eventType: "node_waiting_for_user",
    eventPayload: (r, ctx) => ({ nodeId: ctx.nextNodeId, prompt: (r as ResultOf<"waiting_for_user">).prompt }),
    taskUpdate: (r, ctx) => ({
      status: TaskStatus.WaitingForInput,
      blockReason: { blockType: "human_input_required", scope: "plan_node", actionRequired: (r as ResultOf<"waiting_for_user">).prompt, nodeId: ctx.nextNodeId },
    }),
    executionStatus: "waiting_for_user",
    getMessage: (r) => (r as ResultOf<"waiting_for_user">).prompt,
  },

  waiting_for_approval: {
    layerStatus: "blocked",
    decision: "return",
    eventType: "node_waiting_for_approval",
    eventPayload: (r, ctx) => ({ nodeId: ctx.nextNodeId, prompt: (r as ResultOf<"waiting_for_approval">).prompt }),
    taskUpdate: (r, ctx) => ({
      status: TaskStatus.WaitingForApproval,
      blockReason: { blockType: "approval_required", scope: "plan_node", actionRequired: (r as ResultOf<"waiting_for_approval">).prompt, nodeId: ctx.nextNodeId },
    }),
    executionStatus: "waiting_for_approval",
    getMessage: (r) => (r as ResultOf<"waiting_for_approval">).prompt,
  },

  child_running: {
    layerStatus: "running",
    decision: "return",
    eventType: "child_run_started",
    eventPayload: (r, ctx) => ({
      nodeId: ctx.nextNodeId,
      childSessionId: (r as ResultOf<"child_running">).evidence.childSessionId,
      childRunId: (r as ResultOf<"child_running">).evidence.runId,
      childTaskId: (r as ResultOf<"child_running">).evidence.childTaskId,
    }),
    executionStatus: "running",
    getMessage: (r) => (r as ResultOf<"child_running">).summary,
  },

  blocked: {
    layerStatus: "blocked",
    decision: "return",
    eventType: "node_blocked",
    eventPayload: (r, ctx) => ({ nodeId: ctx.nextNodeId, reason: (r as ResultOf<"blocked">).reason }),
    taskUpdate: (r, ctx) => ({
      status: TaskStatus.Blocked,
      blockReason: { blockType: "node_blocked", scope: "plan_node", actionRequired: (r as ResultOf<"blocked">).reason, nodeId: ctx.nextNodeId },
    }),
    executionStatus: "blocked",
    getMessage: (r) => (r as ResultOf<"blocked">).reason,
  },

  failed: {
    layerStatus: "blocked",
    decision: "return",
    eventType: "node_blocked",
    eventPayload: (r, ctx) => ({ nodeId: ctx.nextNodeId, reason: (r as ResultOf<"failed">).error }),
    taskUpdate: (r, ctx) => ({
      status: TaskStatus.Blocked,
      blockReason: { blockType: "node_blocked", scope: "plan_node", actionRequired: (r as ResultOf<"failed">).error, nodeId: ctx.nextNodeId },
    }),
    executionStatus: "blocked",
    getMessage: (r) => (r as ResultOf<"failed">).error,
  },

  replan_required: {
    layerStatus: "blocked",
    decision: "return",
    eventType: "replan_proposed",
    eventPayload: (r, ctx) => ({ nodeId: ctx.nextNodeId, reason: (r as ResultOf<"replan_required">).reason }),
    taskUpdate: (r, ctx) => ({
      status: TaskStatus.WaitingForApproval,
      blockReason: { blockType: "replan_required", scope: "plan", actionRequired: (r as ResultOf<"replan_required">).reason, nodeId: ctx.nextNodeId },
    }),
    executionStatus: "waiting_for_approval",
    getMessage: (r) => (r as ResultOf<"replan_required">).reason,
  },
};

async function applyDriftResultStrategy(params: {
  nextNodeId: string;
  result: NodeExecutionResult;
  effective: EffectivePlanGraph;
  compiledPlan: CompiledPlan;
  planId: string;
  workspaceId: string;
  taskId: string;
  mainSession: { id: string };
  layers: PlanOverlayLayer[];
  executedNodeIds: string[];
}) {
  const { nextNodeId, result, effective, compiledPlan, planId, workspaceId, taskId, mainSession, executedNodeIds } = params;
  let layers = [...params.layers];

  const drift = detectPlanDrift({ node: effective.nodes.find((n: EffectivePlanNode) => n.id === nextNodeId)!, nodeResult: result, plan: effective });

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
      data: { status: TaskStatus.WaitingForApproval, blockReason: { blockType: "replan_required", scope: "plan", actionRequired: drift.reason, nodeId: nextNodeId } },
    });

    await rebuildTaskProjection(taskId);

    return {
      layers, decision: "return" as const,
      returnValue: {
        taskId, planId, mainSessionId: mainSession.id,
        status: "waiting_for_approval" as const, currentNodeId: nextNodeId,
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
      source: "system",
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

  return { layers, decision: "continue" as const };
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
  const { nextNodeId, result, effective, compiledPlan, planId, workspaceId, taskId, mainSession, executedNodeIds } = params;

  const node = effective.nodes.find((n) => n.id === nextNodeId)!;
  const drift = detectPlanDrift({ node, nodeResult: result, plan: effective });

  if (drift.needsReplan) {
    return applyDriftResultStrategy({ nextNodeId, result, effective, compiledPlan, planId, workspaceId, taskId, mainSession, layers: [...params.layers], executedNodeIds });
  }

  executedNodeIds.push(nextNodeId);

  const strategy = RESULT_STRATEGIES[result.status];
  if (!strategy) {
    throw new Error(`Unknown node result status: ${result.status}`);
  }

  let layers = [...params.layers];
  const blockMessage = strategy.getMessage(result);

  const extra = strategy.layerStatus === "blocked" && (result.status === "blocked" || result.status === "failed" || result.status === "replan_required")
    ? { lastError: blockMessage }
    : undefined;
  const layer = makeRuntimeLayer(planId, nextNodeId, strategy.layerStatus, layers.length + 1, extra);
  layers = await appendLayer({ workspaceId, taskId, planId, layer });

  await appendMainSessionEvent({
    taskId, planId, sessionId: mainSession.id,
    eventType: strategy.eventType as Parameters<typeof appendMainSessionEvent>[0]["eventType"],
    payload: strategy.eventPayload(result, { nextNodeId, result, effective, compiledPlan, planId, workspaceId, taskId, mainSession, layers, executedNodeIds }),
  });

  if (strategy.taskUpdate) {
    await db.task.update({
      where: { id: taskId },
      data: strategy.taskUpdate(result, { nextNodeId, result, effective, compiledPlan, planId, workspaceId, taskId, mainSession, layers, executedNodeIds }),
    });
  }

  if (strategy.decision === "return" || strategy.layerStatus === "completed") {
    await rebuildTaskProjection(taskId);
  }

  if (strategy.decision === "continue") return { layers, decision: "continue" };

  return {
    layers, decision: "return",
    returnValue: {
      taskId, planId, mainSessionId: mainSession.id,
      status: strategy.executionStatus, currentNodeId: nextNodeId,
      executedNodeIds,
      waitingNodeIds: strategy.executionStatus === "waiting_for_user" ? [nextNodeId] : [],
      blockedNodeIds: strategy.executionStatus === "blocked" || strategy.executionStatus === "waiting_for_approval" ? [nextNodeId] : [],
      message: blockMessage,
    },
  };
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
