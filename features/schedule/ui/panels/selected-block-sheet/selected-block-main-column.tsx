"use client";

import { AlertCircle, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SchedulePageCopy } from "../../schedule-page-copy";
import type { ScheduleRecord } from "../../schedule-page-types";
import { toTaskConfigInitialValues } from "../../schedule-page-utils";
import {
  TaskConfigForm,
  type TaskConfigDraftState,
  type TaskConfigFormDraft,
  type TaskConfigExecutionRuntime,
  type TaskConfigFormInput,
} from "../../forms/task-config-form";
import {
  TaskAiPlanPanel,
  TaskEditPanel,
} from "@features/task-workspace";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";
import type { TaskPlanReadModel } from "@chrona/contracts"
import type { SavedTaskPlan } from "./use-selected-block-plan-state";

function sourceLabel(item: ScheduleRecord, copy: SchedulePageCopy) {
  if (item.sourceManaged) return `${copy.selectedBlockSourceCalendar}: ${item.sourceManaged.sourceName}`;
  if (item.scheduleSource === "ai") return copy.selectedBlockSourceAi;
  return copy.selectedBlockSourceHuman;
}

function automationLabel(item: ScheduleRecord, copy: SchedulePageCopy) {
  if (item.autoExecute) return copy.selectedBlockAutomationExecute;
  if (item.autoPlanGeneration) return copy.selectedBlockAutomationPlan;
  return copy.selectedBlockAutomationManual;
}

function needsRecovery(item: ScheduleRecord) {
  const state = item.stateView?.state;
  return state === "failed" || state === "blocked" || state === "waiting_for_input" || state === "waiting_for_approval";
}

