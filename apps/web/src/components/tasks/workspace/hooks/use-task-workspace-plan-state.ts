import { startTransition, useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/rpc-client";
import { taskPlanReadModelToGraphPlan } from "@/components/tasks/plan/task-plan-view-model";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { dispatchTaskExecutionAction, fetchCurrentTaskExecution, fetchTaskPlanState, submitTaskCheckpointAction, taskWorkspaceQueryKeys, type TaskPlanState } from "../../../../../../../features/task-workspace";
import { stopTaskPlanGenerationSession, useTaskPlanGenerationSession, type TaskPlanSessionState } from "@/hooks/ai/task-plan-generation-session-store";
import {
  canAcceptPlanFromFlow,
  clearPlanFlowError,
  completePlanAccept,
  createPlanFlowFromSnapshot,
  failPlanAccept,
  getAcceptPlanErrorFromFlow,
  getPlanGenerationStatusFromFlow,
  isAcceptingPlanFromFlow,
  startPlanAccept,
} from "../../../../../../../features/task-workspace";
import type { TaskData } from "../../../../../../../features/task-workspace";
import type { ExecutionActionInput, ExecutionCheckpoint, PlanExecutionResult, PlanExecutionSSEEvent, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import type { TaskWorkspaceSseEvent } from "./use-task-workspace-page-state";
import { mergeWorkspaceActivity, workspaceEventToWorkspaceActivity } from "../../../../../../../features/task-workspace";
import type { WorkspaceActivityItem } from "../../../../../../../features/task-workspace";

const STARTING_NODE_STATUS_LABEL = "Starting";
const STARTING_NODE_NEXT_ACTION = "Starting execution...";

export type WorkspaceRuntimeEvent = Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>;
type WorkspaceRuntimeTextEvent = WorkspaceRuntimeEvent & { event: Extract<WorkspaceRuntimeEvent["event"], { type: "assistant_text_delta" | "reasoning_delta" }> };
type WorkspaceExecutionRuntimeSseEvent = TaskWorkspaceSseEvent & Omit<WorkspaceRuntimeEvent, "type"> & { type: "execution.runtime_event" };
export type PlanGenerationRequest = { userInstruction?: string | null };

function compactActivityText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 96);
}

function getRuntimeActivity(event: WorkspaceRuntimeEvent | undefined) {
  if (!event) return null;

  const value = event.event;
  switch (value.type) {
    case "assistant_text_delta":
    case "reasoning_delta":
      return compactActivityText(value.text);
    case "tool_started":
      return compactActivityText(`Running ${value.label}`);
    case "tool_completed":
      return compactActivityText(value.error ? `${value.label} failed` : `${value.label} completed`);
    case "approval_required":
      return "Approval required";
    case "run_status":
      return compactActivityText(value.message ?? value.status);
    case "raw_event":
      return compactActivityText(value.rawEventType ?? "Runtime event");
  }
}

function isRuntimeTextDelta(event: WorkspaceRuntimeEvent): event is WorkspaceRuntimeTextEvent {
  return event.event.type === "assistant_text_delta" || event.event.type === "reasoning_delta";
}

function runtimeTextMergeKey(event: WorkspaceRuntimeEvent) {
  return [
    event.event.type,
    event.action,
    event.runId ?? "run",
    event.nodeId ?? "node",
    event.runtimeName,
    event.provider,
  ].join(":");
}

export function appendRuntimeEvent(events: WorkspaceRuntimeEvent[], event: WorkspaceRuntimeEvent) {
  const previous = events.at(-1);
  if (previous && isRuntimeTextDelta(previous) && isRuntimeTextDelta(event) && runtimeTextMergeKey(previous) === runtimeTextMergeKey(event)) {
    return [
      ...events.slice(0, -1),
      {
        ...event,
        sequence: previous.sequence,
        timestamp: event.timestamp ?? previous.timestamp,
        event: {
          ...event.event,
          text: `${previous.event.text}${event.event.text}`,
        },
      } satisfies WorkspaceRuntimeEvent,
    ];
  }

  return [...events, event];
}

