import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskPlanReadModelToGraphPlan } from "@/components/task/plan/task-plan-view-model";
import { api } from "@/lib/rpc-client";
import { fetchTaskPlanState, taskWorkspaceQueryKeys, type TaskPlanState } from "./task-workspace-query";
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
} from "./task-workspace-plan-flow-machine";
import type { TaskData } from "./task-workspace-types";

export function useTaskWorkspacePlanState(task: TaskData) {
  const queryClient = useQueryClient();
  const syncTaskDetailPlanFields = useCallback((nextPlanState: TaskPlanState) => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.detail(task.id), (current: TaskData | undefined) => {
      if (!current) return current;
      return {
        ...current,
        savedPlan: nextPlanState.savedPlan,
        aiPlanGenerationStatus: nextPlanState.aiPlanGenerationStatus,
      } satisfies TaskData;
    });
  }, [queryClient, task.id]);

  const planStateQuery = useQuery({
    queryKey: taskWorkspaceQueryKeys.planState(task.id),
    queryFn: () => fetchTaskPlanState(task.id),
    initialData: {
      taskId: task.id,
      aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
      savedPlan: task.savedPlan ?? null,
    } satisfies TaskPlanState,
    refetchInterval: (query) => query.state.data?.aiPlanGenerationStatus === "generating" ? 3000 : false,
  });
  const planState = planStateQuery.data;
  const [isAiWorkspaceOpen, setIsAiWorkspaceOpen] = useState(false);
  const [requestGenerationKey, setRequestGenerationKey] = useState(0);
  const [planFlow, setPlanFlow] = useState(() => createPlanFlowFromSnapshot(planStateQuery.data));

  useEffect(() => {
    if (!planState) return;
    syncTaskDetailPlanFields(planState);
  }, [planState, syncTaskDetailPlanFields]);

  useEffect(() => {
    if (!planState) return;
    setPlanFlow((current) => current.status === "accepting" ? current : createPlanFlowFromSnapshot(planState));
  }, [planState]);

  const plan = planFlow.savedPlan ?? null;
  const planGenerationStatus = getPlanGenerationStatusFromFlow(planFlow);

  const setPlan = useCallback((value: SetStateAction<TaskData["savedPlan"] | null>) => {
    queryClient.setQueryData(taskWorkspaceQueryKeys.planState(task.id), (current: TaskPlanState | undefined) => {
      const previous = current ?? {
        taskId: task.id,
        aiPlanGenerationStatus: task.aiPlanGenerationStatus ?? "idle",
        savedPlan: task.savedPlan ?? null,
      };
      const nextPlan = typeof value === "function"
        ? (value as (prevState: TaskData["savedPlan"] | null) => TaskData["savedPlan"] | null)(previous.savedPlan ?? null)
        : value;
      return {
        ...previous,
        savedPlan: nextPlan,
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
      const nextPlanState = queryClient.setQueryData<TaskPlanState>(taskWorkspaceQueryKeys.planState(task.id), (current: TaskPlanState | undefined) => ({
        taskId: task.id,
        aiPlanGenerationStatus: "accepted",
        savedPlan: result.savedPlan ?? current?.savedPlan ?? null,
      } satisfies TaskPlanState));
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
    acceptPlanById,
    handleAcceptPlan,
    handleOpenAiWorkspace,
    handleGeneratePlanFromHeader,
    assistantBuildCurrentPlan,
  };
}
