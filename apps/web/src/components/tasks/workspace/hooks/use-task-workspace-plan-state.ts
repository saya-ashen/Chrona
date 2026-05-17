import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskPlanReadModelToGraphPlan } from "@/components/tasks/plan/task-plan-view-model";
import { useTaskPlanGenerationSession } from "@/hooks/ai/task-plan-generation-session-store";
import { api } from "@/lib/rpc-client";
import { dispatchTaskExecutionAction, fetchTaskPlanState, taskWorkspaceQueryKeys, type TaskPlanState } from "../model/task-workspace-query";
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
import type { ExecutionActionInput, PlanExecutionSSEEvent } from "@chrona/contracts/ai";

export type WorkspaceRuntimeEvent = Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>;

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
  return pagePlan.id === planStatePlan.id ? pagePlan : planStatePlan;
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
  const planState = planStateQuery.data;
  const [isAiWorkspaceOpen, setIsAiWorkspaceOpen] = useState(false);
  const [requestGenerationKey, setRequestGenerationKey] = useState(0);
  const [planFlow, setPlanFlow] = useState(() => createPlanFlowFromSnapshot(planStateQuery.data));
  const [runtimeEvents, setRuntimeEvents] = useState<WorkspaceRuntimeEvent[]>([]);

  useEffect(() => {
    if (!planState) return;
    syncTaskDetailPlanFields(withGeneratedPlanResult(planState, generationSession.result));
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
    const nextPlanState = withGeneratedPlanResult(planState, generationSession.result);
    setPlanFlow((current) => current.status === "accepting" ? current : createPlanFlowFromSnapshot(nextPlanState));
  }, [generationSession.result, planState]);

  const plan = selectWorkspacePlan(task.savedPlan, planFlow.savedPlan);
  const planGenerationStatus = getPlanGenerationStatusFromFlow(planFlow);

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

  useEffect(() => {
    if (planGenerationStatus === "generating") {
      setIsAiWorkspaceOpen(true);
    }
  }, [planGenerationStatus]);

  const graphPlan = useMemo(() => taskPlanReadModelToGraphPlan(plan), [plan]);

  const canAcceptPlan = canAcceptPlanFromFlow(planFlow);
  const acceptPlanError = getAcceptPlanErrorFromFlow(planFlow);

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
    } catch (cause) {
      setPlanFlow((current) => failPlanAccept(current, planId, cause instanceof Error ? cause.message : "Failed to accept plan"));
    }
  }, [acceptPlanMutation, queryClient, syncTaskDetailPlanFields, task.id]);

  const handleAcceptPlan = useCallback(async () => {
    if (!plan?.id) return;
    await acceptPlanById(plan.id);
  }, [acceptPlanById, plan?.id]);

  const handleOpenAiWorkspace = useCallback(() => {
    setIsAiWorkspaceOpen(true);
  }, []);

  const handleGeneratePlanFromHeader = useCallback(() => {
    setIsAiWorkspaceOpen(true);
    setRequestGenerationKey((current) => current + 1);
  }, []);

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
    await Promise.all([
      planStateQuery.refetch(),
      refreshWorkspace(),
    ]);
    return result;
  }, [planStateQuery, queryClient, refreshWorkspace, task.id]);

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
    canAcceptPlan,
    isAcceptingPlan: isAcceptingPlanFromFlow(planFlow),
    acceptPlanError,
    setAcceptPlanError,
    isAiWorkspaceOpen,
    setIsAiWorkspaceOpen,
    requestGenerationKey,
    runtimeEvents,
    acceptPlanById,
    handleAcceptPlan,
    dispatchExecutionAction,
    handleOpenAiWorkspace,
    handleGeneratePlanFromHeader,
    assistantBuildCurrentPlan,
  };
}