function isFullRuntimeSseEvent(event: TaskWorkspaceSseEvent): event is WorkspaceExecutionRuntimeSseEvent {
  return event.type === "execution.runtime_event"
    && "event" in event
    && typeof event.event === "object"
    && event.event !== null
    && "runtimeName" in event
    && typeof event.runtimeName === "string"
    && "provider" in event
    && typeof event.provider === "string";
}

function shouldRefreshExecutionSnapshot(event: TaskWorkspaceSseEvent) {
  return event.type === "execution.state.updated"
    || event.type === "execution.result"
    || event.type === "checkpoint.result"
    || event.type === "task_workspace_updated"
    || event.type === "task_projection_updated";
}

function activitySummaryFromPhase(phase: TaskPlanSessionState["phase"]): string {
  switch (phase) {
    case "starting":
    case "loading_task":
    case "requesting_provider":
    case "streaming":
    case "extracting_tool_payload":
    case "compiling":
    case "saving":
      return "Generating plan";
    case "completed":
      return "Plan updated";
    case "error":
    case "done":
      return "Plan generation failed";
    case "idle":
    case "connecting":
      return "Plan ready";
  }
}

function derivePlanStatus(savedPlan: TaskData["savedPlan"] | null, isGenerationRunning: boolean) {
  if (isGenerationRunning) {
    return "generating" as const;
  }

  if (savedPlan?.status === "accepted") {
    return "accepted" as const;
  }

  return savedPlan ? "waiting_acceptance" as const : "idle" as const;
}

function comparePlanUpdatedAt(
  pagePlan: NonNullable<TaskData["savedPlan"]>,
  planStatePlan: NonNullable<TaskData["savedPlan"]>,
) {
  const pageUpdatedAt = Date.parse(pagePlan.updatedAt);
  const planStateUpdatedAt = Date.parse(planStatePlan.updatedAt);
  if (!Number.isFinite(pageUpdatedAt) || !Number.isFinite(planStateUpdatedAt)) return 0;
  return Math.sign(pageUpdatedAt - planStateUpdatedAt);
}

function selectAcceptedPlan(
  pagePlan: NonNullable<TaskData["savedPlan"]>,
  planStatePlan: NonNullable<TaskData["savedPlan"]>,
) {
  if (planStatePlan.status === "accepted" && pagePlan.status !== "accepted") return planStatePlan;
  if (pagePlan.status === "accepted" && planStatePlan.status !== "accepted") return pagePlan;
  return undefined;
}

/**
 * Reconciles the "true" saved plan from two async sources that can disagree:
 * the page query (`task.savedPlan`) and the plan-state query (`planFlow.savedPlan`).
 * Precedence:
 *   1. If only one side has a plan, use it.
 *   2. Different plan ids → trust the plan-state query (the plan-scoped endpoint
 *      is authoritative for which plan is current).
 *   3. Same id → newer `updatedAt` wins.
 *   4. updatedAt tie → prefer whichever side is `accepted`; otherwise honor
 *      `preferPagePlanOnTie` (page query wins) else the plan-state query.
 * Keep this aligned with the work-block scope resolution: both queries are keyed
 * by the same `selectedWorkBlockId`, so this never mixes plans across work blocks.
 */
function selectWorkspacePlan(
  pagePlan: TaskData["savedPlan"] | null | undefined,
  planStatePlan: TaskData["savedPlan"] | null | undefined,
  options: { preferPagePlanOnTie?: boolean } = {},
) {
  if (!pagePlan) return planStatePlan ?? null;
  if (!planStatePlan) return pagePlan;
  if (pagePlan.id !== planStatePlan.id) return planStatePlan;

  const updatedAtOrder = comparePlanUpdatedAt(pagePlan, planStatePlan);
  if (updatedAtOrder < 0) return planStatePlan;
  if (updatedAtOrder > 0) return pagePlan;

  const acceptedPlan = selectAcceptedPlan(pagePlan, planStatePlan);
  if (acceptedPlan) return acceptedPlan;
  if (options.preferPagePlanOnTie) return pagePlan;

  return planStatePlan;
}

