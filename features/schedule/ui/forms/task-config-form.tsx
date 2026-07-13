"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  Button,
  Calendar,
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  Textarea,
  cn,
} from "@shared/ui";
import { useI18n } from "@chrona/i18n"
import { CalendarIcon, Info } from "lucide-react";
import {
  deleteValueAtPath,
  getValueAtPath,
  setValueAtPath,
  validateTaskConfigAgainstSpec,
} from "@chrona/runtime-core";
import type { RuntimeInput, RuntimeTaskConfigField, RuntimeTaskConfigSpec } from "@chrona/runtime-core";
import {
  AUTOMATION_TIMING_PRESETS,
  normalizeAutomationTiming,
} from "@chrona/contracts";
import type { AutomationTimingPreset, AiClientRecord } from "@chrona/contracts";

import { RECURRENCE_PRESETS, recurrencePresetFromRule, recurrenceRuleFromState, type RecurrencePreset } from "../recurrence-presets";

export type TaskConfigFormDraft = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
};

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

export type TaskConfigExecutionRuntime = {
  key: string;
  label: string;
  spec: RuntimeTaskConfigSpec;
};

export type TaskConfigAiClient = Pick<AiClientRecord, "id" | "name" | "enabled">;

type TaskConfigPreset = {
  id: string;
  label: string;
  description: string;
  values: Partial<TaskConfigFormInput>;
};