export function SelectedBlockMainColumn({
  formId = "selected-task-config-form",
  item,
  copy,
  executionRuntimes,
  defaultExecutionRuntime,
  availableAiClients,
  isPending,
  planningTaskDraft,
  savedPlan,
  generationStatus,
  acceptedPlan,
  hasUnsavedConfigChanges,
  unsavedConfigDraft,
  onDeleteTask,
  onTaskConfigDraftStateChange,
  onSaveTaskConfig,
  onPlanLoaded,
  onApplyPlan,
  onSaveConfigBeforeRegenerate,
  initialTab,
}: {
  item: ScheduleRecord;
  copy: SchedulePageCopy;
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  availableAiClients?: Parameters<typeof TaskConfigForm>[0]["availableAiClients"];
  isPending: boolean;
  planningTaskDraft: TaskConfigFormDraft;
  savedPlan: SavedTaskPlan | null;
  generationStatus: "idle" | "generating" | "waiting_acceptance" | "accepted";
  acceptedPlan: TaskPlanReadModel | null;
  hasUnsavedConfigChanges: boolean;
  unsavedConfigDraft: TaskConfigFormDraft | null;
  onDeleteTask?: (taskId: string) => void;
  onTaskConfigDraftStateChange: (state: TaskConfigDraftState) => void;
  onSaveTaskConfig: (input: TaskConfigFormInput) => Promise<void>;
  onPlanLoaded: (savedPlan: SavedTaskPlan | null) => void;
  onApplyPlan: (result: TaskPlanReadModel) => Promise<void>;
  onSaveConfigBeforeRegenerate: () => Promise<void>;
  formId?: string;
  initialTab?: "details" | "execution" | "plan";
}) {
  const [activeTab, setActiveTab] = useState(initialTab ?? "details");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const providerName = item.aiClientName ?? availableAiClients?.find((client) => client.id === item.aiClientId)?.name ?? null;
  const providerLabel = providerName ?? (availableAiClients?.some((client) => client.enabled)
    ? copy.selectedBlockDefaultProvider
    : copy.selectedBlockProviderUnconfigured);
  const executionStatus = item.stateView?.label ?? item.displayState ?? item.latestRunStatus ?? copy.noActiveRun;
  const recoveryHref = `/tasks/${item.taskId}${item.workBlockId ? `?workBlockId=${encodeURIComponent(item.workBlockId)}` : ""}`;


  return (
    <div
      data-testid="selected-block-main-column"
      className="min-w-0 px-4 py-4 text-sm text-muted-foreground sm:px-6"
    >
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "details" | "execution" | "plan")} className="min-h-0">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="details">{copy.taskDetails}</TabsTrigger>
          <TabsTrigger value="execution">{copy.selectedBlockExecutionStatus}</TabsTrigger>
          <TabsTrigger value="plan">{copy.currentPlan}</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <TaskEditPanel>
            <TaskConfigForm
              formId={formId}
              hideFooter
              compact
              executionRuntimes={executionRuntimes}
              defaultExecutionRuntime={defaultExecutionRuntime}
              isPending={isPending}
              initialValues={toTaskConfigInitialValues(item)}
              lockedFields={item.sourceManaged?.immutableFields}
              lockedFieldsHint={item.sourceManaged ? `Synced from ${item.sourceManaged.sourceName}. Title and time are managed by the calendar source.` : undefined}
              sourceDescription={item.sourceManaged?.description ?? null}
              availableAiClients={availableAiClients}
              submitLabel={copy.saveTaskConfig}
              pendingLabel={copy.saving}
              onDraftStateChange={onTaskConfigDraftStateChange}
              onSubmitAction={onSaveTaskConfig}
            />
          </TaskEditPanel>
        </TabsContent>

        <TabsContent value="execution" className="mt-4 space-y-4">
          <section className="rounded-2xl border border-border/70 bg-muted/20 p-4" aria-label={copy.selectedBlockOverview}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.source}</p>
                <p className="mt-1 text-sm font-medium text-foreground">{sourceLabel(item, copy)}</p>
                {item.sourceManaged ? <p className="mt-1 text-xs text-muted-foreground">{copy.selectedBlockReadOnlyCalendar}</p> : null}
              </div>
              <div className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">{automationLabel(item, copy)}</div>
            </div>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
              <div><dt>{copy.selectedBlockProvider}</dt><dd className="mt-1 font-medium text-foreground">{providerLabel}</dd></div>
              <div><dt>{copy.selectedBlockExecutionStatus}</dt><dd className="mt-1 font-medium text-foreground">{executionStatus}</dd></div>
              <div><dt>{copy.nextAction}</dt><dd className="mt-1 font-medium text-foreground">{item.stateView?.nextActionLabel ?? copy.stayOnPlan}</dd></div>
            </dl>
            {item.autoStartReason ? <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-200"><AlertCircle className="size-3.5" />{copy.autoStartReasonLabel}: {item.autoStartReason}</p> : null}
            {needsRecovery(item) ? <a className="mt-3 flex items-center gap-2 text-xs font-medium text-primary hover:underline" href={recoveryHref}><ExternalLink className="size-3.5" />{copy.selectedBlockOpenWorkspace}</a> : null}
          </section>
        </TabsContent>

        <TabsContent value="plan" className="mt-4">
          <TaskAiPlanPanel
            taskId={item.taskId}
            planningTaskDraft={planningTaskDraft}
            previewOnly
            savedPlan={savedPlan}
            generationStatus={generationStatus}
            acceptedPlanId={acceptedPlan?.id ?? null}
            hasUnsavedConfigChanges={hasUnsavedConfigChanges}
            unsavedConfigDraft={unsavedConfigDraft}
            onPlanLoaded={onPlanLoaded}
            onApplyPlan={onApplyPlan}
            onSaveConfigBeforeRegenerate={onSaveConfigBeforeRegenerate}
          />
        </TabsContent>

        {onDeleteTask ? (
          <div className="mt-4 border-t border-border/60 pt-4">
            {showDeleteConfirm ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <span>Delete &ldquo;{item.title}&rdquo;?</span>
                <Button type="button" onClick={() => onDeleteTask(item.taskId)} variant="destructive" size="sm">Confirm delete</Button>
                <Button type="button" onClick={() => setShowDeleteConfirm(false)} variant="ghost" size="sm">{copy.cancel}</Button>
              </div>
            ) : (
              <Button type="button" onClick={() => setShowDeleteConfirm(true)} variant="ghost" size="sm" className="text-destructive hover:bg-destructive/5 hover:text-destructive"><Trash2 />Delete task</Button>
            )}
          </div>
        ) : null}
      </Tabs>
    </div>
  );
}
