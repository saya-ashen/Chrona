import {
  appendCurrentResult,
  markNodeResults,
  createExecutionContextSnapshot,
  pickNextNodeId,
  updateAttemptStatus,
} from "./execution-state";
import { resolveEffectivePlanGraph } from "./resolve";
import { applyGraphMutation } from "./mutations";
import { applyDownstreamInvalidation, planDownstreamInvalidation } from "./invalidation";
import { validatePlanGraph } from "./validation";
import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  ExecutionContextSnapshot,
  GraphMutationOperation,
  NodeAttempt,
  NodeResult,
  PlanGraph,
  WaitKind,
} from "./types";

export type GraphExecutionStatus =
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "completed"
  | "cancelled"
  | "unsupported";

export type GraphExecutionTrigger = "manual" | "scheduler" | "system" | "auto";

export type GraphNodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
  childTaskId?: string;
  childSessionId?: string;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
};

export type GraphNodeExecutionResult =
  | {
      status: "done";
      summary: string;
      evidence: GraphNodeExecutionEvidence;
      output?: unknown;
      selectedBranch?: NodeResult["selectedBranch"];
    }
  | {
      status: "waiting_for_user";
      prompt: string;
      reason: string;
      evidence?: GraphNodeExecutionEvidence;
    }
  | {
      status: "waiting_for_approval";
      prompt: string;
      reason: string;
      evidence?: GraphNodeExecutionEvidence;
    }
  | { status: "blocked"; reason: string; evidence?: GraphNodeExecutionEvidence }
  | {
      status: "replan_required";
      reason: string;
      evidence?: GraphNodeExecutionEvidence;
      proposedPatch?: unknown;
    }
  | {
      status: "child_running";
      summary: string;
      evidence: GraphNodeExecutionEvidence;
      output?: unknown;
    }
  | { status: "failed"; error: string; evidence?: GraphNodeExecutionEvidence };

export type GraphExternalSyncResult =
  | {
      nodeId: string;
      status: "done";
      summary: string;
      evidence?: GraphNodeExecutionEvidence;
      output?: unknown;
      selectedBranch?: NodeResult["selectedBranch"];
    }
  | {
      nodeId: string;
      status: "failed";
      error: string;
      evidence?: GraphNodeExecutionEvidence;
    }
  | {
      nodeId: string;
      status: "blocked";
      reason: string;
      evidence?: GraphNodeExecutionEvidence;
    }
  | {
      nodeId: string;
      status: "cancelled";
      reason?: string;
      evidence?: GraphNodeExecutionEvidence;
    };

export type GraphExecutionState = {
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
};

export type GraphExecutionEvent =
  | { type: "command_received"; command: GraphRuntimeCommand }
  | { type: "command_unsupported"; command: GraphRuntimeCommand; reason: string }
  | { type: "command_validation_failed"; command: GraphRuntimeCommand; issues: string[] }
  | { type: "graph_mutation_applied"; mutationId: string; affectedNodeIds: string[] }
  | { type: "external_result_synced"; nodeId: string; status: GraphExternalSyncResult["status"] }
  | { type: "executable_path_computed"; effective: EffectivePlanGraph }
  | { type: "node_started"; node: EffectivePlanNode; attempt: NodeAttempt }
  | { type: "node_completed"; node: EffectivePlanNode; result: GraphNodeExecutionResult }
  | { type: "node_waiting_for_user"; node: EffectivePlanNode; result: GraphNodeExecutionResult }
  | { type: "node_waiting_for_approval"; node: EffectivePlanNode; result: GraphNodeExecutionResult }
  | { type: "child_run_started"; node: EffectivePlanNode; result: GraphNodeExecutionResult }
  | { type: "node_blocked"; node: EffectivePlanNode; result: GraphNodeExecutionResult }
  | { type: "replan_proposed"; node: EffectivePlanNode; result: GraphNodeExecutionResult };

export type GraphNodeExecutorInput<TContext = unknown> = {
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  trigger: GraphExecutionTrigger;
  runtimeName: string;
  userInput?: string;
  context: TContext;
};

export type GraphExecutionCallbacks<TContext = unknown> = {
  executeNode(input: GraphNodeExecutorInput<TContext>): Promise<GraphNodeExecutionResult | null>;
  onEvent?(event: GraphExecutionEvent): Promise<void> | void;
  onStateChange?(state: GraphExecutionState): Promise<void> | void;
};

