"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@chrona/i18n/react";
import { useAssistantSurface } from "@/components/assistant-surface/assistant-surface-provider";
import { TaskWorkspacePlanSection } from "../sections/task-workspace-plan-section";
import { TaskWorkspaceEditSection } from "../sections/task-workspace-edit-section";
import { TaskWorkspaceHeaderCard } from "./task-workspace-header-card";
import { ProviderApprovalBanner } from "../execution/provider-approval-banner";
import type { TaskData, TaskPageData } from "../model/task-workspace-types";
import { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
import { useTaskWorkspaceDeleteFlow } from "../hooks/use-task-workspace-delete-flow";
import { useTaskWorkspaceEditorState } from "../hooks/use-task-workspace-editor-state";
import { useTaskWorkspacePageState } from "../hooks/use-task-workspace-page-state";
import { useTaskWorkspacePlanState } from "../hooks/use-task-workspace-plan-state";
import { useTaskWorkspaceProposalFlow } from "../hooks/use-task-workspace-proposal-flow";
import { createTaskAiSidebarContext } from "../adapters/task-ai-sidebar-adapter";

function getLatestPersistedActivitySummary(pageData: TaskPageData) {
  const latestActivity = pageData.activityTimeline?.at(-1);
  return latestActivity?.description || latestActivity?.title || null;
}

type Props = {
  data: TaskPageData;
  copy?: Partial<typeof DEFAULT_COPY>;
};

type TaskWorkspaceHeaderEditorProps = {
  task: Parameters<typeof TaskWorkspaceHeaderCard>[0]["task"];
  header: Parameters<typeof TaskWorkspaceHeaderCard>[0]["header"];
  workspaceStateLabel?: string;
  workspaceStateGuidance: string;
  backToScheduleLabel: string;
  planAction: Parameters<typeof TaskWorkspaceHeaderCard>[0]["planAction"];
  onAction: Parameters<typeof TaskWorkspaceHeaderCard>[0]["onAction"];
  onSelectOccurrence: (occurrence: NonNullable<TaskData["recurrenceOccurrences"]>[number]) => void;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
  onStartDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onDelete: () => void;
  editSectionProps: Omit<Parameters<typeof TaskWorkspaceEditSection>[0], "isEditExpanded" | "onToggleExpanded">;
};

type HeaderPlanActionInput = {
  plan: ReturnType<typeof useTaskWorkspacePlanState>["plan"];
  planGenerationStatus: ReturnType<typeof useTaskWorkspacePlanState>["planGenerationStatus"];
  canAcceptPlan: boolean;
  onGeneratePlan: () => void;
  onAcceptPlan: () => void;
};

const DEFAULT_COPY = {
  title: "Task Workspace",
  backToSchedule: "Back to Schedule",
  openWork: "Open Work",
  taskEditorTitle: "Task Information",
  taskEditorDescription:
    "Edit the core task fields. Changes are saved manually.",
  planPanelTitle: "Plan",
  planPanelDescription:
    "Task execution plan with nodes, dependencies, and status.",
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
  workspaceState: "Workspace state",
  currentState: "Current state",
  nextAction: "Next action",
  commandCenterActionsTab: "Actions",
  commandCenterResultTab: "Result",
  commandCenterArtifactsTab: "Artifacts",
  commandCenterActivityTab: "Activity",
};

function TaskWorkspaceHeaderEditor({
  task,
  header,
  workspaceStateLabel,
  workspaceStateGuidance,
  backToScheduleLabel,
  planAction,
  onAction,
  onSelectOccurrence,
  showDeleteConfirm,
  isDeleting,
  onStartDeleteConfirm,
  onCancelDeleteConfirm,
  onDelete,
  editSectionProps,
}: TaskWorkspaceHeaderEditorProps) {
  const [isEditExpanded, setIsEditExpanded] = useState(false);

  return (
    <>
      <TaskWorkspaceHeaderCard
        task={task}
        header={header}
        backToScheduleLabel={backToScheduleLabel}
        workspaceStateLabel={workspaceStateLabel}
        workspaceStateGuidance={workspaceStateGuidance}
        planAction={planAction}
        onAction={onAction}
        onSelectOccurrence={onSelectOccurrence}
        onEdit={() => setIsEditExpanded((current) => !current)}
        showDeleteConfirm={showDeleteConfirm}
        isDeleting={isDeleting}
        onStartDeleteConfirm={onStartDeleteConfirm}
        onCancelDeleteConfirm={onCancelDeleteConfirm}
        onDelete={onDelete}
      />
      <TaskWorkspaceEditSection
        {...editSectionProps}
        isEditExpanded={isEditExpanded}
        onToggleExpanded={() => setIsEditExpanded((current) => !current)}
      />
    </>
  );
}

function createPlanAcceptanceHeader(header: TaskWorkspaceHeaderEditorProps["header"], plan: HeaderPlanActionInput["plan"]) {
  if (plan?.status === "accepted") return header;

  return {
    ...header,
    actions: header.actions.map((action) => {
      if (action.id !== "start") return action;
      return {
        ...action,
        disabled: true,
        disabledReason: plan
          ? "Accept the generated plan before starting execution."
          : "Generate and accept a plan before starting execution.",
      };
    }),
  } satisfies TaskWorkspaceHeaderEditorProps["header"];
}

function createHeaderPlanAction({
  plan,
  planGenerationStatus,
  canAcceptPlan,
  onGeneratePlan,
  onAcceptPlan,
}: HeaderPlanActionInput): TaskWorkspaceHeaderEditorProps["planAction"] {
  if (planGenerationStatus === "generating") {
    return {
      label: "Generating...",
      placement: "primary",
      isLoading: true,
      disabled: true,
      onClick: onGeneratePlan,
    };
  }

  if (plan && plan.status !== "accepted") {
    return {
      label: "Accept plan",
      placement: "primary",
      disabled: !canAcceptPlan,
      onClick: onAcceptPlan,
    };
  }

  if (plan) {
    return {
      label: "Regenerate plan",
      placement: "menu",
      disabled: false,
      onClick: onGeneratePlan,
    };
  }

  return {
    label: "Generate plan",
    placement: "primary",
    disabled: false,
    onClick: onGeneratePlan,
  };
}

export function TaskWorkspacePage({ data, copy: copyProp }: Props) {
  const copy = { ...DEFAULT_COPY, ...copyProp };
  const { locale, messages } = useI18n();
  const executionConsoleCopy = messages.components?.taskWorkspace ?? {};
  const { registerHandlers, setPageContext } = useAssistantSurface();
  const { pageData, setTask, refreshWorkspace, workspaceEvents } = useTaskWorkspacePageState(data);
  const task = pageData.task;
  const navigate = useNavigate();
  const handleSelectOccurrence = (occurrence: NonNullable<typeof task.recurrenceOccurrences>[number]) => {
    if (occurrence.isCurrent) return;
    const search = occurrence.workBlockId ? `?workBlockId=${encodeURIComponent(occurrence.workBlockId)}` : "";
    void navigate({ pathname: `/${locale}/tasks/${occurrence.taskId}`, search });
  };

  const {
    hasUnsavedConfigChanges,
    isSaving,
    saveError,
    setSaveError,
    saveSuccess,
    taskConfigInitialValues,
    draftEditableTask,
    editSummary,
    planningTaskDraft,
    handleTaskConfigDraftStateChange,
    persistTaskConfig,
    handleSaveCurrentDraft,
  } = useTaskWorkspaceEditorState(task, setTask);

  const {
    plan,
    setPlan,
    fetchPlan,
    planGenerationStatus,
    graphPlan,
    canAcceptPlan,
    isGraphPlanPending,
    acceptPlanError,
    setAcceptPlanError,
    generationUserInstruction,
    runtimeEvents,
    latestActivitySummary,
    acceptPlanById,
    dispatchExecutionAction,
    submitCheckpointAction,
    handleGeneratePlanFromHeader,
  } = useTaskWorkspacePlanState(task, refreshWorkspace, workspaceEvents);
  const consoleView = useMemo(
    () => createTaskWorkspaceExecutionConsoleView({ pageData, graphPlan, copy: executionConsoleCopy }),
    [pageData, graphPlan, executionConsoleCopy],
  );
  const header = createPlanAcceptanceHeader(consoleView.header, plan);
  const planAction = createHeaderPlanAction({
    plan,
    planGenerationStatus,
    canAcceptPlan,
    onGeneratePlan: handleGeneratePlanFromHeader,
    onAcceptPlan: () => {
      if (!plan?.id) return;
      setAcceptPlanError(null);
      void acceptPlanById(plan.id);
    },
  });
  const assistantActivitySummary = latestActivitySummary ?? getLatestPersistedActivitySummary(pageData);
  const {
    currentProposal,
    isApplying,
    handleApplyProposal,
    handleCancelProposal,
  } = useTaskWorkspaceProposalFlow({
    task,
    plan,
    draftEditableTask,
    setTask,
    setSaveError,
    fetchPlan,
    refreshWorkspace,
  });
  const { showDeleteConfirm, setShowDeleteConfirm, isDeleting, handleDelete } =
    useTaskWorkspaceDeleteFlow({
      taskId: task.id,
      setSaveError,
    });
  const assistantContext = useMemo(() => createTaskAiSidebarContext(task, {
    latestActivitySummary: assistantActivitySummary,
  }), [
    assistantActivitySummary,
    task.blockReason?.actionRequired,
    task.blockReason?.blockType,
    task.executionSummary?.waiting,
    task.graphNodeStates,
    task.id,
    task.isRunnable,
    task.savedPlan?.id,
    task.status,
    task.title,
  ]);

  useEffect(() => {
    const { context, actions } = assistantContext;
    setPageContext(context, actions);
    return registerHandlers({
      onConfirmProposal: async (proposal) => {
        await handleApplyProposal({
          summary: proposal.summary,
          confidence: proposal.riskLevel === "high" ? "low" : "medium",
          requiresConfirmation: true,
        });
      },
      onDismissProposal: handleCancelProposal,
    });
  }, [assistantContext, handleApplyProposal, handleCancelProposal, registerHandlers, setPageContext]);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] min-w-0 flex-col gap-2 xl:overflow-hidden">
      <div className="shrink-0 space-y-1">
        <TaskWorkspaceHeaderEditor
          task={consoleView.task}
          header={header}
          backToScheduleLabel={copy.backToSchedule}
          workspaceStateLabel={consoleView.states.treatment.label ?? undefined}
          workspaceStateGuidance={`${copy.nextAction}: ${consoleView.states.treatment.guidance}`}
          planAction={planAction}
          onSelectOccurrence={handleSelectOccurrence}
          onAction={async (action) => {
            if (action.id === "start") {
              await dispatchExecutionAction({ action: "start_manual" });
            }
            if (action.id === "pause") {
              await dispatchExecutionAction({ action: "pause_session", reason: "Paused from task workspace" });
            }
            if (action.id === "stop") {
              await dispatchExecutionAction({ action: "cancel_session", reason: "Stopped from task workspace" });
            }
          }}
          showDeleteConfirm={showDeleteConfirm}
          isDeleting={isDeleting}
          onStartDeleteConfirm={() => setShowDeleteConfirm(true)}
          onCancelDeleteConfirm={() => setShowDeleteConfirm(false)}
          onDelete={() => void handleDelete()}
          editSectionProps={{
            executionRuntimes: data.executionRuntimes,
            defaultExecutionRuntime: data.defaultExecutionRuntime,
            isSaving,
            taskConfigInitialValues,
            sourceManaged: consoleView.task.sourceManaged,
            saveSuccess,
            saveError,
            editSummary,
            hasUnsavedConfigChanges,
            currentProposal,
            isApplying,
            onDraftStateChange: handleTaskConfigDraftStateChange,
            onSubmitAction: persistTaskConfig,
            onApplyProposal: handleApplyProposal,
            onCancelProposal: handleCancelProposal,
          }}
        />
      </div>
      <ProviderApprovalBanner taskId={task.id} />


      <TaskWorkspacePlanSection
        label={copy.planPanelTitle ?? "Plan"}
        commandCenterCopy={{
          actionsTab: copy.commandCenterActionsTab,
          resultTab: copy.commandCenterResultTab,
          artifactsTab: copy.commandCenterArtifactsTab,
          activityTab: copy.commandCenterActivityTab,
        }}
        graphPlan={graphPlan}
        isGraphPlanPending={isGraphPlanPending}
        pageData={{ ...pageData, task: consoleView.task }}
        plan={plan}
        planGenerationStatus={planGenerationStatus}
        canAcceptPlan={canAcceptPlan}
        acceptPlanError={acceptPlanError}
        planningTaskDraft={planningTaskDraft}
        hasUnsavedConfigChanges={hasUnsavedConfigChanges}
        unsavedConfigDraft={planningTaskDraft}
        generationUserInstruction={generationUserInstruction}
        runtimeEvents={runtimeEvents}
        onGeneratePlan={handleGeneratePlanFromHeader}
        onPlanLoaded={setPlan}
        onApplyPlan={async (result) => {
          if (!result.id) return;
          setAcceptPlanError(null);
          await acceptPlanById(result.id);
        }}
        onSaveConfigBeforeRegenerate={handleSaveCurrentDraft}
        onDispatchExecutionAction={dispatchExecutionAction}
        onSubmitCheckpointAction={submitCheckpointAction}
      />
    </div>
  );
}
