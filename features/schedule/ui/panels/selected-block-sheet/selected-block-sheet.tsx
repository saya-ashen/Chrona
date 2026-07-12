"use client";

import { getSchedulePageCopy } from "../../schedule-page-copy";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { SelectedBlockMainColumn } from "./selected-block-main-column";
import { SelectedBlockSheetHeader } from "./selected-block-sheet-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SelectedBlockSheetProps } from "./types";
import { useSelectedBlockConfigState } from "./use-selected-block-config-state";
import { useSelectedBlockPlanState } from "./use-selected-block-plan-state";
import { Button } from "shared/ui/button";

export function SelectedBlockSheet({
  item,
  selectedDay: _selectedDay,
  executionRuntimes,
  defaultExecutionRuntime,
  availableAiClients,
  isPending,
  onClose,
  onSaveTaskConfigAction,
  onDeleteTask,
  onMutatedAction,
  buildScheduleHref: _buildScheduleHref,
}: SelectedBlockSheetProps) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components.schedulePage);
  const {
    displayedSavedPlan,
    generationStatus,
    acceptedPlan,
    handlePlanLoaded,
    handleApplyPlan,
  } = useSelectedBlockPlanState({ item, onMutatedAction });
  const {
    planningTaskDraft,
    taskConfigDraftState,
    handleTaskConfigDraftStateChange,
    saveTaskConfig,
    saveConfigBeforeRegenerate,
  } = useSelectedBlockConfigState({ item, onSaveTaskConfigAction });
  const requestClose = () => {
    if (taskConfigDraftState?.isDirty && !window.confirm(copy.closeTaskDetails)) return;
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="z-[130] flex max-h-[calc(100vh-2rem)] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-background p-0 text-foreground shadow-2xl sm:max-w-4xl"
      >
        <DialogTitle className="sr-only">{copy.taskDetails}</DialogTitle>
        <DialogDescription className="sr-only">{copy.closeTaskDetails}</DialogDescription>
        <div className="flex max-h-[calc(100vh-1rem)] min-h-0 flex-col overflow-hidden md:max-h-[calc(100vh-2rem)]">
          <SelectedBlockSheetHeader
            item={item}
            locale={locale}
            copy={copy}
            onClose={requestClose}
          />

          <div className="min-h-0 flex-1 select-text overflow-y-auto">
            <div>
              <SelectedBlockMainColumn
                formId="selected-task-config-form"
                item={item}
                copy={copy}
                executionRuntimes={executionRuntimes}
                defaultExecutionRuntime={defaultExecutionRuntime}
                availableAiClients={availableAiClients}
                isPending={isPending}
                planningTaskDraft={planningTaskDraft}
                savedPlan={displayedSavedPlan}
                generationStatus={generationStatus}
                acceptedPlan={acceptedPlan}
                hasUnsavedConfigChanges={Boolean(taskConfigDraftState?.isDirty)}
                unsavedConfigDraft={taskConfigDraftState?.values ?? null}
                onTaskConfigDraftStateChange={handleTaskConfigDraftStateChange}
                onSaveTaskConfig={saveTaskConfig}
                onDeleteTask={onDeleteTask}
                onPlanLoaded={handlePlanLoaded}
                onApplyPlan={handleApplyPlan}
                onSaveConfigBeforeRegenerate={saveConfigBeforeRegenerate}
              />
            </div>
          </div>
          <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t border-border/60 bg-background/95 px-4 py-3 shadow-[0_-8px_20px_rgba(15,23,42,0.06)] backdrop-blur sm:px-6 sm:py-4">
            {taskConfigDraftState?.isDirty ? <span className="mr-auto text-xs text-muted-foreground">{copy.saveTaskConfig}</span> : null}
            <Button type="button" variant="ghost" size="sm" onClick={requestClose} disabled={isPending}>{copy.cancel}</Button>
            <Button type="submit" form="selected-task-config-form" size="sm" disabled={isPending || !taskConfigDraftState?.isDirty}>
              {isPending ? copy.saving : copy.saveTaskConfig}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