export type GraphNodeExecutor<TContext = unknown> = (
  input: GraphNodeExecutorInput<TContext>,
) => Promise<GraphNodeExecutionResult | null>;

export type GraphExecutorRegistry<TContext = unknown> = Record<
  string,
  GraphNodeExecutor<TContext>
>;

export type GraphExecutionOutcome = {
  status: GraphExecutionStatus;
  currentNodeId: string | null;
  executedNodeIds: string[];
  effective: EffectivePlanGraph;
  state: GraphExecutionState;
  waitKind?: WaitKind;
  message: string;
};

export type RunGraphExecutionInput<TContext = unknown> = {
  taskId: string;
  runtimeName: string;
  trigger: GraphExecutionTrigger;
  state: GraphExecutionState;
  context: TContext;
  maxSteps?: number;
  forcedNodeId?: string;
  userInput?: string;
  forcedReplaceStatus?: NonNullable<NodeResult["status"]>;
  maxConcurrency?: number;
  now?: () => number;
  callbacks: GraphExecutionCallbacks<TContext>;
};

export type GraphRuntimeCommand =
  | {
      type: "start";
      state: GraphExecutionState;
      trigger: GraphExecutionTrigger;
      context: unknown;
    }
  | {
      type: "resume_with_input";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      input: { nodeId: string; value: string; replaceStatus?: NonNullable<NodeResult["status"]> };
    }
  | {
      type: "resume_after_unblock";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      nodeId?: string;
    }
  | {
      type: "resume_with_approval";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      input: { nodeId: string; approved: boolean; feedback?: string };
    }
  | {
      type: "retry_node";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      nodeId: string;
      reason?: string;
      userInput?: string;
    }
  | {
      type: "cancel_session";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      reason?: string;
    }
  | {
      type: "apply_mutation";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      mutation: {
        operations: GraphMutationOperation[];
        reason: string;
        invalidateDownstream?: boolean;
      };
    }
  | {
      type: "sync_external_result";
      state: GraphExecutionState;
      trigger?: GraphExecutionTrigger;
      context: unknown;
      externalResult: GraphExternalSyncResult;
    };

export type GraphRuntimePolicies = {
  maxSteps?: number;
  maxConcurrency?: number;
  retry?: { maxAttempts?: number };
  validateGraph?: boolean;
};

export type GraphRuntimeOptions<TContext = unknown> = {
  taskId: string;
  runtimeName: string;
  callbacks?: Partial<GraphExecutionCallbacks<TContext>>;
  executors?: GraphExecutorRegistry<TContext>;
  policies?: GraphRuntimePolicies;
  now?: () => number;
};

export type GraphDispatchOutcome = GraphExecutionOutcome & {
  events: GraphExecutionEvent[];
};

export type GraphRuntime<TContext = unknown> = {
  dispatch(command: GraphRuntimeCommand): Promise<GraphDispatchOutcome>;
};

const DEFAULT_MAX_STEPS = 10;

export function mapWaitKindToGraphStatus(waitKind: WaitKind | undefined): GraphExecutionStatus {
  switch (waitKind) {
    case "user_input":
      return "waiting_for_user";
    case "approval":
    case "review":
      return "waiting_for_approval";
    default:
      return "blocked";
  }
}

export function mapTerminalReasonToGraphStatus(effective: EffectivePlanGraph): GraphExecutionStatus {
  if (effective.readyNodeIds.length > 0) return "running";
  if (effective.runningNodeIds.length > 0) return "running";
  if (effective.nodes.some((node) => node.status === "waiting_for_user")) {
    return "waiting_for_user";
  }
  if (effective.nodes.some((node) => node.status === "waiting_for_approval")) {
    return "waiting_for_approval";
  }
  if (effective.blockedNodeIds.length > 0 || effective.failedNodeIds.length > 0) {
    return "blocked";
  }
  if (effective.completedNodeIds.length === effective.nodes.length) return "completed";
  return "blocked";
}

function appendCapabilityUnavailableResult(input: {
  taskId: string;
  state: GraphExecutionState;
  node: EffectivePlanNode;
  now: number;
}): NodeResult[] {
  return appendCurrentResult({
    results: input.state.results,
    result: {
      id: `result_${input.state.graph.id}_${input.node.id}_${input.now}`,
      taskId: input.taskId,
      graphId: input.state.graph.id,
      nodeId: input.node.id,
      nodeLayerId: input.node.activeLayerId ?? undefined,
      status: "current",
      waitKind: "capability_unavailable",
      error: `No executor for node type: ${input.node.type}`,
    },
  });
}

