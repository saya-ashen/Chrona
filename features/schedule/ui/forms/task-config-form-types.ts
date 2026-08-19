import type { ReactNode } from "react";
import type { AutomationTimingPreset } from "@chrona/contracts";
import type { RuntimeInput } from "@chrona/runtime-core";
import type { TaskConfigAiClient, TaskConfigExecutionRuntime } from "@features/task-workspace/public/workspace-integration";
import type { RecurrencePreset } from "../recurrence-presets";

export type { TaskConfigFormDraft } from "@features/task-workspace/public/task-config-draft";
import type { TaskConfigFormDraft } from "@features/task-workspace/public/task-config-draft";

export type TaskConfigFormInput = TaskConfigFormDraft & {
  executionRuntime: string;
  executionConfig: RuntimeInput;
  aiClientId: string | null;
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  autoPlanGenerationTiming: AutomationTimingPreset;
  autoExecuteTiming: AutomationTimingPreset;
  recurrenceRule: string | null;
  recurrenceAnchorStartAt: Date | null;
  recurrenceAnchorEndAt: Date | null;
};

export type TaskConfigPreset = {
  id: string;
  label: string;
  description: string;
  values: Partial<TaskConfigFormInput>;
};

export type TaskConfigFormState = {
  title: string;
  description: string;
  priority: TaskConfigFormInput["priority"];
  dueAt: string;
  scheduledDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  executionRuntime: string;
  fieldExecutionConfig: RuntimeInput;
  extraExecutionConfig: string;
  aiClientId: string;
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  autoPlanGenerationTiming: AutomationTimingPreset;
  autoExecuteTiming: AutomationTimingPreset;
  recurrenceMode: RecurrencePreset;
  recurrenceCustomRule: string;
};

export type TaskConfigDraftState = { isDirty: boolean; values: TaskConfigFormInput };

export type TaskConfigInitialValues = {
  title?: string;
  description?: string | null;
  priority?: TaskConfigFormInput["priority"];
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  executionRuntime?: string | null;
  executionConfig?: unknown;
  aiClientId?: string | null;
  autoPlanGeneration?: boolean;
  autoExecute?: boolean;
  autoPlanGenerationTiming?: AutomationTimingPreset | string | null;
  autoExecuteTiming?: AutomationTimingPreset | string | null;
  recurrenceRule?: string | null;
};

export type TaskConfigFormProps = {
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  compact?: boolean;
  formId?: string;
  hideFooter?: boolean;
  initialValues?: TaskConfigInitialValues;
  lockedFields?: readonly ("title" | "scheduledStartAt" | "scheduledEndAt")[];
  lockedFieldsHint?: string;
  sourceDescription?: string | null;
  sourceDescriptionLabel?: string;
  availableAiClients?: TaskConfigAiClient[];
  disableAiClientSelection?: boolean;
  aiClientSelectionDisabledHint?: string;
  submitLabel: string;
  pendingLabel: string;
  isPending?: boolean;
  presets?: TaskConfigPreset[];
  footerActions?: ReactNode;
  onDraftStateChange?: (state: TaskConfigDraftState) => void;
  onSubmitAction: (input: TaskConfigFormInput) => Promise<void> | void;
};

export type TaskConfigCopy = {
  moreOptions: string;
  starterPresets: string;
  title: string;
  basics: string;
  titlePlaceholder: string;
  priority: string;
  dueDate: string;
  schedule: string;
  scheduleHint: string;
  scheduleDate: string;
  scheduleStart: string;
  scheduleEnd: string;
  scheduleDuration: string;
  priorities: Record<TaskConfigFormInput["priority"], string>;
  recurrence: string;
  recurrenceDescription: string;
  recurrencePresets: Record<RecurrencePreset, string>;
  recurrenceCustomLabel: string;
  recurrenceCustomPlaceholder: string;
  adapter: string;
  aiProvider: string;
  defaultAiProvider: string;
  aiProviderHint: string;
  advancedFields: string;
  description: string;
  chronaNotes: string;
  chronaNotesPlaceholder: string;
  chronaNotesHelp: string;
  chronaNotesEmpty: string;
  calendarDescription: string;
  descriptionPlaceholder: string;
  runtimeParams: string;
  runtimeParamsPlaceholder: string;
  automation: string;
  autoPlanGeneration: string;
  autoPlanGenerationDescription: string;
  autoExecute: string;
  autoExecuteDescription: string;
  automationTimingLabel: string;
  automationTiming: Record<AutomationTimingPreset, string>;
  errorInvalidJson: string;
  errorJsonObject: string;
  errorIncompleteSchedule: string;
  errorInvalidScheduleRange: string;
  actionFailed: string;
};

export type { TaskConfigAiClient, TaskConfigExecutionRuntime };
