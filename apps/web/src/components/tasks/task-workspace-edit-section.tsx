import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ChevronDown, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  TaskConfigForm,
  type TaskConfigFormInput,
  type TaskConfigRuntimeAdapter,
  type TaskConfigDraftState,
} from "@/components/schedule/task-config-form";
import { TaskWorkspaceDiffPreview } from "@/components/tasks/task-workspace-diff-preview";
import type { CurrentProposalState } from "@/components/tasks/task-workspace-types";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";

type TaskWorkspaceEditSectionProps = {
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
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
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isSaving,
  taskConfigInitialValues,
  saveSuccess,
  saveError,
  editSummary,
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
  const floatingPanelRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isEditExpanded) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onToggleExpanded();
      }
    };

    document.addEventListener("keydown", handleEscape);

    const focusTarget = floatingPanelRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
    );
    focusTarget?.focus();

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isEditExpanded, onToggleExpanded]);

  return (
    <div className="relative">
      <div className="flex flex-wrap items-start justify-between gap-2.5 px-1">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-primary/75">
              Edit task
            </span>
            {hasUnsavedConfigChanges ? (
              <StatusBadge tone="warning">Unsaved</StatusBadge>
            ) : null}
          </div>

          <p className="line-clamp-1 text-sm text-muted-foreground md:line-clamp-2">
            {editSummary.description}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
              {editSummary.schedule}
            </span>
            <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
              {editSummary.model}
            </span>
          </div>
        </div>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onToggleExpanded}
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: "rounded-xl",
            })}
          >
            {isEditExpanded ? "Close editor" : "Edit"}
            <ChevronDown
              className={`size-4 transition-transform ${isEditExpanded ? "rotate-180" : "rotate-0"}`}
            />
          </button>
        </div>
      </div>

      {isMounted && typeof document !== "undefined"
        ? createPortal(
            <div
              className={cn(
                "fixed inset-0 z-[140] flex items-end justify-center bg-black/20 p-0 backdrop-blur-[2px] sm:items-center sm:p-6",
                isEditExpanded
                  ? "pointer-events-auto opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              aria-hidden={!isEditExpanded}
            >
              <button
                type="button"
                tabIndex={isEditExpanded ? 0 : -1}
                aria-label="Close task editor"
                onClick={onToggleExpanded}
                className="absolute inset-0 cursor-default"
              />
              <div
                ref={floatingPanelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Edit task"
                className="relative z-10 flex h-[100dvh] w-full flex-col sm:h-auto sm:max-h-[min(88vh,56rem)] sm:max-w-4xl"
              >
                <SurfaceCard
                  variant="inset"
                  padding="sm"
                  className="flex h-full min-h-0 flex-col rounded-none border-x-0 border-y-0 border-border/70 bg-background/96 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur sm:rounded-[1.35rem] sm:border-x sm:border-y"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 px-1 pb-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Edit task</h3>
                      <p className="text-xs text-muted-foreground">
                        Full-screen editor. Keep changes here until you save them.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onToggleExpanded}
                      aria-label="Close task editor"
                      className={buttonVariants({
                        variant: "ghost",
                        size: "sm",
                        className: "size-8 rounded-xl p-0 text-muted-foreground",
                      })}
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto pt-3">
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
                    {saveSuccess ? (
                      <p className="mt-2 px-1 text-xs text-emerald-600">
                        Saved successfully
                      </p>
                    ) : null}
                    {saveError ? (
                      <p className="mt-2 px-1 text-xs text-red-600">{saveError}</p>
                    ) : null}
                  </div>
                </SurfaceCard>
              </div>
            </div>,
            document.body,
          )
        : null}

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
    </div>
  );
}
