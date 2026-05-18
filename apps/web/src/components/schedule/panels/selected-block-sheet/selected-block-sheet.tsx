"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import { useI18n, useLocale } from "@/i18n/client";
import { SelectedBlockMainColumn } from "@/components/schedule/panels/selected-block-sheet/selected-block-main-column";
import { SelectedBlockSheetHeader } from "@/components/schedule/panels/selected-block-sheet/selected-block-sheet-header";
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
  const [isMounted, setIsMounted] = useState(false);
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

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label={copy.closeTaskDetails}
        className="fixed inset-0 z-[120] bg-slate-950/35 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-task-sheet-title"
        className="fixed inset-x-0 bottom-0 z-[130] max-h-[92vh] rounded-t-[2rem] border border-border/70 bg-background shadow-[0_-24px_80px_-32px_rgba(15,23,42,0.55)] md:inset-y-4 md:left-1/2 md:w-[min(1180px,calc(100vw-2rem))] md:max-h-none md:-translate-x-1/2 md:rounded-[2rem]"
      >
        <div className="flex max-h-[92vh] min-h-0 flex-col md:max-h-[calc(100vh-2rem)]">
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
      </section>
    </>,
    document.body,
  );
}
