import { startTransition, useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskPlanReadModelToGraphPlan } from "@/components/tasks/plan/task-plan-view-model";
import type { TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import { startTaskPlanGenerationSession, useTaskPlanGenerationSession } from "@/hooks/ai/task-plan-generation-session-store";
import { api } from "@/lib/rpc-client";
import { dispatchTaskExecutionAction, fetchCurrentTaskExecution, fetchTaskPlanState, submitTaskCheckpointAction, taskWorkspaceQueryKeys, type TaskExecutionDispatchResult, type TaskPlanState } from "../model/task-workspace-query";
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
} from "../model/task-workspace-plan-flow-machine";
import type { TaskData, TaskPageData } from "../model/task-workspace-types";
import type { ExecutionActionInput, ExecutionCheckpoint, PlanExecutionSSEEvent, SubmitCheckpointActionInput } from "@chrona/contracts/ai";

export type WorkspaceRuntimeEvent = Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>;
export type PlanGenerationRequest = { userInstruction?: string | null };

function compactActivityText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 96);
}

function getPlanGenerationActivity(generationSession: ReturnType<typeof useTaskPlanGenerationSession>) {
  if (generationSession.sessionStatus !== "running") return null;

  const latestToolResult = generationSession.toolResults.at(-1);
  if (latestToolResult) {
    return compactActivityText(`${latestToolResult.tool} completed`);
  }

  const latestToolCall = generationSession.toolCalls.at(-1);
  if (latestToolCall) {
    return compactActivityText(`Running ${latestToolCall.tool}`);
  }

  if (generationSession.statusMessage) {
    return compactActivityText(generationSession.statusMessage);
  }

  if (generationSession.partialText) {
    return compactActivityText(generationSession.partialText);
  }

  return "Generating plan";
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

function derivePlanStatus(savedPlan: TaskData["savedPlan"] | null, isGenerationRunning: boolean) {
  if (isGenerationRunning) {
    return "generating" as const;
  }

  if (savedPlan?.status === "accepted") {
    return "accepted" as const;
  }

  return savedPlan ? "waiting_acceptance" as const : "idle" as const;
}

function selectWorkspacePlan(
  pagePlan: TaskData["savedPlan"] | null | undefined,
  planStatePlan: TaskData["savedPlan"] | null | undefined,
) {
  if (!pagePlan) return planStatePlan ?? null;
  if (!planStatePlan) return pagePlan;
  if (pagePlan.id !== planStatePlan.id) return planStatePlan;

  const pageUpdatedAt = Date.parse(pagePlan.updatedAt ?? "");
  const planStateUpdatedAt = Date.parse(planStatePlan.updatedAt ?? "");
  if (Number.isFinite(pageUpdatedAt) && Number.isFinite(planStateUpdatedAt)) {
    if (planStateUpdatedAt > pageUpdatedAt) return planStatePlan;
    if (pageUpdatedAt > planStateUpdatedAt) return pagePlan;
  }

  if (planStatePlan.status === "accepted" && pagePlan.status !== "accepted") return planStatePlan;
  if (pagePlan.status === "accepted" && planStatePlan.status !== "accepted") return pagePlan;

  return planStatePlan;
}

function checkpointActionEmphasis(style: ExecutionCheckpoint["availableActions"][number]["style"]) {
  if (style === "primary") return "primary" as const;
  if (style === "danger") return "danger" as const;
  return "default" as const;
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
      kind: action.id === "retry_node" ? "retry" as const : action.id === "resume_after_unblock" ? "resolve" as const : "input" as const,
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

function withGeneratedPlanResult(
  planState: TaskPlanState,
  generatedPlan: TaskData["savedPlan"] | null | undefined,
) {
  if (!generatedPlan?.id) return planState;
  return {
    ...planState,
    savedPlan: generatedPlan,
    aiPlanGenerationStatus: derivePlanStatus(generatedPlan, false),
  } satisfies TaskPlanState;
}

function samePlanState(left: TaskPlanState, right: TaskPlanState) {
  return left.taskId === right.taskId
    && left.aiPlanGenerationStatus === right.aiPlanGenerationStatus
    && left.savedPlan === right.savedPlan
    && left.generationSession === right.generationSession;
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

export function useTaskWorkspacePlanState(task: TaskData, refreshWorkspace: () => Promise<void>) {
  const queryClient = useQueryClient();
  const generationSession = useTaskPlanGenerationSession(task.id);
  const previousGenerationStatusRef = useRef(generationSession.sessionStatus);
  const syncTaskDetailPlanFields = useCallback((nextPlanState: TaskPlanState) => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.page(task.id), (current: TaskPageData | undefined) => {
      if (!current) return current;
      return {
        ...current,
        task: {
          ...current.task,
          savedPlan: nextPlanState.savedPlan,
          aiPlanGenerationStatus: nextPlanState.aiPlanGenerationStatus,
        },
      } satisfies TaskPageData;
    });
  }, [queryClient, task.id]);
  const applyGeneratedPlanResult = useCallback((generatedPlan: TaskData["savedPlan"] | null) => {
    if (!generatedPlan?.id) return;

    const nextPlanState = queryClient.setQueryData<TaskPlanState>(
      taskWorkspaceQueryKeys.planState(task.id),
      (current: TaskPlanState | undefined) => ({
        taskId: task.id,
        aiPlanGenerationStatus: derivePlanStatus(generatedPlan, false),
        savedPlan: generatedPlan,
        generationSession: current?.generationSession ?? null,
      } satisfies TaskPlanState),
    );

    if (nextPlanState) {
      syncTaskDetailPlanFields(nextPlanState);
    }
  }, [queryClient, syncTaskDetailPlanFields, task.id]);

  const planStateQuery = useQuery({
    queryKey: taskWorkspaceQueryKeys.planState(task.id),
    queryFn: () => fetchTaskPlanState(task.id),
    initialData: {
      taskId: task.id,
      aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
      savedPlan: task.savedPlan ?? null,
      generationSession: null,
    } satisfies TaskPlanState,
  });
  const currentExecutionQuery = useQuery({
    queryKey: taskWorkspaceQueryKeys.currentExecution(task.id),
    queryFn: () => fetchCurrentTaskExecution(task.id),
  });
  const planState = planStateQuery.data;
  const [generationUserInstruction, setGenerationUserInstruction] = useState<string | null>(null);
  const [planFlow, setPlanFlow] = useState(() => createPlanFlowFromSnapshot(planStateQuery.data));
  const [runtimeEvents, setRuntimeEvents] = useState<WorkspaceRuntimeEvent[]>([]);
  const currentExecution = currentExecutionQuery.data ?? null;
  const latestCheckpoint = currentExecution?.checkpoint ?? null;
  const latestActivitySummary = getRuntimeActivity(runtimeEvents.at(-1)) ?? getPlanGenerationActivity(generationSession);
  const [graphPlan, setGraphPlan] = useState(() => taskPlanReadModelToGraphPlan(null));
  const [isGraphPlanPending, setIsGraphPlanPending] = useState(false);

  useEffect(() => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.planState(task.id), (current: TaskPlanState | undefined) => {
      const previous = current ?? {
        taskId: task.id,
        aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
        savedPlan: null,
        generationSession: null,
      } satisfies TaskPlanState;
      const nextPlan = selectWorkspacePlan(task.savedPlan, previous.savedPlan);

      return {
        ...previous,
        savedPlan: nextPlan,
        aiPlanGenerationStatus: derivePlanStatus(nextPlan, previous.generationSession?.status === "running"),
      } satisfies TaskPlanState;
    });
  }, [queryClient, task.aiPlanGenerationStatus, task.id, task.savedPlan]);

  useEffect(() => {
    if (!planState) return;
    const nextPlanState = withGeneratedPlanResult(planState, generationSession.result);
    if (samePlanState(planState, nextPlanState)) return;
    syncTaskDetailPlanFields(nextPlanState);
  }, [generationSession.result, planState, syncTaskDetailPlanFields]);

  useEffect(() => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.planState(task.id), (current: TaskPlanState | undefined) => {
      const previous = current ?? {
        taskId: task.id,
        aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
        savedPlan: task.savedPlan ?? null,
        generationSession: null,
      } satisfies TaskPlanState;

      return {
        ...previous,
        aiPlanGenerationStatus: derivePlanStatus(previous.savedPlan, generationSession.sessionStatus === "running"),
        generationSession:
          generationSession.generationId
            ? {
                generationId: generationSession.generationId,
                taskId: generationSession.taskId,
                status: generationSession.sessionStatus === "idle" ? "cancelled" : generationSession.sessionStatus,
                phase: generationSession.phase === "idle" || generationSession.phase === "connecting" || generationSession.phase === "done" || generationSession.phase === "error"
                  ? null
                  : generationSession.phase,
                statusMessage: generationSession.statusMessage,
                partialText: generationSession.partialText,
                result: generationSession.result,
                error: generationSession.error && generationSession.errorCode
                  ? { code: generationSession.errorCode, message: generationSession.error }
                  : null,
                startedAt: generationSession.startedAt ?? new Date(0).toISOString(),
                finishedAt: generationSession.finishedAt,
              }
            : null,
      } satisfies TaskPlanState;
    });
  }, [generationSession, queryClient, task.aiPlanGenerationStatus, task.id, task.savedPlan]);

  useEffect(() => {
    const previousStatus = previousGenerationStatusRef.current;
    previousGenerationStatusRef.current = generationSession.sessionStatus;

    if (!generationSession.hydrated || generationSession.sessionStatus === "running") {
      return;
    }

    // Only refresh persisted plan state once when an active generation session settles.
    if (previousStatus === "running") {
      applyGeneratedPlanResult(generationSession.result);
      void Promise.all([
        planStateQuery.refetch(),
        refreshWorkspace(),
      ]);
    }
  }, [applyGeneratedPlanResult, generationSession.hydrated, generationSession.result, generationSession.sessionStatus, planStateQuery.refetch, refreshWorkspace]);

  useEffect(() => {
    if (!planState) return;
    const generatedPlanState = withGeneratedPlanResult(planState, generationSession.result);
    const selectedSavedPlan = selectWorkspacePlan(task.savedPlan, generatedPlanState.savedPlan);
    const nextPlanState = {
      ...generatedPlanState,
      savedPlan: selectedSavedPlan,
      aiPlanGenerationStatus: derivePlanStatus(selectedSavedPlan, generationSession.sessionStatus === "running"),
    } satisfies TaskPlanState;
    const nextPlanFlow = createPlanFlowFromSnapshot(nextPlanState);
    setPlanFlow((current) => {
      if (current.status === "accepting" || samePlanFlowSnapshot(current, nextPlanFlow)) {
        return current;
      }
      return nextPlanFlow;
    });
  }, [generationSession.result, generationSession.sessionStatus, planState, task.savedPlan]);

  const plan = selectWorkspacePlan(task.savedPlan, planFlow.savedPlan);
  const planGenerationStatus = getPlanGenerationStatusFromFlow(planFlow);

  useEffect(() => {
    if (!plan) {
      setGraphPlan(null);
      setIsGraphPlanPending(false);
      return;
    }

    let cancelled = false;
    setIsGraphPlanPending(true);
    const timeoutId = window.setTimeout(() => {
        const nextGraphPlan = withCanonicalExecutionActions(taskPlanReadModelToGraphPlan(plan), latestCheckpoint);
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
  }, [latestCheckpoint, plan]);

  const setPlan = useCallback((value: SetStateAction<TaskData["savedPlan"] | null>) => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.planState(task.id), (current: TaskPlanState | undefined) => {
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
  }, [queryClient, task.aiPlanGenerationStatus, task.id, task.savedPlan]);

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

  const acceptPlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await api.tasks[":taskId"].plan.accept.$post({
        param: { taskId: task.id },
        json: { planId },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to accept plan" }));
        throw new Error((err as { error?: string }).error ?? "Failed to accept plan");
      }
      return await res.json() as { savedPlan?: TaskData["savedPlan"] | null };
    },
  });

  const acceptPlanById = useCallback(async (planId: string) => {
    setPlanFlow((current) => startPlanAccept(clearPlanFlowError(current), planId));
    try {
      const result = await acceptPlanMutation.mutateAsync(planId);
      const nextPlanState = queryClient.setQueryData<TaskPlanState>(
        taskWorkspaceQueryKeys.planState(task.id),
        (current: TaskPlanState | undefined) => {
          const savedPlan = result.savedPlan ?? current?.savedPlan ?? null;
          return {
            taskId: task.id,
            aiPlanGenerationStatus: derivePlanStatus(savedPlan, false),
            savedPlan,
            generationSession: current?.generationSession ?? null,
          } satisfies TaskPlanState;
        },
      );
      setPlanFlow(completePlanAccept(result.savedPlan ?? nextPlanState?.savedPlan ?? null));
      if (nextPlanState) {
        syncTaskDetailPlanFields(nextPlanState);
      }
      await refreshExecutionQueries();
    } catch (cause) {
      setPlanFlow((current) => failPlanAccept(current, planId, cause instanceof Error ? cause.message : "Failed to accept plan"));
    }
  }, [acceptPlanMutation, queryClient, refreshExecutionQueries, syncTaskDetailPlanFields, task.id]);

  const handleAcceptPlan = useCallback(async () => {
    if (!plan?.id) return;
    await acceptPlanById(plan.id);
  }, [acceptPlanById, plan?.id]);

  const handleGeneratePlanFromHeader = useCallback((request?: PlanGenerationRequest) => {
    const userInstruction = request?.userInstruction?.trim() || null;
    setGenerationUserInstruction(userInstruction);
    void startTaskPlanGenerationSession({
      taskId: task.id,
      forceRefresh: true,
      userInstruction,
    });
  }, [task.id]);

  const setCurrentExecutionResult = useCallback((result: TaskExecutionDispatchResult) => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.currentExecution(task.id), result);
  }, [queryClient, task.id]);

  const dispatchExecutionAction = useCallback(async (action: ExecutionActionInput) => {
    setRuntimeEvents([]);
    const result = await dispatchTaskExecutionAction(task.id, action, (event) => {
      if (event.type === "runtime_event") {
        setRuntimeEvents((current) => [...current.slice(-99), event]);
        return;
      }
      if (event.type !== "state") return;
      queryClient.setQueryData(taskWorkspaceQueryKeys.planState(task.id), (current: TaskPlanState | undefined) => {
        if (!current?.savedPlan) return current;
        return {
          ...current,
          savedPlan: {
            ...current.savedPlan,
            effectivePlan: event.effectivePlan,
          },
        } satisfies TaskPlanState;
      });
    });
    setCurrentExecutionResult(result);
    await refreshExecutionQueries();
    return result;
  }, [queryClient, refreshExecutionQueries, setCurrentExecutionResult, task.id]);

  const submitCheckpointAction = useCallback(async (action: SubmitCheckpointActionInput) => {
    const result = await submitTaskCheckpointAction(task.id, action);
    setCurrentExecutionResult(result.execution);
    await refreshExecutionQueries();
    return result.execution;
  }, [refreshExecutionQueries, setCurrentExecutionResult, task.id]);

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
    latestActivitySummary,
    currentExecution,
    acceptPlanById,
    handleAcceptPlan,
    dispatchExecutionAction,
    submitCheckpointAction,
    handleGeneratePlanFromHeader,
    assistantBuildCurrentPlan,
  };
}
