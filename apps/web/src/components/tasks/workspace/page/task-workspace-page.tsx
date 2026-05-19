"use client";

import { useEffect, useMemo } from "react";
import { useAssistantSurface } from "@/components/assistant-surface/assistant-surface-provider";
import { TaskWorkspaceAiSection } from "../sections/task-workspace-ai-section";
import { TaskWorkspacePlanSection } from "../sections/task-workspace-plan-section";
import { TaskWorkspaceEditSection } from "../sections/task-workspace-edit-section";
import { TaskWorkspaceHeaderCard } from "./task-workspace-header-card";
import type { TaskPageData } from "../model/task-workspace-types";
import { createTaskWorkspaceExecutionConsoleView } from "../model/task-workspace-query";
import { useTaskWorkspaceDeleteFlow } from "../hooks/use-task-workspace-delete-flow";
import { useTaskWorkspaceEditorState } from "../hooks/use-task-workspace-editor-state";
import { useTaskWorkspacePageState } from "../hooks/use-task-workspace-page-state";
import { useTaskWorkspacePlanState } from "../hooks/use-task-workspace-plan-state";
import { useTaskWorkspaceProposalFlow } from "../hooks/use-task-workspace-proposal-flow";
import { createTaskAiSidebarContext } from "../adapters/task-ai-sidebar-adapter";

type Props = {
  data: TaskPageData;
  copy?: Partial<typeof DEFAULT_COPY>;
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
};

export function TaskWorkspacePage({ data, copy: copyProp }: Props) {
  const copy = { ...DEFAULT_COPY, ...copyProp };
  const { registerHandlers, setPageContext } = useAssistantSurface();
  const { pageData, setTask, refreshWorkspace } = useTaskWorkspacePageState(data);
  const task = pageData.task;

  const {
    hasUnsavedConfigChanges,
    isSaving,
    saveError,
    setSaveError,
    saveSuccess,
    isEditExpanded,
    setIsEditExpanded,
    taskConfigInitialValues,
    draftEditableTask,
    editSummary,
    planningTaskDraft,
    assistantBuildCurrentTask,
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
    isAiWorkspaceOpen,
    setIsAiWorkspaceOpen,
    requestGenerationKey,
    runtimeEvents,
    acceptPlanById,
    dispatchExecutionAction,
    handleOpenAiWorkspace,
    handleGeneratePlanFromHeader,
    assistantBuildCurrentPlan,
  } = useTaskWorkspacePlanState(task, refreshWorkspace);
  const consoleView = createTaskWorkspaceExecutionConsoleView({
    pageData,
    graphPlan,
  });
  const isGeneratingPlan = planGenerationStatus === "generating";
  const {
    currentProposal,
    setCurrentProposal,
    isApplying,
    handleApplyProposal,
    handleProposal,
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
  const assistantContext = useMemo(() => createTaskAiSidebarContext(task), [
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
        <TaskWorkspaceHeaderCard
          task={consoleView.task}
          header={consoleView.header}
          backToScheduleLabel={copy.backToSchedule}
          workspaceStateLabel={consoleView.states.treatment.label}
          workspaceStateGuidance={`${copy.nextAction}: ${consoleView.states.treatment.guidance}`}
          planAction={{
            label: isGeneratingPlan
              ? "Generating..."
              : plan
                ? "Regenerate plan"
                : "Generate plan",
            placement: plan ? "menu" : "primary",
            isLoading: isGeneratingPlan,
            disabled: isGeneratingPlan,
            onClick: handleGeneratePlanFromHeader,
          }}
          onAction={async (action) => {
            if (action.id === "start") {
              await dispatchExecutionAction({ action: "start_manual" });
            }
            if (action.id === "stop") {
              await dispatchExecutionAction({ action: "cancel_session", reason: "Stopped from task workspace" });
            }
          }}
          onEdit={() => setIsEditExpanded((current) => !current)}
          showDeleteConfirm={showDeleteConfirm}
          isDeleting={isDeleting}
          onStartDeleteConfirm={() => setShowDeleteConfirm(true)}
          onCancelDeleteConfirm={() => setShowDeleteConfirm(false)}
          onDelete={() => void handleDelete()}
        />
        <TaskWorkspaceEditSection
          executionRuntimes={data.executionRuntimes}
          defaultExecutionRuntime={data.defaultExecutionRuntime}
          isSaving={isSaving}
          taskConfigInitialValues={taskConfigInitialValues}
          saveSuccess={saveSuccess}
          saveError={saveError}
          editSummary={editSummary}
          hasUnsavedConfigChanges={hasUnsavedConfigChanges}
          isEditExpanded={isEditExpanded}
          currentProposal={currentProposal}
          isApplying={isApplying}
          onToggleExpanded={() => setIsEditExpanded((current) => !current)}
          onDraftStateChange={handleTaskConfigDraftStateChange}
          onSubmitAction={persistTaskConfig}
          onApplyProposal={handleApplyProposal}
          onCancelProposal={handleCancelProposal}
        />
      </div>

      <TaskWorkspacePlanSection
        label={copy.planPanelTitle ?? "Plan"}
        graphPlan={graphPlan}
        isGraphPlanPending={isGraphPlanPending}
        pageData={{ ...pageData, task: consoleView.task }}
        plan={plan}
        planGenerationStatus={planGenerationStatus}
        canAcceptPlan={canAcceptPlan}
        acceptPlanError={acceptPlanError}
        runtimeEvents={runtimeEvents}
        onGeneratePlan={handleGeneratePlanFromHeader}
        onDispatchExecutionAction={dispatchExecutionAction}
      />

      <TaskWorkspaceAiSection
        isOpen={isAiWorkspaceOpen}
        onOpen={handleOpenAiWorkspace}
        onClose={() => setIsAiWorkspaceOpen(false)}
        taskId={task.id}
        planningTaskDraft={planningTaskDraft}
        savedPlan={plan}
        generationStatus={planGenerationStatus}
        acceptedPlanId={plan?.status === "accepted" ? plan.id : null}
        hasUnsavedConfigChanges={hasUnsavedConfigChanges}
        unsavedConfigDraft={planningTaskDraft}
        onPlanLoaded={setPlan}
        onApplyPlan={async (result) => {
          if (!result.id) return;
          setAcceptPlanError(null);
          await acceptPlanById(result.id);
        }}
        onSaveConfigBeforeRegenerate={handleSaveCurrentDraft}
        buildCurrentTask={assistantBuildCurrentTask}
        buildCurrentPlan={assistantBuildCurrentPlan}
        onProposal={handleProposal}
        onApplyProposal={handleApplyProposal}
        onDismissProposal={() => {
          setCurrentProposal(null);
        }}
        isApplying={isApplying}
        requestGenerationKey={requestGenerationKey}
        showInlineGenerateButton={false}
        emptyPlanDescription="Use the plan button in the graph header when you want a new task plan."
      />
    </div>
  );
}
