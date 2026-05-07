"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Clock, Ellipsis, Loader2, Trash2 } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import {
  TaskConfigForm,
  type TaskConfigDraftState,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { TaskEditPanel } from "@/components/task/panels/task-edit-panel";
import { TaskPlanGraphPanel } from "@/components/task/panels/task-plan-graph-panel";
import { taskPlanReadModelToGraphPlan } from "@/components/task/plan/task-plan-view-model";
import { TaskAiWorkspacePanel } from "@/components/tasks/task-ai-workspace-panel";
import { TaskWorkspaceDiffPreview } from "@/components/tasks/task-workspace-diff-preview";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardHeader,
} from "@/components/ui/surface-card";

import { api } from "@/lib/rpc-client";
import type { TaskWorkspaceUpdateProposal, TaskPlanReadModel } from "@chrona/contracts/ai";

type TaskData = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
  status: string;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  scheduleSource: string | null;
  isRunnable: boolean;
  runnabilitySummary: string;
  runnabilityState?: string;
  ownerType?: string;
  savedPlan?: TaskPlanReadModel | null;
  aiPlanGenerationStatus?: "idle" | "generating" | "waiting_acceptance" | "accepted";
  blockReason: {
    blockType?: string;
    actionRequired?: string;
    scope?: string;
    since?: string;
  } | null;
  dependencies: Array<{
    id: string;
    dependencyType: string;
    dependsOnTask: {
      id: string;
      title: string;
      status: string;
    };
  }>;
};

type TaskPageData = {
  defaultRuntimeAdapterKey: string;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  task: TaskData;
  latestRunSummary: {
    id: string;
    status: string;
    startedAt: string | null;
    syncStatus: string;
  } | null;
  scheduleProposals: Array<{
    id: string;
    source: string;
    proposedBy: string;
    summary: string;
    status: string;
    dueAt: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
  }>;
  approvals: Array<{
    id: string;
    title: string;
    status: string;
    riskLevel?: string;
    requestedAt?: string;
  }>;
  artifacts: Array<{
    id: string;
    title: string;
    type: string;
    uri?: string;
  }>;
};

type Props = {
  data: TaskPageData;
  copy?: Partial<typeof DEFAULT_COPY>;
};

const DEFAULT_COPY = {
  title: "Task Workspace",
  backToSchedule: "Back to Schedule",
  openWorkbench: "Open Workbench",
  taskEditorTitle: "Task Information",
  taskEditorDescription: "Edit the core task fields. Changes are saved manually.",
  planPanelTitle: "Plan",
  planPanelDescription: "Task execution plan with nodes, dependencies, and status.",
  latestRunTitle: "Latest Run",
  status: "Status",
  started: "Started",
  sync: "Sync",
  noRunStarted: "No run started yet.",
  pendingProposalsTitle: "Pending Schedule Proposals",
  noPendingProposals: "No pending schedule proposals.",
  recentApprovalsTitle: "Recent Approvals",
  noApprovals: "No recent approvals.",
  recentArtifactsTitle: "Recent Artifacts",
  noArtifacts: "No artifacts yet.",
  via: "via",
};

type EditableTask = {
  title: string;
  description: string | null;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
};

function taskToEditable(task: TaskData): EditableTask {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueAt: task.dueAt,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    scheduleStatus: task.scheduleStatus,
    runtimeAdapterKey: task.runtimeAdapterKey,
    runtimeInput: task.runtimeInput,
    runtimeInputVersion: task.runtimeInputVersion,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
  };
}

function toIsoStringOrNull(value: Date | null) {
  return value ? value.toISOString() : null;
}

function taskToTaskConfigInitialValues(task: TaskData) {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority as TaskConfigFormInput["priority"],
    dueAt: task.dueAt ? new Date(task.dueAt) : null,
    scheduledStartAt: task.scheduledStartAt ? new Date(task.scheduledStartAt) : null,
    scheduledEndAt: task.scheduledEndAt ? new Date(task.scheduledEndAt) : null,
    runtimeAdapterKey: task.runtimeAdapterKey,
    runtimeInput: task.runtimeInput,
    runtimeInputVersion: task.runtimeInputVersion,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
  };
}

