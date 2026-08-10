import {
  createExecutionContextSnapshot,
  pickNextNodeId,
  updateAttemptStatus,
} from "../execution-state";
import {
  explainNodeExecutionBlock,
  findEffectiveGraphInvariantViolation,
  normalizeNodeResult,
} from "./guards";
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

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  throw signal.reason ?? new Error("Graph execution aborted");
}

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
    throwIfAborted(input.control?.signal);
    const effective = resolveEffectivePlanGraph(state);
    await input.callbacks.onEvent?.({
      type: "executable_path_computed",
      effective,
    });

    const invariantViolation = findEffectiveGraphInvariantViolation(effective);
    if (invariantViolation) {
      return {
        status: "blocked",
        currentNodeId: null,
        executedNodeIds,
        effective,
        state,
        waitKind: "manual_action",
        message: invariantViolation,
      };
    }

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
      ? pickNextNodeId(effective, forcedNodeId, {
        allowWaitingInputResume: Boolean(userInput),
      })
      : null;
    if (forcedNodeId && !forcedNextNodeId) {
      const forcedNode = effective.nodes.find((node) => node.id === forcedNodeId);
      return {
        status: "blocked",
        currentNodeId: forcedNodeId,
        executedNodeIds,
        effective,
        state,
        waitKind: "manual_action",
        message: forcedNode
          ? explainNodeExecutionBlock({
            node: forcedNode,
            allowWaitingInputResume: Boolean(userInput),
          }) ?? `Node ${forcedNodeId} is not executable`
          : `Node ${forcedNodeId} does not exist in the effective graph`,
      };
    }
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
      const executionBlock = explainNodeExecutionBlock({
        node,
        allowWaitingInputResume: Boolean(nodeUserInput),
      });
      if (executionBlock) {
        return {
          status: "blocked",
          currentNodeId: nextNodeId,
          executedNodeIds,
          effective,
          state,
          waitKind: "manual_action",
          message: executionBlock,
        };
      }
      const existingRunningAttempt = state.attempts.find(
        (attempt) =>
          attempt.nodeId === nextNodeId &&
          attempt.nodeLayerId === node.activeLayerId &&
          attempt.status === "running",
      );
      if (existingRunningAttempt) {
        return {
          status: "running",
          currentNodeId: nextNodeId,
          executedNodeIds,
          effective,
          state,
          message: `Node ${nextNodeId} is already running`,
        };
      }
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
      const identity = crypto.randomUUID();
      const snapshot = createExecutionContextSnapshot({
        graphId: state.graph.id,
        nodeId: nextNodeId,
        nodeLayerId: node.activeLayerId,
        graphVersion: state.graph.mutations.length,
        runtimeName: input.runtimeName,
        identity,
        userInput: nodeUserInput,
        inputFields: nodeInputFields,
        now,
      });

      const attempt: NodeAttempt = {
        id: `attempt_${state.graph.id}_${nextNodeId}_${now}_${identity}`,
        taskId: input.taskId,
        graphId: state.graph.id,
        nodeId: nextNodeId,
        nodeLayerId: node.activeLayerId,
        executionContextSnapshotId: snapshot.id,
        status: "running",
        idempotencyKey: `${state.graph.id}:${nextNodeId}:${now}:${identity}`,
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

      const rawResult = await input.callbacks.executeNode({
        node,
        plan: effective,
        attempt,
        trigger: input.trigger,
        runtimeName: input.runtimeName,
        userInput: nodeUserInput,
        inputFields: nodeInputFields,
        context: input.context,
        signal: input.control?.signal,
      });
      throwIfAborted(input.control?.signal);

      const submittedState = await input.callbacks.resolveSubmittedNodeState?.({
        node,
        attempt,
        state,
      });
      if (submittedState) {
        state = submittedState;
        const submittedEffective = resolveEffectivePlanGraph(state);
        const status = mapTerminalReasonToGraphStatus(submittedEffective);
        // When the nested command left execution running (e.g. it continued
        // to the next node which started an async provider run), keep going
        // in the outer loop so the outer executeNode sees the submitted result.
        if (status === "running") {
          executedNodeIds.push(node.id);
          userInput = undefined;
          continue;
        }
        return {
          status,
          currentNodeId: node.id,
          executedNodeIds,
          effective: submittedEffective,
          state,
          message: `Node ${node.id} result was submitted through graph command.`,
        };
      }

      const finishedAt = new Date(input.now?.() ?? Date.now()).toISOString();
      if (!rawResult) {
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

      const result = normalizeNodeResult({ node, result: rawResult });

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
      if (result.status === "done") {
        const candidateEffective = resolveEffectivePlanGraph(state);
        const candidateNode = candidateEffective.nodes.find((candidate) => candidate.id === nextNodeId);
        if (candidateNode?.status !== "completed") {
          return {
            status: "running",
            currentNodeId: nextNodeId,
            executedNodeIds,
            effective: candidateEffective,
            state,
            message: "Node completion is waiting for an authoritative terminal result.",
          };
        }
      }

      executedNodeIds.push(nextNodeId);
      userInput = undefined;
      if (input.control?.shouldPause?.()) {
        const pausedEffective = resolveEffectivePlanGraph(state);
        return {
          status: "blocked",
          currentNodeId: nextNodeId,
          executedNodeIds,
          effective: pausedEffective,
          state,
          waitKind: "manual_action",
          message: "Execution paused by user request.",
        };
      }
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
