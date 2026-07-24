"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StateStore } from "@json-render/react";
import { useI18n } from "@chrona/i18n";
import { useAssistantSurface } from "@features/assistant-surface";
import { CreateGoalFromResultDialog } from "@features/goals";
import { TaskWorkspacePlanSection } from "./task-workspace-plan-section";
import { TaskWorkspaceEditSection } from "./task-workspace-edit-section";
import { TaskWorkspaceHeaderCard } from "./task-workspace-header-card";
import type { TaskPageData } from "../model/task-workspace-types";
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
  spec: Parameters<typeof TaskWorkspaceHeaderCard>[0]["spec"];
  store: StateStore;
  onAction: Parameters<typeof TaskWorkspaceHeaderCard>[0]["onAction"];
  onAcceptPlan: Parameters<typeof TaskWorkspaceHeaderCard>[0]["onAcceptPlan"];
  onGeneratePlan: Parameters<
    typeof TaskWorkspaceHeaderCard
  >[0]["onGeneratePlan"];
  onStopPlanGeneration: Parameters<
    typeof TaskWorkspaceHeaderCard
  >[0]["onStopPlanGeneration"];
  onRestartPlan: Parameters<typeof TaskWorkspaceHeaderCard>[0]["onRestartPlan"];
  hideGeneratePlan?: boolean;
  hideAcceptPlan?: boolean;
  onRecoveryRetry: Parameters<
    typeof TaskWorkspaceHeaderCard
  >[0]["onRecoveryRetry"];
  onRecoveryEditInstruction: Parameters<
    typeof TaskWorkspaceHeaderCard
  >[0]["onRecoveryEditInstruction"];
  onRecoveryCancel: Parameters<
    typeof TaskWorkspaceHeaderCard
  >[0]["onRecoveryCancel"];
  isEditExpanded: boolean;
  onToggleEditExpanded: () => void;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
  onStartDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onDelete: () => void;
  editSectionProps: Omit<
    Parameters<typeof TaskWorkspaceEditSection>[0],
    "isEditExpanded" | "onToggleExpanded"
  >;
};

type HeaderPlanAcceptInput = {
  plan: ReturnType<typeof useTaskWorkspacePlanState>["plan"];
  canAcceptPlan: boolean;
  setAcceptPlanError: (value: string | null) => void;
  acceptPlanById: ReturnType<
    typeof useTaskWorkspacePlanState
  >["acceptPlanById"];
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
  commandCenterNowTab: "Now",
  commandCenterOutputTab: "Results",
  commandCenterTrailTab: "Activity",
};
function TaskWorkspaceHeaderEditor({
  task,
  spec,
  store,
  onAction,
  onAcceptPlan,
  onGeneratePlan,
  onStopPlanGeneration,
  onRestartPlan,
  hideGeneratePlan,
  hideAcceptPlan,
  onRecoveryRetry,
  onRecoveryEditInstruction,
  onRecoveryCancel,
  isEditExpanded,
  onToggleEditExpanded,
  showDeleteConfirm,
  isDeleting,
  onStartDeleteConfirm,
  onCancelDeleteConfirm,
  onDelete,
  editSectionProps,
}: TaskWorkspaceHeaderEditorProps) {
  return (
    <>
      <TaskWorkspaceHeaderCard
        task={task}
        spec={spec}
        store={store}
        onAction={onAction}
        onAcceptPlan={onAcceptPlan}
        onGeneratePlan={onGeneratePlan}
        hideAcceptPlan={hideAcceptPlan}
        hideGeneratePlan={hideGeneratePlan}
        onStopPlanGeneration={onStopPlanGeneration}
        onRestartPlan={onRestartPlan}
        onEdit={onToggleEditExpanded}
        showDeleteConfirm={showDeleteConfirm}
        isDeleting={isDeleting}
        onStartDeleteConfirm={onStartDeleteConfirm}
        onCancelDeleteConfirm={onCancelDeleteConfirm}
        onDelete={onDelete}
        onRecoveryRetry={onRecoveryRetry}
        onRecoveryEditInstruction={onRecoveryEditInstruction}
        onRecoveryCancel={onRecoveryCancel}
      />
      <TaskWorkspaceEditSection
        {...editSectionProps}
        isEditExpanded={isEditExpanded}
        onToggleExpanded={onToggleEditExpanded}
      />
    </>
  );
}