function taskConfigInputToEditableTask(input: TaskConfigFormInput, scheduleStatus: string): EditableTask {
  return {
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    dueAt: toIsoStringOrNull(input.dueAt),
    scheduledStartAt: toIsoStringOrNull(input.scheduledStartAt),
    scheduledEndAt: toIsoStringOrNull(input.scheduledEndAt),
    scheduleStatus,
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeInputVersion: input.runtimeInputVersion,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig: input.runtimeConfig ?? null,
  };
}

function editableTaskToPlanDraft(task: EditableTask) {
  return {
    title: task.title,
    description: task.description ?? "",
    priority: task.priority as "Low" | "Medium" | "High" | "Urgent",
    dueAt: task.dueAt ? new Date(task.dueAt) : null,
    scheduledStartAt: task.scheduledStartAt ? new Date(task.scheduledStartAt) : null,
    scheduledEndAt: task.scheduledEndAt ? new Date(task.scheduledEndAt) : null,
  };
}

function priorityTone(priority: string) {
  if (priority === "Urgent") return "critical" as const;
  if (priority === "High") return "warning" as const;
  return "neutral" as const;
}

function statusTone(status: string) {
  if (["Completed", "Done"].includes(status)) return "success" as const;
  if (["Running", "Ready", "Queued", "Scheduled"].includes(status)) return "info" as const;
  if (["WaitingForInput", "WaitingForApproval"].includes(status)) return "warning" as const;
  if (["Failed", "Blocked"].includes(status)) return "critical" as const;
  return "neutral" as const;
}

function formatPlanUpdatedAt(iso: string) {
  return iso.replace("T", " ").slice(0, 16);
}

