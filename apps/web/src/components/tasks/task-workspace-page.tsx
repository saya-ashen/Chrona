"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ellipsis, Trash2 } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { TaskPlanPanel } from "@/components/task/plan/task-plan-panel";
import { TaskEditForm } from "@/components/tasks/task-edit-form";
import { TaskWorkspaceAssistant } from "@/components/tasks/task-workspace-assistant";
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
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
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

export function TaskWorkspacePage({ data, copy: copyProp }: Props) {
  const copy = { ...DEFAULT_COPY, ...copyProp };

  const [task, setTask] = useState<TaskData>(data.task);
  const [editing, setEditing] = useState<EditableTask>(taskToEditable(data.task));
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

  const handleFieldChange = useCallback((field: string, value: string | null) => {
    setEditing((prev) => ({ ...prev, [field]: value }));
    setSaveSuccess(false);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const body: Record<string, unknown> = {
        title: editing.title,
        description: editing.description,
        priority: editing.priority,
        dueAt: editing.dueAt ?? undefined,
        scheduledStartAt: editing.scheduledStartAt ?? undefined,
        scheduledEndAt: editing.scheduledEndAt ?? undefined,
        runtimeModel: editing.runtimeModel ?? undefined,
        prompt: editing.prompt ?? undefined,
        runtimeConfig: editing.runtimeConfig ?? undefined,
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
        title: editing.title,
        description: editing.description,
        priority: editing.priority,
        dueAt: editing.dueAt,
        scheduledStartAt: editing.scheduledStartAt,
        scheduledEndAt: editing.scheduledEndAt,
        scheduleStatus: editing.scheduleStatus,
        runtimeModel: editing.runtimeModel,
        prompt: editing.prompt,
        runtimeConfig: editing.runtimeConfig,
      }));
      setSaveSuccess(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Failed to save task");
    } finally {
      setIsSaving(false);
    }
  }, [editing, task.id]);

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
          setEditing((prev) => ({ ...prev, ...patchedFields }));
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

  const assistantBuildCurrentTask = useCallback(() => ({
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueAt: task.dueAt,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    scheduleStatus: task.scheduleStatus,
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
    status: task.status,
  }), [task]);

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

  return (
    <div className="h-full overflow-y-auto space-y-6 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6">
      <div className="space-y-6">
        <SurfaceCard className="space-y-6" padding="lg">
          <SurfaceCardHeader className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-6">
            <div className="max-w-3xl space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-balance">
                {task.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={statusTone(task.status)}>{task.status}</StatusBadge>
                <StatusBadge tone={priorityTone(task.priority)}>{task.priority}</StatusBadge>
                {task.runnabilityState && (
                  <StatusBadge tone={task.isRunnable ? "success" : "warning"}>
                    {task.runnabilitySummary}
                  </StatusBadge>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <LocalizedLink
                href="/schedule"
                className={buttonVariants({ variant: "outline", className: "rounded-xl" })}
              >
                {copy.backToSchedule}
              </LocalizedLink>
              <LocalizedLink
                href={`/workspaces/${task.workspaceId}/work/${task.id}`}
                className={buttonVariants({ variant: "default", className: "rounded-xl" })}
              >
                {copy.openWorkbench}
              </LocalizedLink>
              <div className="relative" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className={buttonVariants({ variant: "ghost", className: "rounded-xl size-9" })}
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

          {showDeleteConfirm && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">Are you sure you want to delete this task?</p>
              <p className="mt-1 text-xs text-red-600">This action cannot be undone. All runs, plans, and data will be permanently removed.</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className={buttonVariants({ variant: "destructive", size: "sm" })}
                >
                  {isDeleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <TaskEditForm
            task={editing}
            originalTask={taskToEditable(task)}
            onChange={handleFieldChange}
            onSave={handleSave}
            isSaving={isSaving}
            saveError={saveError}
            saveSuccess={saveSuccess}
            copy={copy}
          />

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

        <TaskPlanPanel
          plan={plan}
          taskId={task.id}
          workspaceId={task.workspaceId}
          aiPlanGenerationStatus={planGenerationStatus}
          copy={copy}
          onPlanAccepted={() => { fetchPlan(); }}
        />
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">
        <TaskWorkspaceAssistant
          taskId={task.id}
          buildCurrentTask={assistantBuildCurrentTask}
          buildCurrentPlan={assistantBuildCurrentPlan}
          onProposal={(proposal) => {
            setCurrentProposal({
              proposal,
              originalTask: editing,
            });
          }}
          onApply={async (proposal) => {
              await handleApplyProposal(proposal);
            }}
          onDismiss={() => {
            setCurrentProposal(null);
          }}
          isApplying={isApplying}
        />
      </aside>
    </div>
  );
}