function appendExecutionResult(input: {
  taskId: string;
  state: GraphExecutionState;
  node: EffectivePlanNode;
  attempt: NodeAttempt;
  result: GraphNodeExecutionResult;
  now: number;
}): NodeResult[] {
  const base = {
    id: `result_${input.state.graph.id}_${input.node.id}_${input.now}`,
    taskId: input.taskId,
    graphId: input.state.graph.id,
    nodeId: input.node.id,
    nodeLayerId: input.node.activeLayerId ?? undefined,
    attemptId: input.attempt.id,
  } satisfies NodeResult;

  switch (input.result.status) {
    case "done":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          outputSummary: input.result.summary,
          selectedBranch: input.result.selectedBranch,
        },
      });
    case "waiting_for_user":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "user_input",
          error: input.result.reason,
        },
      });
    case "waiting_for_approval":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "approval",
          error: input.result.reason,
          review: { required: true, status: "pending" },
        },
      });
    case "child_running":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "external_dependency",
          outputSummary: input.result.summary,
        },
      });
    case "blocked":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "manual_action",
          error: input.result.reason,
        },
      });
    case "failed":
      return appendCurrentResult({
        results: input.state.results,
        result: { ...base, status: "rejected", error: input.result.error },
      });
    case "replan_required":
      return appendCurrentResult({
        results: input.state.results,
        result: {
          ...base,
          status: "current",
          waitKind: "approval",
          error: input.result.reason,
          review: {
            required: true,
            status: "request_changes",
            feedback: input.result.reason,
          },
        },
      });
  }
}

function getPauseKind(result: GraphNodeExecutionResult): WaitKind | null {
  switch (result.status) {
    case "waiting_for_user":
      return "user_input";
    case "waiting_for_approval":
    case "replan_required":
      return "approval";
    case "child_running":
      return "external_dependency";
    case "blocked":
      return "manual_action";
    default:
      return null;
  }
}

function getResultMessage(result: GraphNodeExecutionResult): string {
  switch (result.status) {
    case "waiting_for_user":
    case "waiting_for_approval":
      return result.prompt;
    case "child_running":
    case "done":
      return result.summary;
    case "blocked":
    case "replan_required":
      return result.reason;
    case "failed":
      return result.error;
  }
}

