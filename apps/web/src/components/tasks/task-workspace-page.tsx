"use client";

import { TaskWorkspaceAiSection } from "@/components/tasks/task-workspace-ai-section";
import { TaskWorkspacePlanSection } from "@/components/tasks/task-workspace-plan-section";
import { TaskWorkspaceEditSection } from "@/components/tasks/task-workspace-edit-section";
import { TaskWorkspaceHeaderCard } from "@/components/tasks/task-workspace-header-card";
import type { TaskPageData } from "@/components/tasks/task-workspace-types";
import { useTaskWorkspaceDeleteFlow } from "@/components/tasks/use-task-workspace-delete-flow";
import { useTaskWorkspaceEditorState } from "@/components/tasks/use-task-workspace-editor-state";
import { useTaskWorkspacePlanState } from "@/components/tasks/use-task-workspace-plan-state";
import { useTaskWorkspaceProposalFlow } from "@/components/tasks/use-task-workspace-proposal-flow";

type Props = {
  data: TaskPageData;
  copy?: Partial<typeof DEFAULT_COPY>;
};

const DEFAULT_COPY = {
  title: "Task Workspace",
  backToSchedule: "Back to Schedule",
  openWorkbench: "Open Workbench",
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
};

export function TaskWorkspacePage({ data, copy: copyProp }: Props) {
  const copy = { ...DEFAULT_COPY, ...copyProp };

  const {
    task,
    setTask,
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
  } = useTaskWorkspaceEditorState(data.task);

  const {
    plan,
    setPlan,
    fetchPlan,
    planGenerationStatus,
    graphPlan,
    canAcceptPlan,
    isAcceptingPlan,
    acceptPlanError,
    setAcceptPlanError,
    isAiWorkspaceOpen,
    setIsAiWorkspaceOpen,
    requestGenerationKey,
    acceptPlanById,
    handleAcceptPlan,
    dispatchExecutionAction,
    handleOpenAiWorkspace,
    handleGeneratePlanFromHeader,
    assistantBuildCurrentPlan,
  } = useTaskWorkspacePlanState(task);
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
  });
  const { showDeleteConfirm, setShowDeleteConfirm, isDeleting, handleDelete } =
    useTaskWorkspaceDeleteFlow({
      taskId: task.id,
      setSaveError,
    });
  return (
    <>
      <div className="h-full min-h-0 space-y-3 overflow-visible rounded-[1.75rem] border border-border/40 bg-[linear-gradient(180deg,hsl(var(--muted)/0.18),transparent_20%),hsl(var(--background))] p-2.5 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-3 xl:overflow-hidden">
        <TaskWorkspacePlanSection
          label={copy.planPanelTitle ?? "Plan"}
          topContent={
            <TaskWorkspaceHeaderCard
              task={task}
              backToScheduleLabel={copy.backToSchedule}
              showDeleteConfirm={showDeleteConfirm}
              isDeleting={isDeleting}
              onStartDeleteConfirm={() => setShowDeleteConfirm(true)}
              onCancelDeleteConfirm={() => setShowDeleteConfirm(false)}
              onDelete={() => void handleDelete()}
            >
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
                onToggleExpanded={() =>
                  setIsEditExpanded((current) => !current)
                }
                onDraftStateChange={handleTaskConfigDraftStateChange}
                onSubmitAction={persistTaskConfig}
                onApplyProposal={handleApplyProposal}
                onCancelProposal={handleCancelProposal}
              />
            </TaskWorkspaceHeaderCard>
          }
          graphPlan={graphPlan}
          plan={plan}
          planGenerationStatus={planGenerationStatus}
          canAcceptPlan={canAcceptPlan}
          isAcceptingPlan={isAcceptingPlan}
          acceptPlanError={acceptPlanError}
          onAcceptPlan={handleAcceptPlan}
          onGeneratePlan={handleGeneratePlanFromHeader}
          onDispatchExecutionAction={dispatchExecutionAction}
        />
      </div>

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
    </>
  );
}
