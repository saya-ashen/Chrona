"use client";

import { useMemo } from "react";
import { useI18n } from "@chrona/i18n";
import { applyPresetValues } from "./task-config-form-conversions";
import { TaskConfigFormFooter, TaskConfigFormPresets, TaskConfigFormSections } from "./task-config-form-sections";
import { useTaskConfigFormState } from "./task-config-form-state";
import type { TaskConfigCopy, TaskConfigFormProps } from "./task-config-form-types";
import type { RecurrencePreset } from "../recurrence-presets";

const DEFAULT_COPY = {
  moreOptions: "More options", starterPresets: "Starter presets", title: "Title", basics: "Basics", titlePlaceholder: "Add the next task to execute", priority: "Priority", dueDate: "Due date", schedule: "Schedule", scheduleHint: "Adjust when this block should run.", scheduleDate: "Date", scheduleStart: "Start", scheduleEnd: "End", scheduleDuration: "Duration",
  priorities: { Low: "Low", Medium: "Medium", High: "High", Urgent: "Urgent" }, recurrence: "Repeat", recurrenceDescription: "Create independent task occurrences from this schedule.", recurrencePresets: { none: "Does not repeat", daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom RRULE" }, recurrenceCustomLabel: "RRULE", recurrenceCustomPlaceholder: "e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR", adapter: "Adapter", aiProvider: "AI provider", defaultAiProvider: "Default provider", aiProviderHint: "Override provider for this task.", advancedFields: "Advanced fields", description: "Description", chronaNotes: "Chrona notes", chronaNotesPlaceholder: "Add local context, instructions, or desired outcome", chronaNotesHelp: "Stored only in Chrona. It does not update the calendar source.", chronaNotesEmpty: "No Chrona notes yet.", calendarDescription: "Calendar description", descriptionPlaceholder: "Optional execution context or desired outcome", runtimeParams: "Additional runtime params (JSON)", runtimeParamsPlaceholder: '{"customFlag": true}', automation: "Automation", autoPlanGeneration: "Auto-generate plan", autoPlanGenerationDescription: "Create a draft execution plan automatically. You can turn this off unless auto-execute is enabled.", autoExecute: "Auto-execute at scheduled time", autoExecuteDescription: "Force plan generation on, accept the generated plan, then start execution at the scheduled time.", automationTimingLabel: "Start timing", automationTiming: { immediate: "Immediately", at_start: "At scheduled start", before_30m: "30 minutes before start", before_1h: "1 hour before start", before_2h: "2 hours before start", before_1d: "1 day before start" }, errorInvalidJson: "Runtime params must be valid JSON", errorJsonObject: "Runtime params must be a JSON object", errorIncompleteSchedule: "Set date, start, and end time together", errorInvalidScheduleRange: "End time must be after start time", actionFailed: "Action failed",
} as const satisfies TaskConfigCopy;

function useTaskConfigCopy() {
  const { messages } = useI18n();
  const taskConfigFormMessages = messages.components.taskConfigForm;
  return useMemo(() => ({
    ...DEFAULT_COPY,
    ...taskConfigFormMessages,
    priorities: { ...DEFAULT_COPY.priorities, ...taskConfigFormMessages.priorities },
    automationTiming: { ...DEFAULT_COPY.automationTiming, ...taskConfigFormMessages.automationTiming },
    recurrencePresets: {
      ...DEFAULT_COPY.recurrencePresets,
      ...((taskConfigFormMessages as { recurrencePresets?: Partial<Record<RecurrencePreset, string>> } | undefined)?.recurrencePresets ?? {}),
    },
  }), [taskConfigFormMessages]);
}

export function TaskConfigForm({
  executionRuntimes,
  defaultExecutionRuntime,
  compact = false,
  initialValues,
  lockedFields = [],
  lockedFieldsHint,
  sourceDescription,
  sourceDescriptionLabel,
  availableAiClients = [],
  disableAiClientSelection = false,
  aiClientSelectionDisabledHint,
  submitLabel,
  pendingLabel,
  isPending = false,
  presets,
  footerActions,
  formId,
  hideFooter = false,
  onDraftStateChange,
  onSubmitAction,
}: TaskConfigFormProps) {
  const copy = useTaskConfigCopy();
  const form = useTaskConfigFormState({
    executionRuntimes,
    defaultExecutionRuntime,
    initialValues,
    onDraftStateChange,
    onSubmitAction,
    copy,
  });
  const lockedFieldSet = useMemo(() => new Set(lockedFields), [lockedFields]);
  const isTitleLocked = lockedFieldSet.has("title");
  const isScheduleLocked = lockedFieldSet.has("scheduledStartAt") || lockedFieldSet.has("scheduledEndAt");
  const applyPreset = (preset: NonNullable<typeof presets>[number]) => {
    form.replaceFormState(applyPresetValues(form.getValues(), preset.values, executionRuntimes, defaultExecutionRuntime));
  };

  return (
    <div className="space-y-3">
      {form.localErrorMessage ? <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.localErrorMessage}</p> : null}
      <TaskConfigFormPresets compact={compact} isPending={isPending} presets={presets} onApply={applyPreset} />
      <form id={formId} onSubmit={(event) => void form.handleSubmit(form.submitForm)(event)}>
        <div className="flex flex-col gap-3">
          <TaskConfigFormSections
            compact={compact}
            copy={copy}
            form={form}
            isPending={isPending}
            isTitleLocked={isTitleLocked}
            isScheduleLocked={isScheduleLocked}
            lockedFieldsHint={lockedFieldsHint}
            sourceDescription={sourceDescription}
            sourceDescriptionLabel={sourceDescriptionLabel}
            executionRuntimes={executionRuntimes}
            availableAiClients={availableAiClients}
            disableAiClientSelection={disableAiClientSelection}
            aiClientSelectionDisabledHint={aiClientSelectionDisabledHint}
          />
          <TaskConfigFormFooter footerActions={footerActions} hideFooter={hideFooter} isPending={isPending} pendingLabel={pendingLabel} submitLabel={submitLabel} />
        </div>
      </form>
    </div>
  );
}
