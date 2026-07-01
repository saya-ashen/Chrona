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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="z-[130] max-h-[calc(100vh-1rem)] overflow-hidden rounded-[1.5rem] border border-border/70 bg-background p-0 text-foreground shadow-[0_24px_90px_-32px_rgba(15,23,42,0.55)] sm:max-w-none md:max-h-[calc(100vh-2rem)] md:w-[min(1180px,calc(100vw-2rem))] md:rounded-[2rem]"
      >
        <DialogTitle className="sr-only">{copy.taskDetails}</DialogTitle>
        <DialogDescription className="sr-only">{copy.closeTaskDetails}</DialogDescription>
        <div className="flex max-h-[calc(100vh-1rem)] min-h-0 flex-col overflow-hidden md:max-h-[calc(100vh-2rem)]">
          <SelectedBlockSheetHeader
            item={item}
            locale={locale}
            copy={copy}
            onClose={onClose}
          />

          <div className="min-h-0 flex-1 select-text overflow-y-auto">
            <div>
              <SelectedBlockMainColumn
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