function checkpointActionEmphasis(style: ExecutionCheckpoint["availableActions"][number]["style"]) {
  if (style === "primary") return "primary" as const;
  if (style === "danger") return "danger" as const;
  return "default" as const;
}

function checkpointActionKind(actionId: ExecutionCheckpoint["availableActions"][number]["id"]) {
  if (actionId === "retry_node") return "retry" as const;
  if (actionId === "resume_after_unblock") return "resolve" as const;
  if (actionId === "cancel_session" || actionId === "fail_task") return "trigger" as const;
  return "input" as const;
}

function checkpointFormFields(checkpoint: ExecutionCheckpoint) {
  return checkpoint.form?.inputFields.map((field) => ({
    key: field.name,
    label: field.label,
    value: field.value ?? "",
    control: field.type === "select" ? "select" as const : field.type === "text" ? "text" as const : "textarea" as const,
    required: field.required,
    options: field.options,
  })) ?? [];
}

function withCanonicalExecutionActions(graphPlan: TaskPlanGraphPlan | null, checkpoint: ExecutionCheckpoint | null) {
  if (!graphPlan) return graphPlan;

  const clearNode = (node: TaskPlanGraphPlan["nodes"][number]) => ({
    ...node,
    checkpoint: undefined,
    availableActions: [],
    interactiveFields: [],
    actionable: false,
  });

  if (!checkpoint?.nodeId) {
    return {
      ...graphPlan,
      nodes: graphPlan.nodes.map(clearNode),
      steps: graphPlan.steps.map(clearNode),
    } satisfies TaskPlanGraphPlan;
  }

  const decorateNode = (node: TaskPlanGraphPlan["nodes"][number]) => {
    const clearedNode = clearNode(node);
    if (node.id !== checkpoint.nodeId) return clearedNode;
    const actions = checkpoint.availableActions.map((action) => ({
      id: action.id,
      label: action.label,
      kind: checkpointActionKind(action.id),
      emphasis: checkpointActionEmphasis(action.style),
      checkpointId: checkpoint.id,
      checkpointAction: action.id,
      requiresPayload: action.requiresPayload,
    }));
    return {
      ...clearedNode,
      checkpoint,
      nextAction: checkpoint.message || node.nextAction,
      interactiveFields: checkpointFormFields(checkpoint),
      availableActions: actions,
      actionable: actions.length > 0,
    };
  };

  return {
    ...graphPlan,
    nodes: graphPlan.nodes.map(decorateNode),
    steps: graphPlan.steps.map(decorateNode),
  } satisfies TaskPlanGraphPlan;
}

function hasExecutionStartEvidence(currentExecution: PlanExecutionResult) {
  return Boolean(currentExecution.executionSessionId || currentExecution.planRunId);
}

function withStartingReadyNode(graphPlan: TaskPlanGraphPlan | null, currentExecution: PlanExecutionResult | null) {
  if (!graphPlan || !currentExecution) return graphPlan;
  if (currentExecution.status !== "running" && currentExecution.status !== "started") return graphPlan;
  if (!hasExecutionStartEvidence(currentExecution)) return graphPlan;
  if (graphPlan.nodes.some((node) => node.status === "active" || node.status === "in_progress")) return graphPlan;

  const startingNodeId = currentExecution.currentNodeId
    ?? graphPlan.currentStepId
    ?? graphPlan.nodes.find((node) => node.status === "ready")?.id
    ?? null;
  if (!startingNodeId) return graphPlan;

  const target = graphPlan.nodes.find((node) => node.id === startingNodeId);
  if (!target || target.status !== "ready") return graphPlan;

  const decorateNode = (node: TaskPlanGraphPlan["nodes"][number]) => {
    if (node.id !== startingNodeId) return node;
    return {
      ...node,
      status: "active" as const,
      group: "active" as const,
      statusLabel: STARTING_NODE_STATUS_LABEL,
      nextAction: STARTING_NODE_NEXT_ACTION,
      interactionType: "observe" as const,
      active: true,
      actionable: false,
      availableActions: [],
      metadata: {
        ...node.metadata,
        launchState: "starting",
      },
    } satisfies TaskPlanGraphPlan["nodes"][number];
  };
  const activeNodeIds = Array.from(new Set([startingNodeId, ...graphPlan.analytics.activeNodeIds]));

  return {
    ...graphPlan,
    nodes: graphPlan.nodes.map(decorateNode),
    steps: graphPlan.steps.map(decorateNode),
    currentStepId: startingNodeId,
    analytics: {
      ...graphPlan.analytics,
      activeNodeIds,
      reachableFromActiveIds: Array.from(new Set([startingNodeId, ...graphPlan.analytics.reachableFromActiveIds])),
    },
  } satisfies TaskPlanGraphPlan;
}

