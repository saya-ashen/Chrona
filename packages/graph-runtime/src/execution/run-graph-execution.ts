import {
  createExecutionContextSnapshot,
  pickNextNodeId,
  updateAttemptStatus,
} from "../execution-state";
import { resolveEffectivePlanGraph } from "../resolve";
import { mapTerminalReasonToGraphStatus, mapWaitKindToGraphStatus } from "../status";
import type { NodeAttempt } from "../types";
import {
  appendCapabilityUnavailableResult,
  appendExecutionResult,
  getEventType,
  getPauseKind,
  getResultMessage,
} from "./result-normalization";
import type {
  GraphExecutionEvent,
  GraphExecutionOutcome,
  RunGraphExecutionInput,
} from "./types";

const DEFAULT_MAX_STEPS = 10;

export async function runGraphExecution<TContext = unknown>(
  input: RunGraphExecutionInput<TContext>,
): Promise<GraphExecutionOutcome> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxConcurrency = Math.max(1, input.maxConcurrency ?? 1);
  const executedNodeIds: string[] = [];
  let state = structuredClone(input.state);
  let forcedNodeId = input.forcedNodeId;
  let userInput = input.userInput;

  for (let step = 0; step < maxSteps; step++) {
    const effective = resolveEffectivePlanGraph(state);
    await input.callbacks.onEvent?.({
      type: "executable_path_computed",
      effective,
    });

    if (effective.readyNodeIds.length === 0 && !forcedNodeId) {
      const status = mapTerminalReasonToGraphStatus(effective);
      return {
        status,
        currentNodeId: null,
        executedNodeIds,
        effective,
        state,
        message: `Execution ${status}: no ready nodes`,
      };
    }

    const forcedNextNodeId = forcedNodeId
      ? pickNextNodeId(effective, forcedNodeId)
      : null;
    const nextNodeIds = forcedNextNodeId
      ? [forcedNextNodeId]
      : effective.readyNodeIds.slice(0, maxConcurrency);
    if (nextNodeIds.length === 0) {
      return {
        status: "blocked",
        currentNodeId: null,
        executedNodeIds,
        effective,
        state,
        message: "Execution paused: no eligible node found",
      };
    }

    for (const nextNodeId of nextNodeIds) {
      const node = effective.nodes.find(
        (candidate) => candidate.id === nextNodeId,
      );
      if (!node || !node.activeLayerId) {
        throw new Error(`Effective node ${nextNodeId} is missing active layer`);
      }
      const nodeUserInput = forcedNodeId === nextNodeId ? userInput : undefined;
      const nodeInputFields = forcedNodeId === nextNodeId ? input.inputFields : undefined;
      forcedNodeId = undefined;

      if (nodeUserInput) {
        state = {
          ...state,
          results: state.results.map((result) =>
            result.nodeId === nextNodeId && result.status === "current"
              ? { ...result, status: input.forcedReplaceStatus ?? "obsolete" }
              : result,
          ),
        };
      }

      const now = input.now?.() ?? Date.now();
      const snapshot = createExecutionContextSnapshot({
        graphId: state.graph.id,
        nodeId: nextNodeId,
        nodeLayerId: node.activeLayerId,
        graphVersion: state.graph.mutations.length,
        runtimeName: input.runtimeName,
        userInput: nodeUserInput,
        inputFields: nodeInputFields,
        now,
      });

      const attempt: NodeAttempt = {
        id: `attempt_${state.graph.id}_${nextNodeId}_${now}`,
        taskId: input.taskId,
        graphId: state.graph.id,
        nodeId: nextNodeId,
        nodeLayerId: node.activeLayerId,
        executionContextSnapshotId: snapshot.id,
        status: "running",
        idempotencyKey: `${state.graph.id}:${nextNodeId}:${now}`,
        attemptNumber:
          state.attempts.filter((candidate) => candidate.nodeId === nextNodeId)
            .length + 1,
        startedAt: snapshot.createdAt,
      };

      state = {
        ...state,
        attempts: [...state.attempts, attempt],
        executionContextSnapshots: [
          ...state.executionContextSnapshots,
          snapshot,
        ],
      };
      await input.callbacks.onEvent?.({ type: "node_started", node, attempt });
      await input.callbacks.onStateChange?.(state);

      const result = await input.callbacks.executeNode({
        node,
        plan: effective,
        trigger: input.trigger,
        runtimeName: input.runtimeName,
        userInput: nodeUserInput,
        inputFields: nodeInputFields,
        context: input.context,
      });

      const finishedAt = new Date(input.now?.() ?? Date.now()).toISOString();
      if (!result) {
        state = {
          ...state,
          attempts: updateAttemptStatus({
            attempts: state.attempts,
            attemptId: attempt.id,
            status: "failed",
            finishedAt,
            error: {
              code: "CAPABILITY_UNAVAILABLE",
              message: `No executor for node type: ${node.type}`,
            },
          }),
          results: appendCapabilityUnavailableResult({
            taskId: input.taskId,
            state,
            node,
            now,
          }),
        };
        await input.callbacks.onStateChange?.(state);
        const blockedEffective = resolveEffectivePlanGraph(state);
        return {
          status: "blocked",
          currentNodeId: nextNodeId,
          executedNodeIds,
          effective: blockedEffective,
          state,
          waitKind: "capability_unavailable",
          message: `No executor for node type: ${node.type}`,
        };
      }

      if (result.status === "started") {
        state = {
          ...state,
          attempts: updateAttemptStatus({
            attempts: state.attempts,
            attemptId: attempt.id,
            status: "running",
            runtimeSnapshot: {
              ...(attempt.runtimeSnapshot ?? {}),
              evidence: result.evidence,
              output: result.output,
            },
          }),
        };
        await input.callbacks.onStateChange?.(state);
        const runningEffective = resolveEffectivePlanGraph(state);
        return {
          status: "running",
          currentNodeId: nextNodeId,
          executedNodeIds,
          effective: runningEffective,
          state,
          message: result.summary,
        };
      }

      state = {
        ...state,
        attempts: updateAttemptStatus({
          attempts: state.attempts,
          attemptId: attempt.id,
          status:
            result.status === "failed" || result.status === "blocked"
              ? "failed"
              : "succeeded",
          finishedAt,
          error:
            result.status === "failed"
              ? {
                  code: "NODE_FAILED",
                  message: result.error,
                  details: result.details,
                }
              : result.status === "blocked"
                ? { code: "NODE_BLOCKED", message: result.reason }
                : undefined,
        }),
        results: appendExecutionResult({
          taskId: input.taskId,
          state,
          node,
          attempt,
          result,
          now,
        }),
      };

      const eventType = getEventType(result);
      if (eventType) {
        await input.callbacks.onEvent?.({
          type: eventType,
          node,
          result,
        } as GraphExecutionEvent);
      }
      await input.callbacks.onStateChange?.(state);

      if (result.status === "failed") {
        const failedEffective = resolveEffectivePlanGraph(state);
        return {
          status: "failed",
          currentNodeId: nextNodeId,
          executedNodeIds,
          effective: failedEffective,
          state,
          message: result.error,
        };
      }

      const waitKind = getPauseKind(result);
      if (waitKind) {
        const pausedEffective = resolveEffectivePlanGraph(state);
        return {
          status: mapWaitKindToGraphStatus(waitKind),
          currentNodeId: nextNodeId,
          executedNodeIds,
          effective: pausedEffective,
          state,
          waitKind,
          message: getResultMessage(result),
        };
      }

      executedNodeIds.push(nextNodeId);
      userInput = undefined;
    }
  }

  const effective = resolveEffectivePlanGraph(state);
  return {
    status: "running",
    currentNodeId: null,
    executedNodeIds,
    effective,
    state,
    message: "Max steps reached. Call runGraphExecution again to continue.",
  };
}
