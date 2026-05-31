import { type ComponentProps } from "react";
import { X } from "lucide-react";
import {
  TaskConfigForm,
  type TaskConfigExecutionRuntime,
  type TaskConfigFormInput,
  type TaskConfigDraftState,
} from "@/components/schedule/forms/task-config-form";
import { TaskWorkspaceDiffPreview } from "../assistant/task-workspace-diff-preview";
import type { CurrentProposalState } from "../model/task-workspace-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";

type TaskWorkspaceEditSectionProps = {
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  isSaving: boolean;
  taskConfigInitialValues: ComponentProps<
    typeof TaskConfigForm
  >["initialValues"];
  saveSuccess: boolean;
  saveError: string | null;
  editSummary: { description: string; schedule: string; model: string };
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
  executionRuntimes,
  defaultExecutionRuntime,
  isSaving,
  taskConfigInitialValues,
  saveSuccess,
  saveError,
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
  const handleOpenChange = (open: boolean) => {
    if (open !== isEditExpanded) {
      onToggleExpanded();
    }
  };

  return (
    <>
      <Dialog open={isEditExpanded} onOpenChange={handleOpenChange}>
        <DialogContent
          id="task-workspace-edit-section"
          showCloseButton={false}
          className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none bg-background/96 p-0 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur sm:h-auto sm:max-h-[min(88vh,56rem)] sm:max-w-4xl sm:rounded-[1.35rem] sm:border sm:border-border/70"
        >
          <DialogHeader className="flex-row items-start justify-between gap-3 border-b border-border/60 px-4 py-4 text-left sm:px-5">
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-sm font-semibold text-foreground">
                Edit task
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Full-screen editor. Keep changes here until you save them.
              </DialogDescription>
            </div>
            <DialogClose
              aria-label="Close task editor"
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 rounded-xl p-0 text-muted-foreground"
                />
              }
            >
              <X className="size-4" />
            </DialogClose>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <TaskConfigForm
              executionRuntimes={executionRuntimes}
              defaultExecutionRuntime={defaultExecutionRuntime}
              isPending={isSaving}
              initialValues={taskConfigInitialValues}
              submitLabel="Save changes"
              pendingLabel="Saving..."
              onDraftStateChange={onDraftStateChange}
              onSubmitAction={onSubmitAction}
            />
            {saveSuccess ? (
              <p className="mt-2 px-1 text-xs text-success">
                Saved successfully
              </p>
            ) : null}
            {saveError ? (
              <p className="mt-2 px-1 text-xs text-destructive">{saveError}</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {hasUnsavedConfigChanges ? (
        <span className="sr-only">Task has unsaved edits</span>
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
