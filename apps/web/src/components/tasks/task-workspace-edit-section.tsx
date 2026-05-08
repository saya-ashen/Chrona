import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { TaskConfigForm, type TaskConfigFormInput, type TaskConfigRuntimeAdapter, type TaskConfigDraftState } from "@/components/schedule/task-config-form";
import { TaskEditPanel } from "@/components/task/panels/task-edit-panel";
import { TaskWorkspaceDiffPreview } from "@/components/tasks/task-workspace-diff-preview";
import type { CurrentProposalState, EditableTask } from "@/components/tasks/task-workspace-types";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";

function priorityTone(priority: string) {
  if (priority === "Urgent") return "critical" as const;
  if (priority === "High") return "warning" as const;
  return "neutral" as const;
}

type TaskWorkspaceEditSectionProps = {
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isSaving: boolean;
  taskConfigInitialValues: ComponentProps<typeof TaskConfigForm>["initialValues"];
  saveSuccess: boolean;
  saveError: string | null;
  editSummary: { description: string; schedule: string; model: string };
  draftEditableTask: EditableTask;
  hasUnsavedConfigChanges: boolean;
  isEditExpanded: boolean;
  currentProposal: CurrentProposalState | null;
  isApplying: boolean;
  onToggleExpanded: () => void;
  onDraftStateChange: (state: TaskConfigDraftState) => void;
  onSubmitAction: (input: TaskConfigFormInput) => Promise<void>;
  onApplyProposal: (proposal: TaskWorkspaceUpdateProposal) => Promise<void>;
  onCancelProposal: () => void;
};

export function TaskWorkspaceEditSection({
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isSaving,
  taskConfigInitialValues,
  saveSuccess,
  saveError,
  editSummary,
  draftEditableTask,
  hasUnsavedConfigChanges,
  isEditExpanded,
  currentProposal,
  isApplying,
  onToggleExpanded,
  onDraftStateChange,
  onSubmitAction,
  onApplyProposal,
  onCancelProposal,
}: TaskWorkspaceEditSectionProps) {
  return (
    <>
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
            onClick={onToggleExpanded}
            className={buttonVariants({ variant: "ghost", size: "sm", className: "rounded-xl" })}
          >
            {isEditExpanded ? "Collapse" : "Edit"}
            <ChevronDown className={`size-4 transition-transform ${isEditExpanded ? "rotate-180" : "rotate-0"}`} />
          </button>
        )}
      />

      {isEditExpanded ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.75rem)] z-30">
          <SurfaceCard
            variant="inset"
            padding="sm"
            className="rounded-[1.35rem] border-border/70 bg-background/96 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur"
          >
            <TaskConfigForm
              runtimeAdapters={runtimeAdapters}
              defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
              isPending={isSaving}
              initialValues={taskConfigInitialValues}
              submitLabel="Save changes"
              pendingLabel="Saving..."
              onDraftStateChange={onDraftStateChange}
              onSubmitAction={onSubmitAction}
            />
            {saveSuccess ? <p className="mt-2 px-1 text-xs text-emerald-600">Saved successfully</p> : null}
            {saveError ? <p className="mt-2 px-1 text-xs text-red-600">{saveError}</p> : null}
          </SurfaceCard>
        </div>
      ) : null}

      {currentProposal ? (
        <TaskWorkspaceDiffPreview
          proposal={currentProposal.proposal}
          originalTask={currentProposal.originalTask}
          onApply={onApplyProposal}
          onCancel={onCancelProposal}
          isApplying={isApplying}
          applyError={saveError}
        />
      ) : null}
    </>
  );
}