function formatTaskDate(iso: string | null) {
  if (!iso) return null;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getMonth() + 1}/${value.getDate()}`;
}

function formatTaskTime(iso: string | null) {
  if (!iso) return null;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function buildEditSummary(task: EditableTask) {
  const scheduleDate = formatTaskDate(task.scheduledStartAt);
  const startTime = formatTaskTime(task.scheduledStartAt);
  const endTime = formatTaskTime(task.scheduledEndAt);
  const schedule = scheduleDate && startTime && endTime ? `${scheduleDate} ${startTime}-${endTime}` : "Unscheduled";
  const model = task.runtimeModel?.trim() || task.runtimeAdapterKey?.trim() || "Default runtime";
  const description = task.description?.trim()
    ? task.description.trim().length > 140
      ? `${task.description.trim().slice(0, 137)}...`
      : task.description.trim()
    : "No description";

  return {
    schedule,
    model,
    description,
  };
}

function planStatusTone(status: string) {
  if (status === "accepted") return "success" as const;
  if (status === "draft") return "warning" as const;
  if (status === "superseded") return "neutral" as const;
  return "neutral" as const;
}

export function TaskWorkspacePage({ data, copy: copyProp }: Props) {
  const copy = { ...DEFAULT_COPY, ...copyProp };

  const [task, setTask] = useState<TaskData>(data.task);
  const [taskConfigDraft, setTaskConfigDraft] = useState<TaskConfigFormInput | null>(null);
  const [hasUnsavedConfigChanges, setHasUnsavedConfigChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [currentProposal, setCurrentProposal] = useState<{
    proposal: TaskWorkspaceUpdateProposal;
    originalTask: EditableTask;
  } | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [plan, setPlan] = useState(data.task.savedPlan ?? null);
  const [_isRefetchingPlan, setIsRefetchingPlan] = useState(false);
  const [planGenerationStatus, setPlanGenerationStatus] = useState(data.task.aiPlanGenerationStatus ?? "idle");
  const [graphViewportHeight, setGraphViewportHeight] = useState(820);
  const leftColumnRef = useRef<HTMLDivElement | null>(null);
  const topSectionRef = useRef<HTMLDivElement | null>(null);
  const editFormRef = useRef<HTMLDivElement | null>(null);
  const [isEditExpanded, setIsEditExpanded] = useState(
    () => !( ["Ready", "Completed", "Done"].includes(data.task.status) || data.task.aiPlanGenerationStatus === "accepted"),
  );

  const fetchPlan = useCallback(async () => {
    setIsRefetchingPlan(true);
    try {
      const res = await api.tasks[":taskId"].plan.state.$get({
        param: { taskId: task.id },
      });
      if (res.ok) {
        const state = (await res.json()) as {
          aiPlanGenerationStatus?: string;
          savedPlan?: typeof plan;
        };
        setPlan(state.savedPlan ?? null);
        if (typeof state.aiPlanGenerationStatus === "string") {
          setPlanGenerationStatus(state.aiPlanGenerationStatus as typeof planGenerationStatus);
        }
      }
    } catch {
      // swallow — plan stays stale
    } finally {
      setIsRefetchingPlan(false);
    }
  }, [task.id]);

  // Poll plan state while generating
  useEffect(() => {
    if (planGenerationStatus !== "generating") return;
    const interval = setInterval(() => {
      fetchPlan();
    }, 3000);
    return () => clearInterval(interval);
  }, [planGenerationStatus, fetchPlan]);

  const handleTaskConfigDraftStateChange = useCallback((state: TaskConfigDraftState) => {
    setTaskConfigDraft(state.values);
    setHasUnsavedConfigChanges(state.isDirty);
    setSaveSuccess(false);
  }, []);

  const persistTaskConfig = useCallback(async (input: TaskConfigFormInput) => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const body: Record<string, unknown> = {
        title: input.title,
        description: input.description || undefined,
        priority: input.priority,
        dueAt: input.dueAt?.toISOString() ?? undefined,
        scheduledStartAt: input.scheduledStartAt?.toISOString() ?? undefined,
        scheduledEndAt: input.scheduledEndAt?.toISOString() ?? undefined,
        runtimeAdapterKey: input.runtimeAdapterKey,
        runtimeInput: input.runtimeInput,
        runtimeInputVersion: input.runtimeInputVersion,
        runtimeModel: input.runtimeModel ?? undefined,
        prompt: input.prompt ?? undefined,
        runtimeConfig: input.runtimeConfig ?? undefined,
      };

      const response = await api.tasks[":taskId"].$patch({
        param: { taskId: task.id },
        json: body,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to save" }));
        throw new Error((err as { error?: string }).error ?? "Failed to save task");
      }

      await response.json();
      setTask((prev) => ({
        ...prev,
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        dueAt: toIsoStringOrNull(input.dueAt),
        scheduledStartAt: toIsoStringOrNull(input.scheduledStartAt),
        scheduledEndAt: toIsoStringOrNull(input.scheduledEndAt),
        scheduleStatus: prev.scheduleStatus,
        runtimeAdapterKey: input.runtimeAdapterKey,
        runtimeInput: input.runtimeInput,
        runtimeInputVersion: input.runtimeInputVersion,
        runtimeModel: input.runtimeModel,
        prompt: input.prompt,
        runtimeConfig: input.runtimeConfig ?? null,
      }));
      setTaskConfigDraft(input);
      setHasUnsavedConfigChanges(false);
      setSaveSuccess(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Failed to save task");
    } finally {
      setIsSaving(false);
    }
  }, [task.id]);

  const handleSaveCurrentDraft = useCallback(async () => {
    if (!taskConfigDraft) {
      return;
    }

    await persistTaskConfig(taskConfigDraft);
  }, [persistTaskConfig, taskConfigDraft]);

  const handleApplyProposal = useCallback(async (proposal: TaskWorkspaceUpdateProposal) => {
    setIsApplying(true);
    setSaveError(null);
    const errors: string[] = [];

    if (proposal.taskPatch) {
      try {
        const body: Record<string, unknown> = {};
        const patch = proposal.taskPatch;
        if (patch.title !== undefined) body.title = patch.title;
        if (patch.description !== undefined) body.description = patch.description;
        if (patch.priority !== undefined) body.priority = patch.priority;
        if (patch.dueAt !== undefined) body.dueAt = patch.dueAt ?? undefined;
        if (patch.scheduledStartAt !== undefined) body.scheduledStartAt = patch.scheduledStartAt ?? undefined;
        if (patch.scheduledEndAt !== undefined) body.scheduledEndAt = patch.scheduledEndAt ?? undefined;
        if (patch.runtimeModel !== undefined) body.runtimeModel = patch.runtimeModel ?? undefined;
        if (patch.prompt !== undefined) body.prompt = patch.prompt ?? undefined;
        if (patch.runtimeConfig !== undefined) body.runtimeConfig = patch.runtimeConfig ?? undefined;

        const response = await api.tasks[":taskId"].$patch({
          param: { taskId: task.id },
          json: body,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Failed to apply task patch" }));
          errors.push(`Task update failed: ${(err as { error?: string }).error ?? "Unknown error"}`);
        } else {
          await response.json();
          const patchedFields: Partial<EditableTask> = {};
          if (patch.title !== undefined) patchedFields.title = patch.title;
          if (patch.description !== undefined) patchedFields.description = patch.description;
          if (patch.priority !== undefined) patchedFields.priority = patch.priority;
          if (patch.dueAt !== undefined) patchedFields.dueAt = patch.dueAt;
          if (patch.scheduledStartAt !== undefined) patchedFields.scheduledStartAt = patch.scheduledStartAt;
          if (patch.scheduledEndAt !== undefined) patchedFields.scheduledEndAt = patch.scheduledEndAt;
          if (patch.runtimeModel !== undefined) patchedFields.runtimeModel = patch.runtimeModel;
          if (patch.prompt !== undefined) patchedFields.prompt = patch.prompt;
          if (patch.runtimeConfig !== undefined) patchedFields.runtimeConfig = patch.runtimeConfig;
          setTask((prev) => ({ ...prev, ...patchedFields }));
        }
      } catch (cause) {
        errors.push(`Task update error: ${cause instanceof Error ? cause.message : "Unknown"}`);
      }
    }

    if (proposal.planPatch && plan) {
      try {
        const patch = proposal.planPatch;
        const response = await api.tasks[":taskId"].plan.$post({
          param: { taskId: task.id },
          json: {
            operation: "batch",
            operations: patch.operations.map((op) => JSON.stringify(op)),
          },
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Failed to apply plan patch" }));
          errors.push(`Plan patch failed: ${(err as { error?: string }).error ?? "Unknown error"}`);
        }
      } catch (cause) {
        errors.push(`Plan update error: ${cause instanceof Error ? cause.message : "Unknown"}`);
      }
    }

    if (errors.length > 0) {
      setSaveError(errors.join("; "));
    } else {
      setCurrentProposal(null);
      await fetchPlan();
    }
    setIsApplying(false);
  }, [task.id, fetchPlan]);

  const handleCancelProposal = useCallback(() => {
    setCurrentProposal(null);
  }, []);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    setSaveError(null);
    try {
      const response = await api.tasks[":taskId"].$delete({ param: { taskId: task.id }, query: {} });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to delete task" }));
        throw new Error((err as { error?: string }).error ?? "Failed to delete task");
      }
      window.location.href = "/schedule";
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Failed to delete task");
      setShowDeleteConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  }, [task.id]);

  const assistantBuildCurrentPlan = useCallback(() => {
    if (!plan?.compiledPlan) return null;
    const p = plan.compiledPlan;
    const deps = new Map<string, string[]>();
    for (const edge of p.edges) {
      if (!deps.has(edge.to)) deps.set(edge.to, []);
      deps.get(edge.to)!.push(edge.from);
    }
    return {
      id: p.id,
      status: "draft" as const,
      revision: p.sourceVersion,
      summary: p.goal,
      nodes: p.nodes.map((n) => ({
        id: n.id,
        title: n.title,
        objective: n.description ?? "",
        description: n.description ?? null,
        status: "pending" as const,
        estimatedMinutes: n.estimatedMinutes ?? null,
        priority: n.priority ?? null,
        executionMode: n.mode ?? "automatic",
        dependsOn: deps.get(n.id) ?? [],
      })),
      edges: p.edges.map((e) => ({
        id: e.id,
        fromNodeId: e.from,
        toNodeId: e.to,
        type: "sequential",
      })),
    };
  }, [plan]);

  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const graphPlan = taskPlanReadModelToGraphPlan(plan);
  const canAcceptPlan = Boolean(plan?.id && planGenerationStatus === "waiting_acceptance");
  const [isAcceptingPlan, setIsAcceptingPlan] = useState(false);
  const [acceptPlanError, setAcceptPlanError] = useState<string | null>(null);
  const taskConfigInitialValues = useMemo(() => taskToTaskConfigInitialValues(task), [
    task.title,
    task.description,
    task.priority,
    task.dueAt,
    task.scheduledStartAt,
    task.scheduledEndAt,
    task.runtimeAdapterKey,
    task.runtimeInput,
    task.runtimeInputVersion,
    task.runtimeModel,
    task.prompt,
    task.runtimeConfig,
  ]);
  const originalEditableTask = taskToEditable(task);
  const draftEditableTask = taskConfigDraft
    ? taskConfigInputToEditableTask(taskConfigDraft, task.scheduleStatus)
    : originalEditableTask;
  const editSummary = buildEditSummary(draftEditableTask);
  const planningTaskDraft = taskConfigDraft
    ? {
        title: taskConfigDraft.title,
        description: taskConfigDraft.description,
        priority: taskConfigDraft.priority,
        dueAt: taskConfigDraft.dueAt,
        scheduledStartAt: taskConfigDraft.scheduledStartAt,
        scheduledEndAt: taskConfigDraft.scheduledEndAt,
      }
    : editableTaskToPlanDraft(originalEditableTask);
  const assistantBuildCurrentTask = useCallback(() => ({
    title: draftEditableTask.title,
    description: draftEditableTask.description,
    priority: draftEditableTask.priority,
    dueAt: draftEditableTask.dueAt,
    scheduledStartAt: draftEditableTask.scheduledStartAt,
    scheduledEndAt: draftEditableTask.scheduledEndAt,
    scheduleStatus: draftEditableTask.scheduleStatus,
    runtimeModel: draftEditableTask.runtimeModel,
    prompt: draftEditableTask.prompt,
    runtimeConfig: draftEditableTask.runtimeConfig,
    status: task.status,
  }), [draftEditableTask, task.status]);

  const handleAcceptPlan = useCallback(async () => {
    if (!plan?.id) return;
    setIsAcceptingPlan(true);
    setAcceptPlanError(null);
    try {
      const res = await api.tasks[":taskId"].plan.accept.$post({
        param: { taskId: task.id },
        json: { planId: plan.id },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to accept plan" }));
        throw new Error((err as { error?: string }).error ?? "Failed to accept plan");
      }
      await fetchPlan();
    } catch (cause) {
      setAcceptPlanError(cause instanceof Error ? cause.message : "Failed to accept plan");
    } finally {
      setIsAcceptingPlan(false);
    }
  }, [fetchPlan, plan?.id, task.id]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    }
    if (showMoreMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMoreMenu]);

  useEffect(() => {
    const leftColumn = leftColumnRef.current;
    const topSection = topSectionRef.current;
    if (!leftColumn || !topSection || typeof ResizeObserver === "undefined") {
      return;
    }

    const measure = () => {
      const leftHeight = leftColumn.getBoundingClientRect().height;
      const topHeight = topSection.getBoundingClientRect().height;
      if (leftHeight <= 0 || topHeight <= 0) {
        return;
      }

      const remainingHeight = leftHeight - topHeight - 16;
      const nextViewportHeight = Math.max(420, Math.min(820, Math.floor(remainingHeight - 72)));
      setGraphViewportHeight((current) => (Math.abs(current - nextViewportHeight) < 2 ? current : nextViewportHeight));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(leftColumn);
    observer.observe(topSection);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [currentProposal, graphPlan, showDeleteConfirm]);

  return (
    <div className="h-full min-h-0 space-y-4 overflow-visible rounded-[1.75rem] border border-border/40 bg-[linear-gradient(180deg,hsl(var(--muted)/0.18),transparent_20%),hsl(var(--background))] p-3 xl:grid xl:overflow-hidden xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-4">
      <div ref={leftColumnRef} className="space-y-4 xl:flex xl:min-h-0 xl:flex-col xl:space-y-0 xl:gap-4">
        <div ref={topSectionRef} className="xl:shrink-0">
          <SurfaceCard className="space-y-4 rounded-[1.45rem] border-border/50 bg-background/55 shadow-none backdrop-blur-[2px]" variant="inset" padding="lg">
          <SurfaceCardHeader className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
            <div className="max-w-3xl space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-balance xl:text-[1.65rem]">
                {task.title}
              </h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={statusTone(task.status)}>{task.status}</StatusBadge>
                <StatusBadge tone={priorityTone(task.priority)}>{task.priority}</StatusBadge>
                {task.runnabilityState && (
                  <StatusBadge tone={task.isRunnable ? "success" : "warning"}>
                    {task.runnabilitySummary}
                  </StatusBadge>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <LocalizedLink
                href="/schedule"
                className={buttonVariants({ variant: "outline", className: "h-9 rounded-xl px-3" })}
              >
                {copy.backToSchedule}
              </LocalizedLink>
              <LocalizedLink
                href={`/workspaces/${task.workspaceId}/work/${task.id}`}
                className={buttonVariants({ variant: "default", className: "h-9 rounded-xl px-3" })}
              >
                {copy.openWorkbench}
              </LocalizedLink>
              <div className="relative" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className={buttonVariants({ variant: "ghost", className: "size-9 rounded-xl" })}
                >
                  <Ellipsis className="size-4" />
                </button>
                {showMoreMenu && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-2xl border border-border/70 bg-white p-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.12)]">
                    {!showDeleteConfirm ? (
                      <button
                        type="button"
                        onClick={() => { setShowDeleteConfirm(true); setShowMoreMenu(false); }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="size-4" />
                        Delete Task
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </SurfaceCardHeader>

          {showDeleteConfirm ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="font-medium">Delete &ldquo;{task.title}&rdquo;?</p>
                  <p className="text-xs text-destructive/80">This cannot be undone.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    className={buttonVariants({ variant: "destructive", size: "sm" })}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <TaskEditPanel
            title="Edit task"
            description={(
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{editSummary.description}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={priorityTone(draftEditableTask.priority)}>{draftEditableTask.priority}</StatusBadge>
                  <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                    {editSummary.schedule}
                  </span>
                  <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                    {editSummary.model}
                  </span>
                  {hasUnsavedConfigChanges ? <StatusBadge tone="warning">Unsaved</StatusBadge> : null}
                </div>
              </div>
            )}
            actions={(
              <button
                type="button"
                onClick={() => {
                  setIsEditExpanded((current) => {
                    const next = !current;
                    if (!current) {
                      requestAnimationFrame(() => {
                        editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      });
                    }
                    return next;
                  });
                }}
                className={buttonVariants({ variant: "ghost", size: "sm", className: "rounded-xl" })}
              >
                {isEditExpanded ? "Collapse" : "Edit"}
                <ChevronDown className={`size-4 transition-transform ${isEditExpanded ? "rotate-180" : "rotate-0"}`} />
              </button>
            )}
          >
            <div ref={editFormRef} className={isEditExpanded ? "block" : "hidden"}>
              <TaskConfigForm
                runtimeAdapters={data.runtimeAdapters}
                defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                isPending={isSaving}
                initialValues={taskConfigInitialValues}
                submitLabel="Save changes"
                pendingLabel="Saving..."
                onDraftStateChange={handleTaskConfigDraftStateChange}
                onSubmitAction={persistTaskConfig}
              />
              {saveSuccess ? (
                <p className="mt-2 text-xs text-emerald-600">Saved successfully</p>
              ) : null}
              {saveError ? (
                <p className="mt-2 text-xs text-red-600">{saveError}</p>
              ) : null}
            </div>
          </TaskEditPanel>

          {currentProposal ? (
            <TaskWorkspaceDiffPreview
              proposal={currentProposal.proposal}
              originalTask={currentProposal.originalTask}
              onApply={handleApplyProposal}
              onCancel={handleCancelProposal}
              isApplying={isApplying}
              applyError={saveError}
            />
          ) : null}
          </SurfaceCard>
        </div>

        {graphPlan && plan ? (
          <div className="space-y-2 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
            <TaskPlanGraphPanel
              label={copy.planPanelTitle ?? "Plan"}
              plan={graphPlan}
              maxViewportHeight={graphViewportHeight}
              className="min-w-0 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
              description={(
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {graphPlan.nodes.length} steps · {graphPlan.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0)} min
                  </span>
                  <StatusBadge tone={planStatusTone(plan.status)}>{plan.status}</StatusBadge>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" />
                    Updated: {formatPlanUpdatedAt(plan.updatedAt)}
                  </span>
                </div>
              )}
              actions={canAcceptPlan ? (
                <button
                  type="button"
                  disabled={isAcceptingPlan}
                  onClick={() => void handleAcceptPlan()}
                  className={buttonVariants({ variant: "default", size: "sm", className: "rounded-xl" })}
                >
                  {isAcceptingPlan ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {isAcceptingPlan ? "Accepting..." : "Accept Plan"}
                </button>
              ) : null}
            />
            {acceptPlanError ? (
              <p className="text-xs text-red-600">{acceptPlanError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="space-y-4 xl:min-h-0 xl:self-start">
        <TaskAiWorkspacePanel
          taskId={task.id}
          planningTaskDraft={planningTaskDraft}
          savedPlan={plan}
          generationStatus={planGenerationStatus}
          acceptedPlanId={plan?.status === "accepted" ? plan.id : null}
          hasUnsavedConfigChanges={hasUnsavedConfigChanges}
          unsavedConfigDraft={planningTaskDraft}
          onPlanLoaded={(savedPlan) => {
            setPlan(savedPlan);
          }}
          onApplyPlan={async (result) => {
            if (!result.id) return;
            setIsAcceptingPlan(true);
            setAcceptPlanError(null);
            try {
              const res = await api.tasks[":taskId"].plan.accept.$post({
                param: { taskId: task.id },
                json: { planId: result.id },
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Failed to accept plan" }));
                throw new Error((err as { error?: string }).error ?? "Failed to accept plan");
              }
              await fetchPlan();
            } catch (cause) {
              setAcceptPlanError(cause instanceof Error ? cause.message : "Failed to accept plan");
            } finally {
              setIsAcceptingPlan(false);
            }
          }}
           onSaveConfigBeforeRegenerate={handleSaveCurrentDraft}
          buildCurrentTask={assistantBuildCurrentTask}
          buildCurrentPlan={assistantBuildCurrentPlan}
          onProposal={(proposal) => {
              setCurrentProposal({
                proposal,
                originalTask: draftEditableTask,
              });
          }}
          onApplyProposal={async (proposal) => {
              await handleApplyProposal(proposal);
            }}
          onDismissProposal={() => {
            setCurrentProposal(null);
          }}
          isApplying={isApplying}
        />
      </aside>
    </div>
  );
}
