"use client";

import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { SelectedBlockMainColumn } from "@/components/schedule/panels/selected-block-sheet/selected-block-main-column";
import { SelectedBlockSheetHeader } from "@/components/schedule/panels/selected-block-sheet/selected-block-sheet-header";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { SelectedBlockSheetProps } from "@/components/schedule/panels/selected-block-sheet/types";
import { useSelectedBlockConfigState } from "@/components/schedule/panels/selected-block-sheet/use-selected-block-config-state";
import { useSelectedBlockPlanState } from "@/components/schedule/panels/selected-block-sheet/use-selected-block-plan-state";

export function SelectedBlockSheet({
  item,
  selectedDay: _selectedDay,
  executionRuntimes,
  defaultExecutionRuntime,
  isPending,
  onClose,
  onSaveTaskConfigAction,
  onDeleteTask,
  onMutatedAction,
  buildScheduleHref: _buildScheduleHref,
}: SelectedBlockSheetProps) {
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = getSchedulePageCopy(messages.components?.schedulePage);
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
    <Drawer
      open
      defaultOpen
      direction="bottom"
      noBodyStyles
      shouldScaleBackground={false}
      setBackgroundColorOnScale={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        overlayClassName="data-open:!animate-none data-closed:!animate-none"
        className="z-[130] max-h-[92vh] rounded-t-[2rem] border border-border/70 bg-background shadow-[0_-24px_80px_-32px_rgba(15,23,42,0.55)] data-open:!animate-none data-closed:!animate-none md:!bottom-auto md:!left-1/2 md:!right-auto md:!top-1/2 md:!mt-0 md:!h-auto md:!max-h-[calc(100vh-2rem)] md:!overflow-hidden md:w-[min(1180px,calc(100vw-2rem))] md:!-translate-x-1/2 md:!-translate-y-1/2 md:rounded-[2rem] md:shadow-[0_24px_90px_-32px_rgba(15,23,42,0.55)]"
      >
        <DrawerTitle className="sr-only">{copy.taskDetails}</DrawerTitle>
        <DrawerDescription className="sr-only">{copy.closeTaskDetails}</DrawerDescription>
        <div className="flex max-h-[92vh] min-h-0 flex-col overflow-hidden md:h-auto md:max-h-[calc(100vh-2rem)]">
          <SelectedBlockSheetHeader
            item={item}
            locale={locale}
            copy={copy}
            onClose={onClose}
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div>
              <SelectedBlockMainColumn
                item={item}
                copy={copy}
                executionRuntimes={executionRuntimes}
                defaultExecutionRuntime={defaultExecutionRuntime}
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
      </DrawerContent>
    </Drawer>
  );
}