function samePlanFlowSnapshot(
  left: ReturnType<typeof createPlanFlowFromSnapshot>,
  right: ReturnType<typeof createPlanFlowFromSnapshot>,
) {
  if (left.status !== right.status || left.savedPlan !== right.savedPlan) {
    return false;
  }

  if (left.status === "accepting" && right.status === "accepting") {
    return left.planId === right.planId;
  }

  if (left.status === "failed" && right.status === "failed") {
    return left.planId === right.planId && left.error === right.error;
  }

  return true;
}

type WorkspaceCommandAck = {
  commandId: string;
  taskId: string;
  acceptedAt: string;
};

async function dispatchWorkspaceCommand(taskId: string, body: Record<string, unknown>) {
  const response = await api.work[":taskId"].commands.$post({
    param: { taskId },
    json: body as never,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to dispatch workspace command" }));
    throw new Error((err as { error?: string }).error ?? "Failed to dispatch workspace command");
  }

  return await response.json() as unknown as WorkspaceCommandAck;
}

function isWorkspaceEventInSelectedScope(event: TaskWorkspaceSseEvent, selectedWorkBlockId: string | null) {
  return (event.workBlockId ?? null) === selectedWorkBlockId;
}

export function useTaskWorkspacePlanState(
  task: TaskData,
  refreshWorkspace: () => Promise<void>,
  workspaceEvents: TaskWorkspaceSseEvent[] = [],
) {
  const queryClient = useQueryClient();
  const selectedWorkBlockId = task.currentWorkBlock?.id ?? null;
  const selectedWorkBlockKey = selectedWorkBlockId ?? "__task__";
  const previousWorkBlockKeyRef = useRef(selectedWorkBlockKey);
  const lastWorkspaceEventSequenceRef = useRef(0);
  const planStateQuery = useQuery({
    queryKey: taskWorkspaceQueryKeys.planState(task.id, selectedWorkBlockId),
    queryFn: () => fetchTaskPlanState(task.id, selectedWorkBlockId),
    initialData: {
      taskId: task.id,
      aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
      savedPlan: task.savedPlan ?? null,
      generationSession: null,
    } satisfies TaskPlanState,
  });
  const currentExecutionQuery = useQuery({
    queryKey: taskWorkspaceQueryKeys.currentExecution(task.id, selectedWorkBlockId),
    queryFn: () => fetchCurrentTaskExecution(task.id, selectedWorkBlockId),
  });
  const planState = planStateQuery.data;
  const [generationUserInstruction, setGenerationUserInstruction] = useState<string | null>(null);
  // `isGeneratingPlan` flips to true when EITHER:
  //  (a) the shared `useTaskPlanGenerationSession` store — kept current by
  //      the workspace SSE pipeline — reports a running session, OR
  //  (b) the persisted `/api/tasks/:taskId/plan` snapshot reports
  //      `aiPlanGenerationStatus === "generating"`.
  // Source (b) is the only signal that survives a hard page refresh. The
  // page loader and the `fetchTaskPlanState` query both read
  // `isTaskPlanGenerationRunning` on the server, so the moment a generation
  // is in flight the spec API surfaces "generating" — the button must
  // honour it on the very first render after the refresh, before the SSE
  // snapshot or session-store hydrate has a chance to fire.
  const generationSession = useTaskPlanGenerationSession(task.id, selectedWorkBlockId);
  const isGeneratingPlan = generationSession.sessionStatus === "running"
    || planState?.aiPlanGenerationStatus === "generating";
  const generationActivitySummary = isGeneratingPlan
    ? (generationSession.statusMessage ?? activitySummaryFromPhase(generationSession.phase))
    : null;
  const [planFlow, setPlanFlow] = useState(() => createPlanFlowFromSnapshot(planStateQuery.data));
  const [runtimeEvents, setRuntimeEvents] = useState<WorkspaceRuntimeEvent[]>([]);
  const [liveActivity, setLiveActivity] = useState<WorkspaceActivityItem[]>([]);
  const currentExecution = currentExecutionQuery.data ?? null;
  const latestCheckpoint = currentExecution?.checkpoint ?? null;
  const latestActivitySummary = getRuntimeActivity(runtimeEvents.at(-1)) ?? generationActivitySummary;
  const [graphPlan, setGraphPlan] = useState(() => taskPlanReadModelToGraphPlan(null));
  const [isGraphPlanPending, setIsGraphPlanPending] = useState(false);

  useEffect(() => {
    if (previousWorkBlockKeyRef.current === selectedWorkBlockKey) return;
    previousWorkBlockKeyRef.current = selectedWorkBlockKey;
    lastWorkspaceEventSequenceRef.current = 0;
    setGenerationUserInstruction(null);
    setRuntimeEvents([]);
    setLiveActivity([]);
    setPlanFlow(createPlanFlowFromSnapshot(planStateQuery.data));
  }, [planStateQuery.data, selectedWorkBlockKey]);

  useEffect(() => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.planState(task.id, selectedWorkBlockId), (current: TaskPlanState | undefined) => {
      const previous = current ?? {
        taskId: task.id,
        aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
        savedPlan: null,
        generationSession: null,
      } satisfies TaskPlanState;
      const nextPlan = selectWorkspacePlan(task.savedPlan, previous.savedPlan, { preferPagePlanOnTie: true });

      return {
        ...previous,
        savedPlan: nextPlan,
        aiPlanGenerationStatus: derivePlanStatus(nextPlan, previous.generationSession?.status === "running"),
      } satisfies TaskPlanState;
    });
  }, [queryClient, task.aiPlanGenerationStatus, task.id, task.savedPlan]);

  useEffect(() => {
    if (!planState) return;
    const selectedSavedPlan = selectWorkspacePlan(task.savedPlan, planState.savedPlan);
    const nextPlanState = {
      ...planState,
      savedPlan: selectedSavedPlan,
      aiPlanGenerationStatus: derivePlanStatus(selectedSavedPlan, isGeneratingPlan),
    } satisfies TaskPlanState;
    const nextPlanFlow = createPlanFlowFromSnapshot(nextPlanState);
    setPlanFlow((current) => {
      if (current.status === "accepting" || samePlanFlowSnapshot(current, nextPlanFlow)) {
        return current;
      }
      return nextPlanFlow;
    });
  }, [isGeneratingPlan, planState, task.savedPlan]);

  const plan = selectWorkspacePlan(task.savedPlan, planFlow.savedPlan);
  const planGenerationStatus = isGeneratingPlan ? "generating" : getPlanGenerationStatusFromFlow(planFlow);

  useEffect(() => {
    const nextEvents = workspaceEvents.filter((event) => (event.sequence ?? 0) > lastWorkspaceEventSequenceRef.current);
    if (nextEvents.length === 0) return;

    lastWorkspaceEventSequenceRef.current = Math.max(
      lastWorkspaceEventSequenceRef.current,
      ...nextEvents.map((event) => event.sequence ?? 0),
    );

    for (const event of nextEvents) {
      if (!isWorkspaceEventInSelectedScope(event, selectedWorkBlockId)) continue;
      const activityItem = workspaceEventToWorkspaceActivity(event, event.sequence ?? 0, new Date().toISOString());
      if (activityItem) {
        setLiveActivity((current) => mergeWorkspaceActivity([activityItem, ...current]));
      }

      // `command.accepted` / `command.failed` flow through the
      // `useTaskPlanGenerationSession` store. `plan.generation.event` still
      // needs a workspace-plan refetch here because the session store
      // surfaces the activity summary and final `result`, while the
      // workspace plan / plan-state pair on the server is the source of
      // truth for the rendered plan graph and the plan-state query used
      // by callers (e.g. the editor). Without the refetch, a generated
      // plan that finishes outside the AI panel would never appear in
      // the workspace.
      if (event.type === "plan.generation.event") {
        void planStateQuery.refetch();
        return;
      }

      if (event.type === "execution.runtime_event" && isFullRuntimeSseEvent(event)) {
        const runtimeEvent: WorkspaceRuntimeEvent = { ...event, type: "runtime_event" };
        setRuntimeEvents((current) => appendRuntimeEvent(current, runtimeEvent));
      }


      if (shouldRefreshExecutionSnapshot(event)) {
        void currentExecutionQuery.refetch();
        void planStateQuery.refetch();
      }
    }
  }, [currentExecutionQuery, planStateQuery, selectedWorkBlockId, workspaceEvents]);

  useEffect(() => {
    if (!plan) {
      setGraphPlan(null);
      setIsGraphPlanPending(false);
      return;
    }

    let cancelled = false;
    setIsGraphPlanPending(true);
    const timeoutId = window.setTimeout(() => {
      const nextGraphPlan = withStartingReadyNode(
        withCanonicalExecutionActions(taskPlanReadModelToGraphPlan(plan), latestCheckpoint),
        currentExecution,
      );
      if (cancelled) return;
      startTransition(() => {
        setGraphPlan(nextGraphPlan);
        setIsGraphPlanPending(false);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentExecution, latestCheckpoint, plan]);

  const setPlan = useCallback((value: SetStateAction<TaskData["savedPlan"] | null>) => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.planState(task.id, selectedWorkBlockId), (current: TaskPlanState | undefined) => {
      const previous = current ?? {
        taskId: task.id,
        aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
        savedPlan: task.savedPlan ?? null,
        generationSession: null,
      };
      const nextPlan = typeof value === "function"
        ? (value as (prevState: TaskData["savedPlan"] | null) => TaskData["savedPlan"] | null)(previous.savedPlan ?? null)
        : value;
      return {
        ...previous,
        savedPlan: nextPlan,
        aiPlanGenerationStatus: derivePlanStatus(nextPlan, previous.generationSession?.status === "running"),
      } satisfies TaskPlanState;
    });
  }, [queryClient, selectedWorkBlockId, task.aiPlanGenerationStatus, task.id, task.savedPlan]);

  const fetchPlan = useCallback(async () => {
    await planStateQuery.refetch();
  }, [planStateQuery]);

  const canAcceptPlan = canAcceptPlanFromFlow(planFlow);
  const acceptPlanError = getAcceptPlanErrorFromFlow(planFlow);

  const refreshExecutionQueries = useCallback(async () => {
    await Promise.all([
      currentExecutionQuery.refetch(),
      planStateQuery.refetch(),
      refreshWorkspace(),
    ]);
  }, [currentExecutionQuery, planStateQuery, refreshWorkspace]);

  const acceptPlanById = useCallback(async (planId: string) => {
    setPlanFlow((current) => startPlanAccept(clearPlanFlowError(current), planId));
    try {
      await dispatchWorkspaceCommand(task.id, { type: "plan.accept", planId, workBlockId: selectedWorkBlockId });
      setPlanFlow(completePlanAccept(plan));
      void refreshExecutionQueries();
    } catch (cause) {
      setPlanFlow((current) => failPlanAccept(current, planId, cause instanceof Error ? cause.message : "Failed to accept plan"));
    }
  }, [plan, refreshExecutionQueries, selectedWorkBlockId, task.id]);

  const handleAcceptPlan = useCallback(async () => {
    if (!plan?.id) return;
    await acceptPlanById(plan.id);
  }, [acceptPlanById, plan?.id]);

  const handleGeneratePlanFromHeader = useCallback((request?: PlanGenerationRequest) => {
    if (isGeneratingPlan) return;
    const userInstruction = request?.userInstruction?.trim() || null;
    setGenerationUserInstruction(userInstruction);
    void dispatchWorkspaceCommand(task.id, { type: "plan.generate", forceRefresh: true, workBlockId: selectedWorkBlockId, userInstruction });
  }, [isGeneratingPlan, selectedWorkBlockId, task.id]);

  const handleStopPlanGeneration = useCallback(async () => {
    await stopTaskPlanGenerationSession(task.id, selectedWorkBlockId);
    await planStateQuery.refetch();
  }, [planStateQuery, selectedWorkBlockId, task.id]);

  const dispatchExecutionAction = useCallback(async (action: ExecutionActionInput) => {
    setRuntimeEvents([]);
    const result = await dispatchTaskExecutionAction(task.id, action, selectedWorkBlockId);
    void refreshExecutionQueries();
    return result;
  }, [refreshExecutionQueries, selectedWorkBlockId, task.id]);

  const submitCheckpointAction = useCallback(async (action: SubmitCheckpointActionInput) => {
    setRuntimeEvents([]);
    const result = await submitTaskCheckpointAction(task.id, action, selectedWorkBlockId);
    void refreshExecutionQueries();
    return result;
  }, [refreshExecutionQueries, selectedWorkBlockId, task.id]);

  const assistantBuildCurrentPlan = useCallback(() => {
    if (!plan?.compiledPlan) return null;
    const compiledPlan = plan.compiledPlan;
    const deps = new Map<string, string[]>();
    for (const edge of compiledPlan.edges) {
      if (!deps.has(edge.to)) deps.set(edge.to, []);
      deps.get(edge.to)?.push(edge.from);
    }
    return {
      id: compiledPlan.id,
      status: "draft" as const,
      revision: compiledPlan.sourceVersion,
      summary: compiledPlan.goal,
      nodes: compiledPlan.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        objective: node.description ?? "",
        description: node.description ?? null,
        status: "pending" as const,
        estimatedMinutes: node.estimatedMinutes ?? null,
        priority: node.priority ?? null,
        executionMode: node.mode ?? "automatic",
        dependsOn: deps.get(node.id) ?? [],
      })),
      edges: compiledPlan.edges.map((edge) => ({
        id: edge.id,
        fromNodeId: edge.from,
        toNodeId: edge.to,
        type: "sequential",
      })),
    };
  }, [plan]);

  const setAcceptPlanError = useCallback((value: SetStateAction<string | null>) => {
    setPlanFlow((current) => {
      const nextError = typeof value === "function"
        ? value(getAcceptPlanErrorFromFlow(current))
        : value;

      if (!nextError) {
        return clearPlanFlowError(current);
      }

      return failPlanAccept(current, current.savedPlan?.id ?? "unknown", nextError);
    });
  }, []);

  return {
    plan,
    setPlan,
    fetchPlan,
    planGenerationStatus,
    planFlowStatus: planFlow.status,
    graphPlan,
    isGraphPlanPending,
    canAcceptPlan,
    isAcceptingPlan: isAcceptingPlanFromFlow(planFlow),
    acceptPlanError,
    setAcceptPlanError,
    generationUserInstruction,
    runtimeEvents,
    liveActivity,
    latestActivitySummary,
    currentExecution,
    acceptPlanById,
    handleAcceptPlan,
    dispatchExecutionAction,
    submitCheckpointAction,
    handleGeneratePlanFromHeader,
    handleStopPlanGeneration,
    assistantBuildCurrentPlan,
  };
}