async function acceptHeaderPlan({
  plan,
  canAcceptPlan,
  setAcceptPlanError,
  acceptPlanById,
}: HeaderPlanAcceptInput) {
  if (!plan?.id || !canAcceptPlan) return;
  setAcceptPlanError(null);
  await acceptPlanById(plan.id);
}

export function TaskWorkspacePage({ data, copy: copyProp }: Props) {
  const copy = { ...DEFAULT_COPY, ...copyProp };
  const { messages } = useI18n();
  const executionConsoleCopy = messages.components.taskWorkspace;
  const { registerHandlers, setPageContext } = useAssistantSurface();
  const {
    pageData,
    commandCenter,
    setTask,
    refreshWorkspace,
    workspaceEvents,
    headerSpec,
    headerStore,
  } = useTaskWorkspacePageState(data);
  const task = pageData.task;
  const [isEditExpanded, setIsEditExpanded] = useState(false);
  const toggleEditExpanded = useCallback(() => {
    setIsEditExpanded((current) => !current);
  }, []);

  const {
    hasUnsavedConfigChanges,
    isSaving,
    saveError,
    setSaveError,
    saveSuccess,
    taskConfigInitialValues,
    draftEditableTask,
    editSummary,
    handleTaskConfigDraftStateChange,
    persistTaskConfig,
  } = useTaskWorkspaceEditorState(task, setTask);

  const {
    plan,
    fetchPlan,
    planGenerationStatus,
    graphPlan,
    canAcceptPlan,
    isGraphPlanPending,
    acceptPlanError,
    setAcceptPlanError,
    generationUserInstruction,
    runtimeEvents,
    liveActivity,
    latestActivitySummary,
    currentExecution,
    acceptPlanById,
    dispatchExecutionAction,
    submitCheckpointAction,
    handleAcceptResult,
    isAcceptingResult,
    acceptResultError,
    handleGeneratePlanFromHeader,
    handleStopPlanGeneration,
  } = useTaskWorkspacePlanState(task, refreshWorkspace, workspaceEvents);
  const goalPromotionAction =
    pageData.resultReview?.status === "accepted" &&
    !task.goalId &&
    pageData.artifacts.length > 0 ? (
      <CreateGoalFromResultDialog
        taskId={task.id}
        workspaceId={task.workspaceId}
        acceptedRunId={pageData.resultReview.runId}
        taskTitle={task.title}
        taskDescription={task.description}
        artifacts={pageData.artifacts}
        copy={messages.pages.goals}
      />
    ) : null;
  const isTaskRunning =
    task.status === "Running" ||
    currentExecution?.status === "running" ||
    currentExecution?.status === "started";
  const consoleView = useMemo(
    () =>
      createTaskWorkspaceExecutionConsoleView({
        pageData,
        graphPlan,
        copy: executionConsoleCopy,
      }),
    [pageData, graphPlan, executionConsoleCopy],
  );
  const assistantActivitySummary =
    latestActivitySummary ?? getLatestPersistedActivitySummary(pageData);
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
  const assistantContext = useMemo(
    () =>
      createTaskAiSidebarContext(task, {
        latestActivitySummary: assistantActivitySummary,
      }),
    [
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
    ],
  );

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
  }, [
    assistantContext,
    handleApplyProposal,
    handleCancelProposal,
    registerHandlers,
    setPageContext,
  ]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 xl:overflow-hidden">
      <div className="shrink-0">
        <TaskWorkspaceHeaderEditor
          task={consoleView.task}
          spec={headerSpec}
          store={headerStore}
          onAcceptPlan={() =>
            acceptHeaderPlan({
              plan,
              canAcceptPlan,
              setAcceptPlanError,
              acceptPlanById,
            })
          }
          onGeneratePlan={handleGeneratePlanFromHeader}
          onStopPlanGeneration={handleStopPlanGeneration}
          hideGeneratePlan={planGenerationStatus === "idle" && !plan}
          hideAcceptPlan={false}
          onRestartPlan={async () => {
            await dispatchExecutionAction({
              action: "restart_from_beginning",
              prompt: "Restarted from task workspace",
            });
          }}
          onAction={async (action) => {
            if (action.id === "start") {
              await dispatchExecutionAction({ action: "start_manual" });
            }
            if (action.id === "pause") {
              await dispatchExecutionAction({
                action: "pause_session",
                reason: "Paused from task workspace",
              });
            }
            if (action.id === "stop") {
              await dispatchExecutionAction({
                action: "cancel_session",
                reason: "Stopped from task workspace",
              });
            }
          }}
          onRecoveryRetry={() => {
            // Clearing the error keys first lets the header render the
            // disabled "Generate plan" button while the new stream opens;
            // the next `state.update` will repopulate error fields if it
            // fails again.
            headerStore.set("/plan/generation/error/code", null);
            headerStore.set("/plan/generation/error/message", null);
            headerStore.set("/plan/generation/error/buttonRetry", false);
            headerStore.set(
              "/plan/generation/error/buttonEditInstruction",
              false,
            );
            headerStore.set("/plan/generation/error/buttonCancel", false);
            void handleGeneratePlanFromHeader();
          }}
          onRecoveryEditInstruction={() => {
            headerStore.set("/plan/generation/error/code", null);
            headerStore.set("/plan/generation/error/message", null);
            headerStore.set("/plan/generation/error/buttonRetry", false);
            headerStore.set(
              "/plan/generation/error/buttonEditInstruction",
              false,
            );
            headerStore.set("/plan/generation/error/buttonCancel", false);
            setAcceptPlanError(null);
            setSaveError(null);
            setIsEditExpanded(true);
          }}
          onRecoveryCancel={() => {
            headerStore.set("/plan/generation/error/code", null);
            headerStore.set("/plan/generation/error/message", null);
            headerStore.set("/plan/generation/error/buttonRetry", false);
            headerStore.set(
              "/plan/generation/error/buttonEditInstruction",
              false,
            );
            headerStore.set("/plan/generation/error/buttonCancel", false);
          }}
          isEditExpanded={isEditExpanded}
          onToggleEditExpanded={toggleEditExpanded}
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
            availableAiClients: data.availableAiClients,
            disableAiClientSelection: isTaskRunning,
            aiClientSelectionDisabledHint: isTaskRunning
              ? "AI provider cannot be changed while task is running."
              : undefined,
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
      <TaskWorkspacePlanSection
        label={copy.planPanelTitle ?? "Plan"}
        commandCenterCopy={{
          nowTab: copy.commandCenterNowTab,
          outputTab: copy.commandCenterOutputTab,
          trailTab: copy.commandCenterTrailTab,
        }}
        graphPlan={graphPlan}
        isGraphPlanPending={isGraphPlanPending}
        pageData={pageData}
        commandCenter={commandCenter}
        plan={plan}
        planGenerationStatus={planGenerationStatus}
        canAcceptPlan={canAcceptPlan}
        acceptPlanError={acceptPlanError}
        onEditBrief={toggleEditExpanded}
        generationUserInstruction={generationUserInstruction}
        runtimeEvents={runtimeEvents}
        liveActivity={liveActivity}
        currentExecution={currentExecution}
        onGeneratePlan={handleGeneratePlanFromHeader}
        onApplyPlan={async (result) => {
          if (!result.id) return;
          setAcceptPlanError(null);
          await acceptPlanById(result.id);
        }}
        onDispatchExecutionAction={dispatchExecutionAction}
        onSubmitCheckpointAction={submitCheckpointAction}
        onAcceptResult={handleAcceptResult}
        isAcceptingResult={isAcceptingResult}
        acceptResultError={acceptResultError}
        createGoalAction={goalPromotionAction}
      />
    </div>
  );
}