type TaskConfigFormState = {
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

export type TaskConfigDraftState = {
  isDirty: boolean;
  values: TaskConfigFormInput;
};

type TaskConfigFormProps = {
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  compact?: boolean;
  formId?: string;
  hideFooter?: boolean;
  initialValues?: {
    title?: string;
    description?: string | null;
    priority?: "Low" | "Medium" | "High" | "Urgent";
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

type TaskConfigSelectOption = {
  value: string;
  label: string;
};
const EMPTY_SELECT_OPTION_VALUE = "__chrona_empty_select_value__";

export function TaskConfigField({
  label,
  hint,
  tooltip,
  titleClassName,
  hideTitle,
  htmlFor,
  invalid,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  tooltip?: string;
  titleClassName?: string;
  hideTitle?: boolean;
  htmlFor?: string;
  invalid?: boolean;
  error?: { message?: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={invalid} className={className}>
      <div className={cn("flex items-center gap-1.5", titleClassName, hideTitle && "sr-only")}>
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {tooltip ? <InfoPopover label={label} content={tooltip} /> : null}
      </div>
      {children}
      {invalid ? <FieldError errors={[error]} /> : null}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

export function InfoPopover({ label, content }: { label: string; content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} info`}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="!z-[1000] w-64 border-border/70 bg-popover text-left text-xs leading-5 shadow-xl"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

export function TaskConfigSection({
  title,
  info,
  actions,
  compact = false,
  children,
}: {
  title: string;
  info?: string;
  actions?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-[1.2rem] border border-border/60 bg-background/80 p-3 text-sm text-foreground shadow-sm", compact && "rounded-xl")}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <span className="truncate">{title}</span>
          {info ? <InfoPopover label={title} content={info} /> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function TaskConfigSelect({
  name,
  id,
  value,
  placeholder = "-",
  options,
  disabled,
  onValueChange,
}: {
  name: string;
  id?: string;
  value: string;
  placeholder?: string;
  options: TaskConfigSelectOption[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const triggerId = id ?? `task-config-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value);
  const selectValue = value === "" ? EMPTY_SELECT_OPTION_VALUE : value;

  return (
    <>
      <Input type="hidden" name={name} value={value} />
      <Select
        open={isOpen}
        value={selectValue}
        onOpenChange={(nextOpen) => setIsOpen(disabled ? false : nextOpen)}
        onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_SELECT_OPTION_VALUE ? "" : nextValue)}
        disabled={disabled}
      >
        <SelectTrigger id={triggerId} className="w-full" disabled={disabled}>
          <span data-slot="select-value" className={selectedOption ? undefined : "text-muted-foreground"}>
            {selectedOption?.label ?? placeholder}
          </span>
        </SelectTrigger>
        {isOpen ? (
          <SelectContent position="popper" className="z-[160] max-h-72">
            <SelectGroup>
              {options.map((option) => {
                const itemValue = option.value === "" ? EMPTY_SELECT_OPTION_VALUE : option.value;

                return (
                  <SelectItem key={itemValue} value={itemValue}>
                    {option.label}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        ) : null}
      </Select>
    </>
  );
}

export function TaskConfigDatePicker({
  name,
  value,
  placeholder,
  disabled,
  onValueChange,
}: {
  name: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const selectedDate = parseLocalDateInput(value);

  return (
    <>
      <Input type="hidden" name={name} value={value} />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-start px-3 text-left font-normal"
          >
            <CalendarIcon data-icon="inline-start" />
            {selectedDate ? formatLocalDateLabel(selectedDate) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="z-[160] w-auto p-0">
          <Calendar
            mode="single"
            selected={selectedDate ?? undefined}
            onSelect={(date) => onValueChange(formatLocalDateInput(date ?? null))}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

function TaskAutomationOption({
  label,
  description,
  checked,
  disabled,
  name,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  name: string;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <label className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-border/70 bg-background/90 px-3 py-2.5 text-sm text-foreground shadow-sm transition-colors has-[[data-state=checked]]:border-primary/35 has-[[data-state=checked]]:bg-primary/5">
      <Checkbox
        name={name}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange ? (nextChecked) => onCheckedChange(nextChecked === true) : undefined}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block font-medium leading-5">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function TaskAutomationSection({
  copy,
  autoPlanGeneration,
  autoExecute,
  autoPlanGenerationTiming,
  autoExecuteTiming,
  onAutoPlanGenerationChange,
  onAutoExecuteChange,
  onAutoPlanGenerationTimingChange,
  onAutoExecuteTimingChange,
  compact = false,
}: {
  copy: {
    automation: string;
    autoExecute: string;
    autoExecuteDescription: string;
    autoPlanGeneration: string;
    autoPlanGenerationDescription: string;
    automationTimingLabel: string;
    automationTiming: Record<AutomationTimingPreset, string>;
  };
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  autoPlanGenerationTiming: AutomationTimingPreset;
  autoExecuteTiming: AutomationTimingPreset;
  onAutoPlanGenerationChange: (checked: boolean) => void;
  onAutoExecuteChange: (checked: boolean) => void;
  onAutoPlanGenerationTimingChange: (value: AutomationTimingPreset) => void;
  onAutoExecuteTimingChange: (value: AutomationTimingPreset) => void;
  compact?: boolean;
}) {
  const effectiveAutoPlanGeneration = autoExecute || autoPlanGeneration;
  const timingOptions = AUTOMATION_TIMING_PRESETS.map((preset) => ({
    value: preset,
    label: copy.automationTiming[preset],
  }));

  return (
    <TaskConfigSection
      title={copy.automation}
      compact={compact}
      actions={effectiveAutoPlanGeneration ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">On</span> : null}
    >
      <div className="grid gap-2">
        <div className="grid gap-2">
          <TaskAutomationOption
            name="autoPlanGeneration"
            checked={effectiveAutoPlanGeneration}
            disabled={autoExecute}
            label={copy.autoPlanGeneration}
            description={copy.autoPlanGenerationDescription}
            onCheckedChange={onAutoPlanGenerationChange}
          />
          {effectiveAutoPlanGeneration ? (
            <TaskAutomationTimingSelect
              name="autoPlanGenerationTiming"
              label={copy.automationTimingLabel}
              value={autoPlanGenerationTiming}
              options={timingOptions}
              onValueChange={onAutoPlanGenerationTimingChange}
            />
          ) : null}
        </div>
        <div className="grid gap-2">
          <TaskAutomationOption
            name="autoExecute"
            checked={autoExecute}
            label={copy.autoExecute}
            description={copy.autoExecuteDescription}
            onCheckedChange={onAutoExecuteChange}
          />
          {autoExecute ? (
            <TaskAutomationTimingSelect
              name="autoExecuteTiming"
              label={copy.automationTimingLabel}
              value={autoExecuteTiming}
              options={timingOptions}
              onValueChange={onAutoExecuteTimingChange}
            />
          ) : null}
        </div>
      </div>
    </TaskConfigSection>
  );
}

function TaskAutomationTimingSelect({
  name,
  label,
  value,
  options,
  onValueChange,
}: {
  name: string;
  label: string;
  value: AutomationTimingPreset;
  options: { value: AutomationTimingPreset; label: string }[];
  onValueChange: (value: AutomationTimingPreset) => void;
}) {
  return (
    <div className="ml-9 grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <TaskConfigSelect
        name={name}
        value={value}
        options={options}
        onValueChange={(next) => onValueChange(normalizeAutomationTiming(next))}
      />
    </div>
  );
}

const DEFAULT_COPY = {
  moreOptions: "More options",
  starterPresets: "Starter presets",
  title: "Title",
  basics: "Basics",
  titlePlaceholder: "Add the next task to execute",
  priority: "Priority",
  schedule: "Schedule",
  scheduleHint: "Adjust when this block should run.",
  scheduleDate: "Date",
  scheduleStart: "Start",
  scheduleEnd: "End",
  scheduleDuration: "Duration",
  priorities: {
    Low: "Low",
    Medium: "Medium",
    High: "High",
    Urgent: "Urgent",
  },
  recurrence: "Repeat",
  recurrenceDescription: "Create independent task occurrences from this schedule.",
  recurrencePresets: {
    none: "Does not repeat",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    custom: "Custom RRULE",
  },
  recurrenceCustomLabel: "RRULE",
  recurrenceCustomPlaceholder: "e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR",
  adapter: "Adapter",
  aiProvider: "AI provider",
  defaultAiProvider: "Default provider",
  aiProviderHint: "Override provider for this task.",
  advancedFields: "Advanced fields",
  description: "Description",
  chronaNotes: "Chrona notes",
  chronaNotesPlaceholder: "Add local context, instructions, or desired outcome",
  chronaNotesHelp: "Stored only in Chrona. It does not update the calendar source.",
  chronaNotesEmpty: "No Chrona notes yet.",
  calendarDescription: "Calendar description",
  descriptionPlaceholder: "Optional execution context or desired outcome",
  runtimeParams: "Additional runtime params (JSON)",
  runtimeParamsPlaceholder: '{"customFlag": true}',
  automation: "Automation",
  autoPlanGeneration: "Auto-generate plan",
  autoPlanGenerationDescription: "Create a draft execution plan automatically. You can turn this off unless auto-execute is enabled.",
  autoExecute: "Auto-execute at scheduled time",
  autoExecuteDescription: "Force plan generation on, accept the generated plan, then start execution at the scheduled time.",
  automationTimingLabel: "Start timing",
  automationTiming: {
    immediate: "Immediately",
    at_start: "At scheduled start",
    before_30m: "30 minutes before start",
    before_1h: "1 hour before start",
    before_2h: "2 hours before start",
    before_1d: "1 day before start",
  },
  errorInvalidJson: "Runtime params must be valid JSON",
  errorJsonObject: "Runtime params must be a JSON object",
  errorIncompleteSchedule: "Set date, start, and end time together",
  errorInvalidScheduleRange: "End time must be after start time",
  actionFailed: "Action failed",
} as const;

function formatDateTimeInput(value?: Date | null) {
  return value ? value.toISOString().slice(0, 16) : "";
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateInput(value?: Date | null) {
  if (!value) return "";
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;
}

function parseLocalDateInput(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if ([year, month, day].some((part) => !Number.isFinite(part))) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function formatLocalDateLabel(value: Date) {
  return value.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatLocalTimeInput(value?: Date | null) {
  if (!value) return "";
  return `${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`;
}

function buildDateTimeFromLocalParts(dateValue: string, timeValue: string) {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  if ([year, month, day, hours, minutes].some((value) => !Number.isFinite(value))) {
    return null;
  }

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function formatDurationLabel(startAt: Date | null, endAt: Date | null) {
  if (!startAt || !endAt) return null;
  const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
  if (durationMinutes <= 0) return null;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60}h`;
  if (durationMinutes > 60) return `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;
  return `${durationMinutes}m`;
}

const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const totalMinutes = index * 15;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${padDatePart(hours)}:${padDatePart(minutes)}`;
});

function isRuntimeInputObject(value: unknown): value is RuntimeInput {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatRuntimeConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function parseRuntimeConfig(
  value: string,
  copy: { errorInvalidJson: string; errorJsonObject: string },
): RuntimeInput | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(copy.errorInvalidJson);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(copy.errorJsonObject);
  }

  return parsed as RuntimeInput;
}

function cloneRuntimeInput(input: RuntimeInput) {
  return structuredClone(input);
}

function resolveExecutionRuntime(
  executionRuntimes: TaskConfigExecutionRuntime[],
  executionRuntime: string | null | undefined,
  defaultExecutionRuntime: string,
) {
  const normalizedKey = executionRuntime?.trim() || defaultExecutionRuntime;

  return (
    executionRuntimes.find((runtime) => runtime.key === normalizedKey) ??
    executionRuntimes[0]
  );
}

function pickSpecFieldRuntimeInput(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const picked: RuntimeInput = {};

  for (const field of spec.fields) {
    const value = getValueAtPath(runtimeInput, field.path);

    if (value !== undefined) {
      setValueAtPath(picked, field.path, structuredClone(value));
    }
  }

  return picked;
}

function pickExtraRuntimeInput(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const extra = cloneRuntimeInput(runtimeInput);

  for (const field of spec.fields) {
    deleteValueAtPath(extra, field.path);
  }

  return Object.keys(extra).length > 0 ? extra : null;
}

function areRuntimeFieldValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stripDefaultRuntimeFieldValues(spec: RuntimeTaskConfigSpec, runtimeInput: RuntimeInput) {
  const strippedRuntimeInput = cloneRuntimeInput(runtimeInput);

  for (const field of spec.fields) {
    if (field.defaultValue === undefined) {
      continue;
    }

    const value = getValueAtPath(strippedRuntimeInput, field.path);

    if (value !== undefined && areRuntimeFieldValuesEqual(value, field.defaultValue)) {
      deleteValueAtPath(strippedRuntimeInput, field.path);
    }
  }

  return strippedRuntimeInput;
}

function buildInitialRuntimeState(input: {
  executionRuntimes: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime: string;
  executionRuntime?: string | null;
  executionConfig?: unknown;
}) {
  const runtime = resolveExecutionRuntime(
    input.executionRuntimes,
    input.executionRuntime,
    input.defaultExecutionRuntime,
  );
  const rawExecutionConfig = isRuntimeInputObject(input.executionConfig) ? input.executionConfig : {};
  const explicitExecutionConfig = validateTaskConfigAgainstSpec(runtime.spec, rawExecutionConfig, {
    applyDefaults: false,
  });
  const hydratedExecutionConfig = stripDefaultRuntimeFieldValues(runtime.spec, explicitExecutionConfig);

  return {
    executionRuntime: runtime.key,
    fieldExecutionConfig: pickSpecFieldRuntimeInput(runtime.spec, hydratedExecutionConfig),
    extraExecutionConfig: formatRuntimeConfig(pickExtraRuntimeInput(runtime.spec, hydratedExecutionConfig)),
  };
}

function toFormState(
  initialValues: TaskConfigFormProps["initialValues"] | undefined,
  executionRuntimes: TaskConfigExecutionRuntime[],
  defaultExecutionRuntime: string,
): TaskConfigFormState {
  const runtimeState = buildInitialRuntimeState({
    executionRuntimes,
    defaultExecutionRuntime,
    executionRuntime: initialValues?.executionRuntime,
    executionConfig: initialValues?.executionConfig,
  });

  return {
    title: initialValues?.title ?? "",
    description: initialValues?.description ?? "",
    priority: initialValues?.priority ?? "Medium",
    dueAt: formatDateTimeInput(initialValues?.dueAt),
    scheduledDate: formatLocalDateInput(initialValues?.scheduledStartAt),
    scheduledStartTime: formatLocalTimeInput(initialValues?.scheduledStartAt),
    scheduledEndTime: formatLocalTimeInput(initialValues?.scheduledEndAt),
    aiClientId: initialValues?.aiClientId ?? "",
    autoPlanGeneration: initialValues?.autoExecute || (initialValues?.autoPlanGeneration ?? false),
    autoExecute: initialValues?.autoExecute ?? false,
    autoPlanGenerationTiming: normalizeAutomationTiming(initialValues?.autoPlanGenerationTiming),
    autoExecuteTiming: normalizeAutomationTiming(initialValues?.autoExecuteTiming),
    recurrenceMode: recurrencePresetFromRule(initialValues?.recurrenceRule),
    recurrenceCustomRule: recurrencePresetFromRule(initialValues?.recurrenceRule) === "custom"
      ? (initialValues?.recurrenceRule ?? "")
      : "",
    ...runtimeState,
  };
}

function buildTaskConfigFormInput(
  formState: TaskConfigFormState,
  executionRuntimes: TaskConfigExecutionRuntime[],
  copy: { errorInvalidJson: string; errorJsonObject: string },
  options?: { throwOnInvalidJson?: boolean },
): TaskConfigFormInput | null {
  const executionRuntime = resolveExecutionRuntime(executionRuntimes, formState.executionRuntime, formState.executionRuntime);
  let extraRuntimeInput: RuntimeInput | null;
  try {
    extraRuntimeInput = parseRuntimeConfig(formState.extraExecutionConfig, copy);
  } catch (error) {
    if (options?.throwOnInvalidJson) {
      throw error;
    }
    return null;
  }
  const mergedRuntimeInput = {
    ...cloneRuntimeInput(formState.fieldExecutionConfig),
    ...(extraRuntimeInput ?? {}),
  };
  const executionConfig = validateTaskConfigAgainstSpec(executionRuntime.spec, mergedRuntimeInput) as RuntimeInput;

  const hasPartialSchedule =
    !!formState.scheduledDate || !!formState.scheduledStartTime || !!formState.scheduledEndTime;
  const scheduledStartAt = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledStartTime);
  const scheduledEndAt = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledEndTime);

  if (hasPartialSchedule && (!scheduledStartAt || !scheduledEndAt)) {
    if (options?.throwOnInvalidJson) {
      throw new Error(DEFAULT_COPY.errorIncompleteSchedule);
    }
    return null;
  }

  if (scheduledStartAt && scheduledEndAt && scheduledEndAt <= scheduledStartAt) {
    if (options?.throwOnInvalidJson) {
      throw new Error(DEFAULT_COPY.errorInvalidScheduleRange);
    }
    return null;
  }

  const recurrenceRule = recurrenceRuleFromState(formState.recurrenceMode, formState.recurrenceCustomRule);

  return {
    title: formState.title,
    description: formState.description,
    priority: formState.priority,
    dueAt: formState.dueAt ? new Date(formState.dueAt) : null,
    scheduledStartAt,
    scheduledEndAt,
    executionRuntime: executionRuntime.key,
    executionConfig,
    aiClientId: formState.aiClientId || null,
    autoPlanGeneration: formState.autoExecute || formState.autoPlanGeneration,
    autoExecute: formState.autoExecute,
    autoPlanGenerationTiming: normalizeAutomationTiming(formState.autoPlanGenerationTiming),
    autoExecuteTiming: normalizeAutomationTiming(formState.autoExecuteTiming),
    recurrenceRule,
    recurrenceAnchorStartAt: recurrenceRule ? scheduledStartAt : null,
    recurrenceAnchorEndAt: recurrenceRule ? scheduledEndAt : null,
  };
}


function applyPresetValues(
  current: TaskConfigFormState,
  values: TaskConfigPreset["values"],
  executionRuntimes: TaskConfigExecutionRuntime[],
  defaultExecutionRuntime: string,
) {
  let next = { ...current };

  if ("title" in values) {
    next.title = values.title ?? "";
  }

  if ("description" in values) {
    next.description = values.description ?? "";
  }

  if ("autoExecute" in values) {
    next.autoExecute = values.autoExecute ?? false;
    if (next.autoExecute) {
      next.autoPlanGeneration = true;
    }
  }

  if ("autoPlanGeneration" in values) {
    next.autoPlanGeneration = next.autoExecute || (values.autoPlanGeneration ?? false);
  }

  if ("autoPlanGenerationTiming" in values) {
    next.autoPlanGenerationTiming = normalizeAutomationTiming(values.autoPlanGenerationTiming);
  }

  if ("autoExecuteTiming" in values) {
    next.autoExecuteTiming = normalizeAutomationTiming(values.autoExecuteTiming);
  }

  if ("priority" in values && values.priority) {
    next.priority = values.priority;
  }

  if ("dueAt" in values) {
    next.dueAt = formatDateTimeInput(values.dueAt ?? null);
  }

  if ("scheduledStartAt" in values || "scheduledEndAt" in values) {
    next.scheduledDate = formatLocalDateInput(values.scheduledStartAt ?? null);
    next.scheduledStartTime = formatLocalTimeInput(values.scheduledStartAt ?? null);
    next.scheduledEndTime = formatLocalTimeInput(values.scheduledEndAt ?? null);
  }

  if (
    "executionRuntime" in values ||
    "executionConfig" in values
  ) {
    const runtimeState = buildInitialRuntimeState({
      executionRuntimes,
      defaultExecutionRuntime,
      executionRuntime: values.executionRuntime ?? next.executionRuntime,
      executionConfig: values.executionConfig,
    });

    next = {
      ...next,
      ...runtimeState,
    };
  }


  if ("aiClientId" in values) {
    next.aiClientId = values.aiClientId ?? "";
  }
  return next;
}

function readDisplayedFieldValue(field: RuntimeTaskConfigField, runtimeInput: RuntimeInput) {
  const value = getValueAtPath(runtimeInput, field.path);
  return value === undefined ? field.defaultValue : value;
}

function isFieldVisible(field: RuntimeTaskConfigField, runtimeInput: RuntimeInput) {
  if (!field.visibleWhen || field.visibleWhen.length === 0) {
    return true;
  }

  return field.visibleWhen.every((rule) => {
    const value = getValueAtPath(runtimeInput, rule.path);

    if (rule.op === "eq") {
      return value === rule.value;
    }

    return Array.isArray(rule.value) && rule.value.includes(value);
  });
}

function renderFieldValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return JSON.stringify(value);
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
  const { messages } = useI18n();
  const taskConfigFormMessages = messages.components.taskConfigForm;
  const copy = useMemo(() => ({
    ...DEFAULT_COPY,
    ...taskConfigFormMessages,
    priorities: {
      ...DEFAULT_COPY.priorities,
      ...taskConfigFormMessages.priorities,
    },
    automationTiming: {
      ...DEFAULT_COPY.automationTiming,
      ...taskConfigFormMessages.automationTiming,
    },
    recurrencePresets: {
      ...DEFAULT_COPY.recurrencePresets,
      ...((taskConfigFormMessages as { recurrencePresets?: Partial<Record<RecurrencePreset, string>> } | undefined)?.recurrencePresets ?? {}),
    },
  }), [taskConfigFormMessages]);
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);
  const lockedFieldSet = useMemo(() => new Set(lockedFields), [lockedFields]);
  const isTitleLocked = lockedFieldSet.has("title");
  const isScheduleLocked = lockedFieldSet.has("scheduledStartAt") || lockedFieldSet.has("scheduledEndAt");
  const sourceDescriptionText = sourceDescription?.trim() ?? "";
  const hasSourceDescription = sourceDescriptionText.length > 0;
  const descriptionLabel = copy.description;
  const descriptionPlaceholder = sourceDescription !== undefined ? copy.chronaNotesPlaceholder : copy.descriptionPlaceholder;
  const initialTitle = initialValues?.title;
  const initialDescription = initialValues?.description;
  const initialPriority = initialValues?.priority;
  const initialDueAt = initialValues?.dueAt;
  const initialScheduledStartAt = initialValues?.scheduledStartAt;
  const initialScheduledEndAt = initialValues?.scheduledEndAt;
  const initialExecutionRuntime = initialValues?.executionRuntime;
  const initialExecutionConfig = initialValues?.executionConfig;
  const initialAiClientId = initialValues?.aiClientId;
  const initialAutoPlanGeneration = initialValues?.autoPlanGeneration;
  const initialAutoExecute = initialValues?.autoExecute;
  const initialAutoPlanGenerationTiming = initialValues?.autoPlanGenerationTiming;
  const initialAutoExecuteTiming = initialValues?.autoExecuteTiming;
  const initialRecurrenceRule = initialValues?.recurrenceRule;
  const initialState = useMemo(
    () =>
      toFormState(
        {
          title: initialTitle,
          description: initialDescription,
          priority: initialPriority,
          dueAt: initialDueAt,
          scheduledStartAt: initialScheduledStartAt,
          scheduledEndAt: initialScheduledEndAt,
          executionRuntime: initialExecutionRuntime,
          executionConfig: initialExecutionConfig,
          aiClientId: initialAiClientId,
          autoPlanGeneration: initialAutoPlanGeneration,
          autoExecute: initialAutoExecute,
          autoPlanGenerationTiming: initialAutoPlanGenerationTiming,
          autoExecuteTiming: initialAutoExecuteTiming,
          recurrenceRule: initialRecurrenceRule,
        },
        executionRuntimes,
        defaultExecutionRuntime,
      ),
    [
      defaultExecutionRuntime,
      executionRuntimes,
      initialTitle,
      initialDescription,
      initialPriority,
      initialDueAt,
      initialScheduledStartAt,
      initialScheduledEndAt,
      initialExecutionRuntime,
      initialExecutionConfig,
      initialAiClientId,
      initialAutoPlanGeneration,
      initialAutoExecute,
      initialAutoPlanGenerationTiming,
      initialAutoExecuteTiming,
      initialRecurrenceRule,
    ],
  );
  const {
    control,
    reset,
    handleSubmit,
    setValue,
    getValues,
    formState: { isDirty },
  } = useForm<TaskConfigFormState>({
    defaultValues: initialState,
  });
  const formState = (useWatch({ control }) as TaskConfigFormState | undefined) ?? initialState;

  function replaceFormState(next: TaskConfigFormState) {
    reset(next, { keepDefaultValues: true });
  }

  useEffect(() => {
    reset(initialState);
  }, [initialState, reset]);

  useEffect(() => {
    if (!onDraftStateChange) {
      return;
    }

    const values = buildTaskConfigFormInput(formState, executionRuntimes, copy);
    if (!values) {
      return;
    }

    onDraftStateChange({
      isDirty,
      values,
    });
  }, [copy, executionRuntimes, formState, initialState, isDirty, onDraftStateChange]);

  const selectedExecutionRuntime = useMemo(
    () => resolveExecutionRuntime(executionRuntimes, formState.executionRuntime, defaultExecutionRuntime),
    [defaultExecutionRuntime, executionRuntimes, formState.executionRuntime],
  );
  const visibleExecutionConfig = useMemo(
    () =>
      selectedExecutionRuntime.spec.fields.reduce<RuntimeInput>((accumulator, field) => {
        const value = readDisplayedFieldValue(field, formState.fieldExecutionConfig);

        if (value !== undefined) {
          setValueAtPath(accumulator, field.path, value);
        }

        return accumulator;
      }, cloneRuntimeInput(formState.fieldExecutionConfig)),
    [formState.fieldExecutionConfig, selectedExecutionRuntime.spec.fields],
  );
  const visibleStandardFields = selectedExecutionRuntime.spec.fields.filter(
    (field) => !field.advanced && isFieldVisible(field, visibleExecutionConfig),
  );
  const scheduledStartAtPreview = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledStartTime);
  const scheduledEndAtPreview = buildDateTimeFromLocalParts(formState.scheduledDate, formState.scheduledEndTime);
  const scheduleDurationLabel = formatDurationLabel(scheduledStartAtPreview, scheduledEndAtPreview);
  const requiredRuntimeFields = visibleStandardFields.filter((field) =>
    selectedExecutionRuntime.spec.runnability.requiredPaths.includes(field.path),
  );
  const optionalRuntimeFields = visibleStandardFields.filter(
    (field) => !selectedExecutionRuntime.spec.runnability.requiredPaths.includes(field.path),
  );
  const aiClientOptions = useMemo(
    () => [
      { value: "", label: copy.defaultAiProvider },
      ...availableAiClients.map((client) => ({
        value: client.id,
        label: client.enabled ? client.name : `${client.name} (disabled)`,
      })),
    ],
    [availableAiClients, copy.defaultAiProvider],
  );

  function updateRuntimeField(field: RuntimeTaskConfigField, nextValue: unknown) {
    const nextRuntimeInput = cloneRuntimeInput(getValues("fieldExecutionConfig"));

    if (nextValue === undefined) {
      deleteValueAtPath(nextRuntimeInput, field.path);
    } else {
      setValueAtPath(nextRuntimeInput, field.path, nextValue);
    }

    setValue("fieldExecutionConfig", nextRuntimeInput, { shouldDirty: true });
  }

  async function submitForm(values: TaskConfigFormState) {
    setLocalErrorMessage(null);

    try {
      const input = buildTaskConfigFormInput(values, executionRuntimes, copy, { throwOnInvalidJson: true });
      if (input) {
        await onSubmitAction(input);
      }
    } catch (error) {
      setLocalErrorMessage(error instanceof Error ? error.message : copy.actionFailed);
    }
  }

  return (
    <div className="space-y-3">
      {localErrorMessage ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{localErrorMessage}</p>
      ) : null}

      {presets && presets.length > 0 ? (
        <div className={compact ? "flex flex-wrap gap-2" : "rounded-2xl border border-border/60 bg-background/70 p-3"}>
          {compact ? <p className="sr-only">{copy.starterPresets}</p> : <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">{copy.starterPresets}</p>}
          <div className={compact ? "flex flex-wrap gap-2" : "mt-3 grid gap-2 sm:grid-cols-2"}>
            {presets.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                disabled={isPending}
                onClick={() =>
                  replaceFormState(
                    applyPresetValues(getValues(), preset.values, executionRuntimes, defaultExecutionRuntime),
                  )
                }
                className={compact ? "rounded-full border border-border/60 bg-background px-3 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60" : "rounded-2xl border border-border/60 bg-background px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"}
              >
                <p className="text-sm font-medium text-foreground">{preset.label}</p>
                {!compact ? <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p> : null}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <form id={formId} onSubmit={(event) => void handleSubmit(submitForm)(event)}>
        <FieldGroup className="gap-3">
          <TaskConfigSection title={copy.basics} info={isTitleLocked ? lockedFieldsHint : undefined}>
            <div className={compact ? "grid gap-3" : "grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]"}>
              <Controller
                name="title"
                control={control}
                rules={{ required: copy.title }}
                render={({ field, fieldState }) => (
                  <TaskConfigField
                    label={copy.title}
                    htmlFor={field.name}
                    invalid={fieldState.invalid}
                    error={fieldState.error}
                  className="text-xs text-foreground"
                  >
                    <Input
                      {...field}
                      aria-invalid={fieldState.invalid}
                      id={field.name}
                      disabled={isPending || isTitleLocked}
                      placeholder={copy.titlePlaceholder}
                    />
                  </TaskConfigField>
                )}
              />

              <TaskConfigField label={copy.priority} htmlFor="task-config-priority" className="text-xs text-foreground">
                <TaskConfigSelect
                  name="priority"
                  id="task-config-priority"
                  value={formState.priority}
                  options={(["Low", "Medium", "High", "Urgent"] as const).map((priority) => ({
                    value: priority,
                    label: copy.priorities[priority],
                  }))}
                  onValueChange={(value) => setValue("priority", value as TaskConfigFormInput["priority"], { shouldDirty: true })}
                />
              </TaskConfigField>
            </div>
          </TaskConfigSection>

        {!compact ? (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
            <div className="flex flex-col gap-3">
              <Controller
                name="description"
                control={control}
                render={({ field, fieldState }) => (
                  <TaskConfigSection title={descriptionLabel}>
                    {hasSourceDescription ? (
                      <div className="mb-3 space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">{sourceDescriptionLabel ?? copy.calendarDescription}</p>
                        <p className="min-h-20 select-text whitespace-pre-wrap rounded-md border border-dashed border-border/70 bg-muted/45 px-3 py-2 text-sm text-muted-foreground shadow-inner cursor-default">
                          {sourceDescriptionText}
                        </p>
                      </div>
                    ) : null}
                    <TaskConfigField
                      label={descriptionLabel}
                      htmlFor={field.name}
                      invalid={fieldState.invalid}
                      error={fieldState.error}
                      hideTitle
                      className="gap-2 text-xs text-foreground"
                    >
                      <Textarea
                        {...field}
                        aria-invalid={fieldState.invalid}
                        id={field.name}
                        rows={5}
                        placeholder={descriptionPlaceholder}
                        className="bg-background"
                      />
                    </TaskConfigField>
                  </TaskConfigSection>
                  )}
                />

                <TaskConfigSection
                  title={copy.schedule}
                  info={isScheduleLocked ? lockedFieldsHint : undefined}
                  actions={scheduleDurationLabel ? (
                    <span className="rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary">
                      {scheduleDurationLabel}
                    </span>
                  ) : null}
                >
                  <p className="text-xs text-muted-foreground">{copy.scheduleHint}</p>

                  <FieldGroup className="grid gap-2 sm:grid-cols-3">
                    <TaskConfigField label={copy.scheduleDate} className="text-xs text-foreground">
                      <TaskConfigDatePicker
                        name="scheduledDate"
                        value={formState.scheduledDate}
                        placeholder={copy.scheduleDate}
                        disabled={isScheduleLocked}
                        onValueChange={(value) => {
                          if (!isScheduleLocked) setValue("scheduledDate", value, { shouldDirty: true });
                        }}
                      />
                    </TaskConfigField>

                    <TaskConfigField label={copy.scheduleStart} className="text-xs text-foreground">
                      <TaskConfigSelect
                        name="scheduledStartTime"
                        value={formState.scheduledStartTime}
                        placeholder="--"
                        options={TIME_OPTIONS.map((time) => ({ value: time, label: time }))}
                        disabled={isScheduleLocked}
                        onValueChange={(value) => {
                          if (!isScheduleLocked) setValue("scheduledStartTime", value, { shouldDirty: true });
                        }}
                      />
                    </TaskConfigField>

                    <TaskConfigField label={copy.scheduleEnd} className="text-xs text-foreground">
                      <TaskConfigSelect
                        name="scheduledEndTime"
                        value={formState.scheduledEndTime}
                        placeholder="--"
                        options={TIME_OPTIONS.map((time) => ({ value: time, label: time }))}
                        disabled={isScheduleLocked}
                        onValueChange={(value) => {
                          if (!isScheduleLocked) setValue("scheduledEndTime", value, { shouldDirty: true });
                        }}
                      />
                    </TaskConfigField>
                  </FieldGroup>

                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <TaskConfigField label={copy.recurrence} hint={copy.recurrenceDescription} className="text-xs text-foreground">
                      <TaskConfigSelect
                        name="recurrenceMode"
                        value={formState.recurrenceMode}
                        options={RECURRENCE_PRESETS.map((preset) => ({ value: preset, label: copy.recurrencePresets[preset] }))}
                        disabled={isScheduleLocked}
                        onValueChange={(value) => {
                          if (!isScheduleLocked) setValue("recurrenceMode", value as RecurrencePreset, { shouldDirty: true });
                        }}
                      />
                    </TaskConfigField>

                    {formState.recurrenceMode === "custom" ? (
                      <TaskConfigField label={copy.recurrenceCustomLabel} className="text-xs text-foreground">
                        <Input
                          name="recurrenceCustomRule"
                          value={formState.recurrenceCustomRule}
                          disabled={isScheduleLocked}
                          placeholder={copy.recurrenceCustomPlaceholder}
                          onChange={(event) => setValue("recurrenceCustomRule", event.target.value, { shouldDirty: true })}
                        />
                      </TaskConfigField>
                    ) : null}
                  </div>
                </TaskConfigSection>
            </div>

              <div className="flex flex-col gap-3">
                <TaskAutomationSection
                  copy={copy}
                  autoPlanGeneration={formState.autoPlanGeneration}
                  autoExecute={formState.autoExecute}
                  autoPlanGenerationTiming={formState.autoPlanGenerationTiming}
                  autoExecuteTiming={formState.autoExecuteTiming}
                  onAutoPlanGenerationChange={(checked) => setValue("autoPlanGeneration", checked, { shouldDirty: true })}
                  onAutoExecuteChange={(checked) => {
                    setValue("autoExecute", checked, { shouldDirty: true });
                    if (checked) {
                      setValue("autoPlanGeneration", true, { shouldDirty: true });
                    }
                  }}
                  onAutoPlanGenerationTimingChange={(value) => setValue("autoPlanGenerationTiming", value, { shouldDirty: true })}
                  onAutoExecuteTimingChange={(value) => setValue("autoExecuteTiming", value, { shouldDirty: true })}
                />

                {aiClientOptions.length > 1 ? (
                  <TaskConfigSection title={copy.aiProvider} info={aiClientSelectionDisabledHint}>
                    <TaskConfigField label={copy.aiProvider} hint={copy.aiProviderHint} className="text-xs text-foreground">
                      <TaskConfigSelect
                        name="aiClientId"
                        id="task-config-ai-client"
                        value={formState.aiClientId}
                        options={aiClientOptions}
                        disabled={isPending || disableAiClientSelection}
                        onValueChange={(value) => setValue("aiClientId", value, { shouldDirty: true })}
                      />
                    </TaskConfigField>
                  </TaskConfigSection>
                ) : null}
            </div>
          </div>
        ) : null}


        {(compact ? requiredRuntimeFields : visibleStandardFields).map((field) => {
          const value = readDisplayedFieldValue(field, formState.fieldExecutionConfig);

          if (field.kind === "textarea") {
            return (
              <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                <Textarea
                  name={field.path}
                  rows={compact ? 3 : 4}
                  value={renderFieldValue(value)}
                  onChange={(event) => updateRuntimeField(field, event.target.value)}
                  maxLength={field.constraints?.maxLength}
                />
              </TaskConfigField>
            );
          }

          if (field.kind === "select") {
            return (
              <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                <TaskConfigSelect
                  name={field.path}
                  value={renderFieldValue(value)}
                  options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
                  onValueChange={(nextValue) => updateRuntimeField(field, nextValue || undefined)}
                />
              </TaskConfigField>
            );
          }

          if (field.kind === "number") {
            return (
              <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                <Input
                  name={field.path}
                  type="number"
                  value={renderFieldValue(value)}
                  onChange={(event) => updateRuntimeField(field, event.target.value === "" ? undefined : event.target.value)}
                  min={field.constraints?.min}
                  max={field.constraints?.max}
                  step={field.constraints?.step}
                />
              </TaskConfigField>
            );
          }

          if (field.kind === "boolean") {
            return (
              <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-sm text-foreground">
                  <Checkbox
                    name={field.path}
                    checked={Boolean(value)}
                    onCheckedChange={(checked) => updateRuntimeField(field, checked === true)}
                  />
                  <span>{field.label}</span>
                </label>
              </TaskConfigField>
            );
          }

          if (field.kind === "json") {
            return (
              <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                <Textarea
                  name={field.path}
                  rows={compact ? 4 : 5}
                  value={typeof value === "string" ? value : formatRuntimeConfig(value)}
                  onChange={(event) => updateRuntimeField(field, event.target.value)}
                />
              </TaskConfigField>
            );
          }

          return (
            <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
              <Input
                name={field.path}
                value={renderFieldValue(value)}
                onChange={(event) => updateRuntimeField(field, event.target.value)}
                minLength={field.constraints?.minLength}
                maxLength={field.constraints?.maxLength}
                pattern={field.constraints?.pattern}
              />
            </TaskConfigField>
          );
        })}

        {compact ? (
          <details className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">{copy.moreOptions}</summary>

            <FieldGroup className="mt-3 gap-3">
              <>

                <TaskConfigSection title={descriptionLabel} compact>
                  {hasSourceDescription ? (
                    <div className="mb-3 space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">{sourceDescriptionLabel ?? copy.calendarDescription}</p>
                      <p className="min-h-16 select-text whitespace-pre-wrap rounded-md border border-dashed border-border/70 bg-muted/45 px-3 py-2 text-sm text-muted-foreground shadow-inner cursor-default">
                        {sourceDescriptionText}
                      </p>
                    </div>
                  ) : null}
                  <TaskConfigField
                    label={descriptionLabel}
                    hideTitle
                    className="gap-2 text-xs text-foreground"
                  >
                    <Controller
                      name="description"
                      control={control}
                      render={({ field, fieldState }) => (
                        <Textarea
                          {...field}
                          aria-invalid={fieldState.invalid}
                          rows={3}
                          placeholder={descriptionPlaceholder}
                          className="bg-background"
                        />
                      )}
                    />
                  </TaskConfigField>
                </TaskConfigSection>

                <TaskAutomationSection
                  compact
                  copy={copy}
                  autoPlanGeneration={formState.autoPlanGeneration}
                  autoExecute={formState.autoExecute}
                  autoPlanGenerationTiming={formState.autoPlanGenerationTiming}
                  autoExecuteTiming={formState.autoExecuteTiming}
                  onAutoPlanGenerationChange={(checked) => setValue("autoPlanGeneration", checked, { shouldDirty: true })}
                  onAutoExecuteChange={(checked) => {
                    setValue("autoExecute", checked, { shouldDirty: true });
                    if (checked) {
                      setValue("autoPlanGeneration", true, { shouldDirty: true });
                    }
                  }}
                  onAutoPlanGenerationTimingChange={(value) => setValue("autoPlanGenerationTiming", value, { shouldDirty: true })}
                  onAutoExecuteTimingChange={(value) => setValue("autoExecuteTiming", value, { shouldDirty: true })}
                />

                {aiClientOptions.length > 1 ? (
                  <TaskConfigField label={copy.aiProvider} hint={aiClientSelectionDisabledHint ?? copy.aiProviderHint} className="text-xs text-foreground">
                    <TaskConfigSelect
                      name="aiClientId"
                      value={formState.aiClientId}
                      options={aiClientOptions}
                      disabled={isPending || disableAiClientSelection}
                      onValueChange={(value) => setValue("aiClientId", value, { shouldDirty: true })}
                    />
                  </TaskConfigField>
                ) : null}
              </>

              {optionalRuntimeFields.map((field) => {
              const value = readDisplayedFieldValue(field, formState.fieldExecutionConfig);

              if (field.kind === "textarea") {
                return (
                  <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                    <Textarea
                      name={field.path}
                      rows={3}
                      value={renderFieldValue(value)}
                      onChange={(event) => updateRuntimeField(field, event.target.value)}
                      maxLength={field.constraints?.maxLength}
                    />
                  </TaskConfigField>
                );
              }

              if (field.kind === "select") {
                return (
                  <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                    <TaskConfigSelect
                      name={field.path}
                      value={renderFieldValue(value)}
                      options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
                      onValueChange={(nextValue) => updateRuntimeField(field, nextValue || undefined)}
                    />
                  </TaskConfigField>
                );
              }

              if (field.kind === "number") {
                return (
                  <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                    <Input
                      name={field.path}
                      type="number"
                      value={renderFieldValue(value)}
                      onChange={(event) => updateRuntimeField(field, event.target.value === "" ? undefined : event.target.value)}
                      min={field.constraints?.min}
                      max={field.constraints?.max}
                      step={field.constraints?.step}
                    />
                  </TaskConfigField>
                );
              }

              if (field.kind === "boolean") {
                return (
                  <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                    <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-sm text-foreground">
                      <Checkbox
                        name={field.path}
                        checked={Boolean(value)}
                        onCheckedChange={(checked) => updateRuntimeField(field, checked === true)}
                      />
                      <span>{field.label}</span>
                    </label>
                  </TaskConfigField>
                );
              }

              if (field.kind === "json") {
                return (
                  <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                    <Textarea
                      name={field.path}
                      rows={4}
                      value={typeof value === "string" ? value : formatRuntimeConfig(value)}
                      onChange={(event) => updateRuntimeField(field, event.target.value)}
                    />
                  </TaskConfigField>
                );
              }

              return (
                <TaskConfigField key={field.path} label={field.label} hint={field.description} className="text-xs text-foreground">
                  <Input
                    name={field.path}
                    value={renderFieldValue(value)}
                    onChange={(event) => updateRuntimeField(field, event.target.value)}
                  />
                </TaskConfigField>
              );
            })}
            </FieldGroup>
          </details>
        ) : null}

        {!hideFooter ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-2">{footerActions}</div>
            <Button type="submit" disabled={isPending} variant="default" size="default">
              {isPending ? pendingLabel : submitLabel}
            </Button>
          </div>
        ) : footerActions ? <div className="border-t border-border/60 pt-3">{footerActions}</div> : null}
        </FieldGroup>
      </form>
    </div>
  );
}