function getEventType(result: GraphNodeExecutionResult): GraphExecutionEvent["type"] | null {
  switch (result.status) {
    case "done":
      return "node_completed";
    case "waiting_for_user":
      return "node_waiting_for_user";
    case "waiting_for_approval":
      return "node_waiting_for_approval";
    case "child_running":
      return "child_run_started";
    case "blocked":
      return "node_blocked";
    case "replan_required":
      return "replan_proposed";
    default:
      return null;
  }
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
    const effective = resolveEffectivePlanGraph(state);
    await input.callbacks.onEvent?.({ type: "executable_path_computed", effective });

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

    const forcedNextNodeId = forcedNodeId ? pickNextNodeId(effective, forcedNodeId) : null;
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
      const node = effective.nodes.find((candidate) => candidate.id === nextNodeId);
      if (!node || !node.activeLayerId) {
        throw new Error(`Effective node ${nextNodeId} is missing active layer`);
      }
      const nodeUserInput = forcedNodeId === nextNodeId ? userInput : undefined;
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
        attemptNumber: state.attempts.filter((candidate) => candidate.nodeId === nextNodeId).length + 1,
        startedAt: snapshot.createdAt,
      };

      state = {
        ...state,
        attempts: [...state.attempts, attempt],
        executionContextSnapshots: [...state.executionContextSnapshots, snapshot],
      };
      await input.callbacks.onEvent?.({ type: "node_started", node, attempt });
      await input.callbacks.onStateChange?.(state);

      const result = await input.callbacks.executeNode({
        node,
        plan: effective,
        trigger: input.trigger,
        runtimeName: input.runtimeName,
        userInput: nodeUserInput,
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
            error: { code: "CAPABILITY_UNAVAILABLE", message: `No executor for node type: ${node.type}` },
          }),
          results: appendCapabilityUnavailableResult({ taskId: input.taskId, state, node, now }),
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

      state = {
        ...state,
        attempts: updateAttemptStatus({
          attempts: state.attempts,
          attemptId: attempt.id,
          status: result.status === "failed" || result.status === "blocked" ? "failed" : "succeeded",
          finishedAt,
          error:
            result.status === "failed"
              ? { code: "NODE_FAILED", message: result.error }
              : result.status === "blocked"
                ? { code: "NODE_BLOCKED", message: result.reason }
                : undefined,
        }),
        results: appendExecutionResult({ taskId: input.taskId, state, node, attempt, result, now }),
      };

      const eventType = getEventType(result);
      if (eventType) {
        await input.callbacks.onEvent?.({ type: eventType, node, result } as GraphExecutionEvent);
      }
      await input.callbacks.onStateChange?.(state);

      if (result.status === "failed") {
        const failedEffective = resolveEffectivePlanGraph(state);
        return {
          status: "blocked",
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

function unsupportedDispatchOutcome(input: {
  command: GraphRuntimeCommand;
  reason: string;
  events: GraphExecutionEvent[];
}): GraphDispatchOutcome {
  const effective = resolveEffectivePlanGraph(input.command.state);
  return {
    status: "unsupported",
    currentNodeId: null,
    executedNodeIds: [],
    effective,
    state: input.command.state,
    events: [
      ...input.events,
      { type: "command_unsupported", command: input.command, reason: input.reason },
    ],
    message: input.reason,
  };
}

function validationFailureOutcome(input: {
  command: GraphRuntimeCommand;
  state: GraphExecutionState;
  events: GraphExecutionEvent[];
  issues: string[];
}): GraphDispatchOutcome {
  return {
    status: "blocked",
    currentNodeId: null,
    executedNodeIds: [],
    effective: resolveEffectivePlanGraph(input.state),
    state: input.state,
    events: [
      ...input.events,
      { type: "command_validation_failed", command: input.command, issues: input.issues },
    ],
    message: `Graph validation failed: ${input.issues.join("; ")}`,
  };
}

function validateCommandGraphState(input: {
  command: GraphRuntimeCommand;
  state: GraphExecutionState;
  events: GraphExecutionEvent[];
}): GraphDispatchOutcome | null {
  const result = validatePlanGraph(input.state.graph);
  const errors = result.issues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) {
    return null;
  }

  return validationFailureOutcome({
    command: input.command,
    state: input.state,
    events: input.events,
    issues: errors.map((issue) => `${issue.code}: ${issue.message}`),
  });
}

function getExecutorName(node: EffectivePlanNode): string | undefined {
  const metadataName = node.definition.metadata?.executorName;
  if (typeof metadataName === "string") return metadataName;
  if (node.executor) return node.executor;
  return node.type;
}

function createRegistryExecutor<TContext>(
  options: GraphRuntimeOptions<TContext>,
): GraphNodeExecutor<TContext> {
  return async (input) => {
    const executorName = getExecutorName(input.node);
    const executor = executorName ? options.executors?.[executorName] : undefined;
    if (executor) return executor(input);
    return options.callbacks?.executeNode?.(input) ?? null;
  };
}

function approveCurrentNodeResult(input: {
  state: GraphExecutionState;
  nodeId: string;
  approved: boolean;
  feedback?: string;
  reviewedAt: string;
}): GraphExecutionState {
  return {
    ...input.state,
    results: input.state.results.map((result) => {
      if (result.nodeId !== input.nodeId || result.status !== "current") return result;
      if (!result.review && !result.waitKind) return result;
      return {
        ...result,
        status: input.approved ? "obsolete" : "rejected",
        waitKind: undefined,
        review: {
          required: true,
          status: input.approved ? "accepted" : "rejected",
          feedback: input.feedback,
          reviewedAt: input.reviewedAt,
        },
      };
    }),
  };
}

function retryNodeState(input: {
  state: GraphExecutionState;
  nodeId: string;
  reason: string;
  finishedAt: string;
}): GraphExecutionState {
  return {
    ...input.state,
    attempts: input.state.attempts.map((attempt) =>
      attempt.nodeId === input.nodeId && attempt.status === "running"
        ? {
            ...attempt,
            status: "cancelled",
            finishedAt: input.finishedAt,
            error: { code: "RETRY_REQUESTED", message: input.reason },
          }
        : attempt,
    ),
    results: markNodeResults(input.state.results, input.nodeId, "obsolete"),
  };
}

function cancelSessionState(input: {
  state: GraphExecutionState;
  reason: string;
  finishedAt: string;
}): GraphExecutionState {
  return {
    ...input.state,
    graph: { ...input.state.graph, status: "cancelled", updatedAt: input.finishedAt },
    attempts: input.state.attempts.map((attempt) =>
      attempt.status === "running"
        ? {
            ...attempt,
            status: "cancelled",
            finishedAt: input.finishedAt,
            error: { code: "EXECUTION_CANCELLED", message: input.reason },
          }
        : attempt,
    ),
    results: input.state.results.map((result) =>
      result.status === "current" ? { ...result, status: "obsolete" } : result,
    ),
  };
}

function syncExternalResultState(input: {
  taskId: string;
  state: GraphExecutionState;
  externalResult: GraphExternalSyncResult;
  syncedAt: string;
}): GraphExecutionState {
  const effective = resolveEffectivePlanGraph(input.state);
  const node = effective.nodes.find((candidate) => candidate.id === input.externalResult.nodeId);
  const currentAttempt = [...input.state.attempts]
    .reverse()
    .find((attempt) => attempt.nodeId === input.externalResult.nodeId && attempt.status === "running");
  const baseResult = {
    id: `result_${input.state.graph.id}_${input.externalResult.nodeId}_${input.syncedAt}`,
    taskId: input.taskId,
    graphId: input.state.graph.id,
    nodeId: input.externalResult.nodeId,
    nodeLayerId: node?.activeLayerId ?? undefined,
    attemptId: currentAttempt?.id,
  } satisfies NodeResult;
  let syncedResult: NodeResult;
  let attemptStatus: NodeAttempt["status"] | null = null;
  let attemptError: NodeAttempt["error"] | undefined;

  switch (input.externalResult.status) {
    case "done":
      syncedResult = {
        ...baseResult,
        status: "current",
        outputSummary: input.externalResult.summary,
        selectedBranch: input.externalResult.selectedBranch,
      };
      attemptStatus = "succeeded";
      break;
    case "failed":
      syncedResult = { ...baseResult, status: "rejected", error: input.externalResult.error };
      attemptStatus = "failed";
      attemptError = { code: "EXTERNAL_RESULT_FAILED", message: input.externalResult.error };
      break;
    case "blocked":
      syncedResult = {
        ...baseResult,
        status: "current",
        waitKind: "manual_action",
        error: input.externalResult.reason,
      };
      attemptStatus = "failed";
      attemptError = { code: "EXTERNAL_RESULT_BLOCKED", message: input.externalResult.reason };
      break;
    case "cancelled":
      syncedResult = {
        ...baseResult,
        status: "rejected",
        error: input.externalResult.reason ?? "External work cancelled",
      };
      attemptStatus = "cancelled";
      attemptError = {
        code: "EXTERNAL_RESULT_CANCELLED",
        message: input.externalResult.reason ?? "External work cancelled",
      };
      break;
  }

  return {
    ...input.state,
    attempts:
      currentAttempt && attemptStatus
        ? updateAttemptStatus({
            attempts: input.state.attempts,
            attemptId: currentAttempt.id,
            status: attemptStatus,
            finishedAt: input.syncedAt,
            error: attemptError,
          })
        : input.state.attempts,
    results: appendCurrentResult({ results: input.state.results, result: syncedResult }),
  };
}

export function createGraphRuntime<TContext = unknown>(
  options: GraphRuntimeOptions<TContext>,
): GraphRuntime<TContext> {
  return {
    async dispatch(command) {
      const events: GraphExecutionEvent[] = [{ type: "command_received", command }];
      if (options.policies?.validateGraph !== false) {
        const validationFailure = validateCommandGraphState({
          command,
          state: command.state,
          events,
        });
        if (validationFailure) {
          return validationFailure;
        }
      }
      const callbacks: GraphExecutionCallbacks<TContext> = {
        executeNode: createRegistryExecutor(options),
        onStateChange: options.callbacks?.onStateChange,
        onEvent: async (event) => {
          events.push(event);
          await options.callbacks?.onEvent?.(event);
        },
      };

      switch (command.type) {
        case "start": {
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger,
            state: command.state,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
        case "resume_with_input": {
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger ?? "manual",
            state: command.state,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            forcedNodeId: command.input.nodeId,
            userInput: command.input.value,
            forcedReplaceStatus: command.input.replaceStatus,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
        case "resume_after_unblock": {
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger ?? "manual",
            state: command.state,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            forcedNodeId: command.nodeId,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
        case "resume_with_approval": {
          const reviewedAt = new Date(options.now?.() ?? Date.now()).toISOString();
          const approvedState = approveCurrentNodeResult({
            state: command.state,
            nodeId: command.input.nodeId,
            approved: command.input.approved,
            feedback: command.input.feedback,
            reviewedAt,
          });
          if (!command.input.approved) {
            const effective = resolveEffectivePlanGraph(approvedState);
            return {
              status: "blocked",
              currentNodeId: command.input.nodeId,
              executedNodeIds: [],
              effective,
              state: approvedState,
              events,
              waitKind: "review",
              message: command.input.feedback ?? "Approval rejected",
            };
          }
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger ?? "manual",
            state: approvedState,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            forcedNodeId: command.input.nodeId,
            userInput: command.input.feedback,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
        case "retry_node": {
          const maxAttempts = options.policies?.retry?.maxAttempts;
          const attemptCount = command.state.attempts.filter(
            (attempt) => attempt.nodeId === command.nodeId,
          ).length;
          if (maxAttempts !== undefined && attemptCount >= maxAttempts) {
            const effective = resolveEffectivePlanGraph(command.state);
            return {
              status: "blocked",
              currentNodeId: command.nodeId,
              executedNodeIds: [],
              effective,
              state: command.state,
              events,
              message: `Retry limit reached for node ${command.nodeId}: ${attemptCount}/${maxAttempts}`,
            };
          }
          const retryState = retryNodeState({
            state: command.state,
            nodeId: command.nodeId,
            reason: command.reason ?? "Retry requested",
            finishedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
          });
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger ?? "manual",
            state: retryState,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            forcedNodeId: command.nodeId,
            userInput: command.userInput,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
        case "cancel_session": {
          const cancelledState = cancelSessionState({
            state: command.state,
            reason: command.reason ?? "Session cancelled",
            finishedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
          });
          return {
            status: "cancelled",
            currentNodeId: null,
            executedNodeIds: [],
            effective: resolveEffectivePlanGraph(cancelledState),
            state: cancelledState,
            events,
            message: command.reason ?? "Session cancelled",
          };
        }
        case "apply_mutation": {
          const mutationResult = applyGraphMutation({
            graph: command.state.graph,
            operations: command.mutation.operations,
            reason: command.mutation.reason,
            now: new Date(options.now?.() ?? Date.now()).toISOString(),
          });
          events.push({
            type: "graph_mutation_applied",
            mutationId: mutationResult.mutation.id,
            affectedNodeIds: mutationResult.mutation.affectedNodeIds,
          });
          let state = { ...command.state, graph: mutationResult.graph };
          if (command.mutation.invalidateDownstream) {
            state = applyDownstreamInvalidation({
              state,
              mutationId: mutationResult.mutation.id,
              plan: planDownstreamInvalidation({
                graph: mutationResult.graph,
                changedNodeIds: mutationResult.mutation.affectedNodeIds,
                reason: command.mutation.reason,
              }),
              now: mutationResult.mutation.createdAt,
            });
          }
          const effective = resolveEffectivePlanGraph(state);
          return {
            status: mapTerminalReasonToGraphStatus(effective),
            currentNodeId: null,
            executedNodeIds: [],
            effective,
            state,
            events,
            message: `Graph mutation applied: ${mutationResult.mutation.id}`,
          };
        }
        case "sync_external_result": {
          const syncedAt = new Date(options.now?.() ?? Date.now()).toISOString();
          const syncedState = syncExternalResultState({
            taskId: options.taskId,
            state: command.state,
            externalResult: command.externalResult,
            syncedAt,
          });
          events.push({
            type: "external_result_synced",
            nodeId: command.externalResult.nodeId,
            status: command.externalResult.status,
          });
          if (command.externalResult.status !== "done") {
            const effective = resolveEffectivePlanGraph(syncedState);
            const waitKind = command.externalResult.status === "blocked" ? "manual_action" : undefined;
            return {
              status: command.externalResult.status === "blocked" ? "blocked" : "blocked",
              currentNodeId: command.externalResult.nodeId,
              executedNodeIds: [],
              effective,
              state: syncedState,
              events,
              waitKind,
              message:
                command.externalResult.status === "failed"
                  ? command.externalResult.error
                  : command.externalResult.status === "cancelled"
                    ? (command.externalResult.reason ?? "External work cancelled")
                    : command.externalResult.reason,
            };
          }
          const outcome = await runGraphExecution({
            taskId: options.taskId,
            runtimeName: options.runtimeName,
            trigger: command.trigger ?? "system",
            state: syncedState,
            context: command.context as TContext,
            maxSteps: options.policies?.maxSteps,
            maxConcurrency: options.policies?.maxConcurrency,
            now: options.now,
            callbacks,
          });
          return { ...outcome, events };
        }
      }
    },
  };
}
