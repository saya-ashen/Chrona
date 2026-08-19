"use client";

import {
  CalendarIcon,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Calendar,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "@shared/ui";
import { useAutoComplete } from "../use-auto-complete";
import { useI18n, useLocale } from "@chrona/i18n";
import {
  SCHEDULE_AUTO_SUGGESTIONS_AVAILABLE,
  useScheduleAiPreferences,
} from "../schedule-ai-preferences";
import {
  AUTOMATION_TIMING_PRESETS,
  normalizeAutomationTiming,
} from "@chrona/contracts";
import type { AutomationTimingPreset } from "@chrona/contracts";
import { deriveAutomationPolicyPreview } from "@chrona/domain";
import {
  TaskConfigSection,
  TaskConfigField,
  TaskConfigSelect,
  type TaskConfigAiClient,
  type TaskConfigExecutionRuntime,
} from "../forms/task-config-form";

import {
  RECURRENCE_PRESETS,
  recurrenceRuleFromState,
  type RecurrencePreset,
} from "../recurrence-presets";

const RECURRENCE_UI_PRESETS = RECURRENCE_PRESETS.filter((p) => p !== "none");

/* ------------------------------------------------------------------ */
/*  Priority badge color map                                          */
/* ------------------------------------------------------------------ */
const priorityBadgeColors: Record<string, string> = {
  Low: "bg-success/12 text-success",
  Medium: "bg-warning/15 text-warning-foreground",
  High: "bg-warning/20 text-warning-foreground",
  Urgent: "bg-destructive/12 text-destructive",
};

const DEFAULT_DIALOG_COPY = {
  title: "Add task",
  close: "Close",
  titlePlaceholder: "Add title",
  titleLabel: "Title",
  goalLabel: "Goal",
  goalPlaceholder: "What outcome do you ultimately want to achieve?",
  goalAdditionalInformation: "Additional information (optional)",
  goalAdditionalInformationPlaceholder:
    "Add background, scope, constraints, or preferences",
  firstTaskLabel: "First task",
  firstTaskPlaceholder: "What bounded work should happen first?",
  aiSuggestions: "AI Suggestions",
  generatingSuggestions: "Generating suggestions...",
  mode: "How should Chrona help?",
  modeTodo: "Save as task",
  modeTodoDescription: "Capture it now. Plan and run manually later.",
  modePlan: "Help me plan",
  modePlanDescription: "Generate a plan, then wait for your approval.",
  modeAutomatic: "Run on a schedule",
  modeAutomaticDescription: "Generate, approve, and run at the scheduled time.",
  date: "Date",
  startTime: "Start time",
  endTime: "End time",
  recurrence: "Repeat",
  recurrenceDescription: "Schedule this task at a recurring interval.",
  recurrencePresets: {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    custom: "Custom...",
  },
  recurrenceCustomLabel: "RRULE",
  recurrenceCustomPlaceholder: "e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR",
  autoExecute: "Auto-execute at scheduled time",
  autoExecuteDescription:
    "Force plan generation on, accept the generated plan, then start execution at the scheduled time.",
  autoPlanGeneration: "Auto-generate plan",
  autoPlanGenerationDescription:
    "Automatically generate an execution plan after saving. Required when auto-execute is enabled.",
  automationTimingLabel: "Start timing",
  automationTiming: {
    immediate: "Immediately",
    at_start: "At scheduled start",
    before_30m: "30 minutes before start",
    before_1h: "1 hour before start",
    before_2h: "2 hours before start",
    before_1d: "1 day before start",
  },
  aiProvider: "AI provider",
  defaultAiProvider: "Default provider",
  aiProviderHint: "Override provider for this task.",
  automationPreview: "What Chrona will do",
  automationReady: "Ready",
  automationPlan: "Plan",
  automationExecution: "Execution",
  automationProvider: "AI",
  automationRecovery: "Reliability",
  manualPlanSummary: "You will create and approve the plan manually.",
  automaticPlanSummary:
    "Chrona will generate a plan automatically, then wait for your approval.",
  automaticExecutionSummary:
    "Chrona will generate and accept a valid plan, then execute it at the scheduled time.",
  defaultProviderSummary: "Use the workspace default AI",
  automaticRunTitle: "Automatic run",
  automaticRunSummary:
    "Chrona will prepare a valid plan and run this task automatically.",
  automaticRunReady: "Ready",
  automaticRunActionRequired: "Action required",
  automaticRunProvider: "AI provider",
  automaticRunTime: "Run time",
  automaticRunDetails: "How automatic runs work",
  automaticRunPause:
    "Chrona pauses when the task needs your input or approval.",
  automaticRunRetry: "Failed runs are not retried automatically.",
  automaticRunMissed:
    "If Chrona is unavailable at the scheduled time, the task starts when Chrona is running again.",
  automaticRunPage: "Closing this page does not cancel the scheduled run.",
  description: "Description (optional)",
  descriptionPlaceholder: "Add description",
  dueDate: "Due date (optional)",
  executionRuntime: "Execution runtime",
  priority: "Priority",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving...",
  priorities: {
    Low: "Low",
    Medium: "Medium",
    High: "High",
    Urgent: "Urgent",
  },
} as const;

type TaskCreateDialogProps = {
  isOpen: boolean;
  initialTitle?: string;
  initialDescription?: string;
  initialAutoPlanGenerationEnabled?: boolean;
  initialAutoExecute?: boolean;
  initialStartAt: Date;
  initialEndAt: Date;
  isPending: boolean;
  onClose: () => void;
  allowGoalMode?: boolean;
  onSubmit: (input: {
    title: string;
    description: string;
    priority: "Low" | "Medium" | "High" | "Urgent";
    autoExecute: boolean;
    autoPlanGenerationEnabled: boolean;
    autoPlanGenerationTiming: AutomationTimingPreset;
    autoExecuteTiming: AutomationTimingPreset;
    dueAt: Date | null;
    executionRuntime: string;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
    recurrenceRule: string | null;
    recurrenceAnchorStartAt: string | null;
    recurrenceAnchorEndAt: string | null;
    aiClientId: string | null;
    mode?: "task" | "goal";
    goalTitle?: string;
    firstTaskTitle?: string;
  }) => Promise<void>;
  autoSuggestionsEnabled?: boolean;
  availableAiClients?: TaskConfigAiClient[];
  executionRuntimes?: TaskConfigExecutionRuntime[];
  defaultExecutionRuntime?: string;
};

function parseDateTimeInput(value: string) {
  return value ? new Date(value) : null;
}

function useTaskCreateFields(isOpen: boolean, defaultExecutionRuntime: string) {
  const [fields, setFields] = useState({
    dueAt: "",
    executionRuntime: defaultExecutionRuntime,
  });

  useEffect(() => {
    if (isOpen)
      setFields({ dueAt: "", executionRuntime: defaultExecutionRuntime });
  }, [defaultExecutionRuntime, isOpen]);

  return [fields, setFields] as const;
}

function TaskCreateSchedulingFields({
  dialogCopy,
  dueAt,
  onDueAtChange,
  executionRuntime,
  executionRuntimes,
  onExecutionRuntimeChange,
  isPending,
}: {
  dialogCopy: Pick<typeof DEFAULT_DIALOG_COPY, "dueDate" | "executionRuntime">;
  dueAt: string;
  onDueAtChange: (value: string) => void;
  executionRuntime: string;
  executionRuntimes: TaskConfigExecutionRuntime[];
  onExecutionRuntimeChange: (value: string) => void;
  isPending: boolean;
}) {
  return (
    <>
      <TaskConfigSection title={dialogCopy.dueDate}>
        <Input
          type="datetime-local"
          value={dueAt}
          onChange={(event) => onDueAtChange(event.target.value)}
          disabled={isPending}
          aria-label={dialogCopy.dueDate}
          className="bg-background"
        />
      </TaskConfigSection>

      {executionRuntimes.length > 0 ? (
        <TaskConfigSection title={dialogCopy.executionRuntime}>
          <TaskConfigSelect
            name="executionRuntime"
            value={executionRuntime}
            options={executionRuntimes.map((runtime) => ({
              value: runtime.key,
              label: runtime.label,
            }))}
            disabled={isPending}
            onValueChange={onExecutionRuntimeChange}
          />
        </TaskConfigSection>
      ) : null}
    </>
  );
}

export function TaskCreateDialog({
  isOpen,
  initialTitle = "",
  initialDescription = "",
  initialAutoPlanGenerationEnabled,
  initialAutoExecute,
  initialStartAt,
  initialEndAt,
  isPending,
  onClose,
  onSubmit,
  autoSuggestionsEnabled,
  allowGoalMode = false,
  availableAiClients = [],
  executionRuntimes = [],
  defaultExecutionRuntime = "hermes",
}: TaskCreateDialogProps) {
  const aiPreferences = useScheduleAiPreferences();
  const resolvedAutoSuggestionsEnabled =
    SCHEDULE_AUTO_SUGGESTIONS_AVAILABLE &&
    (autoSuggestionsEnabled ?? aiPreferences.autoSuggestionsEnabled);
  const defaultAutoExecuteEnabled = aiPreferences.defaultAutoExecuteEnabled,
    defaultAutoPlanGenerationEnabled = aiPreferences.autoPlanGenerationEnabled;
  const [title, setTitle] = useState(initialTitle);
  const [productMode, setProductMode] = useState<"task" | "goal">("task");
  const [goalTitle, setGoalTitle] = useState("");
  const [firstTaskTitle, setFirstTaskTitle] = useState("");
  const { messages } = useI18n();
  const locale = useLocale();
  const [showAutomationDetails, setShowAutomationDetails] = useState(false);
  const localizedDialogCopy = (
    messages.components as
      | { taskCreateDialog?: Partial<typeof DEFAULT_DIALOG_COPY> }
      | undefined
  )?.taskCreateDialog;
  const dialogCopy = {
    ...DEFAULT_DIALOG_COPY,
    ...localizedDialogCopy,
    priorities: {
      ...DEFAULT_DIALOG_COPY.priorities,
      ...localizedDialogCopy?.priorities,
    },
  };
  const resolvedInitialAutoExecute =
    initialAutoExecute ?? defaultAutoExecuteEnabled;
  const resolvedInitialAutoPlanGeneration =
    initialAutoPlanGenerationEnabled ?? defaultAutoPlanGenerationEnabled;
  const [description, setDescription] = useState(initialDescription);
  const [{ dueAt, executionRuntime }, setTaskCreateFields] =
    useTaskCreateFields(isOpen, defaultExecutionRuntime);
  const [priority, setPriority] = useState<
    "Low" | "Medium" | "High" | "Urgent"
  >("Medium");
  const [autoExecute, setAutoExecute] = useState(resolvedInitialAutoExecute);
  const [autoPlanGenerationEnabled, setAutoPlanGenerationEnabled] = useState(
    resolvedInitialAutoPlanGeneration,
  );
  const [autoPlanGenerationTiming, setAutoPlanGenerationTiming] =
    useState<AutomationTimingPreset>("at_start");
  const [autoExecuteTiming, setAutoExecuteTiming] =
    useState<AutomationTimingPreset>("at_start");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [recurrenceMode, setRecurrenceMode] =
    useState<RecurrencePreset>("daily");
  const [customRRULE, setCustomRRULE] = useState("");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [aiClientId, setAiClientId] = useState("");

  /* ---- Auto-complete state ---- */
  const [showAutoComplete, setShowAutoComplete] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Suppress auto-complete after applying a suggestion until next manual input */
  const suppressRef = useRef(false);

  /* ---- AI hooks ---- */
  const {
    suggestions: autoCompleteSuggestions,
    isLoading: acLoading,
    phase,
    statusMessage,
    toolCalls = [],
  } = useAutoComplete(
    resolvedAutoSuggestionsEnabled &&
      !suppressRef.current &&
      !isComposing &&
      title.trim().length >= 3
      ? title.trim()
      : null,
  );

  /* ---- Derive dropdown visibility ---- */
  const hasAutoCompleteSuggestions =
    resolvedAutoSuggestionsEnabled &&
    !suppressRef.current &&
    !isComposing &&
    title.trim().length >= 3 &&
    autoCompleteSuggestions.length > 0;

  const showPanel =
    resolvedAutoSuggestionsEnabled &&
    showAutoComplete &&
    (hasAutoCompleteSuggestions || (acLoading && phase !== "idle"));

  /* ---- Reset form state when dialog opens ---- */
  useEffect(() => {
    if (isOpen) {
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      const formatTime = (date: Date) => {
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${hours}:${minutes}`;
      };

      setStartDate(formatDate(initialStartAt));
      setStartTime(formatTime(initialStartAt));
      setEndTime(formatTime(initialEndAt));
      setTitle(initialTitle);
      setDescription(initialDescription);
      setGoalTitle("");
      setFirstTaskTitle("");
      setPriority("Medium");
      setAutoExecute(resolvedInitialAutoExecute);
      setAutoPlanGenerationEnabled(resolvedInitialAutoPlanGeneration);
      setAutoPlanGenerationTiming("at_start");
      setAutoExecuteTiming("at_start");
      setRecurrenceMode("daily");
      setCustomRRULE("");
      setRepeatEnabled(false);
      setAiClientId("");
      setShowAutoComplete(false);
      suppressRef.current = false;
    }
  }, [
    defaultExecutionRuntime,
    isOpen,
    initialStartAt,
    initialEndAt,
    initialTitle,
    initialDescription,
    resolvedInitialAutoExecute,
    resolvedInitialAutoPlanGeneration,
  ]);

  async function handleSubmit() {
    if (productMode === "task" && !title.trim()) return;
    if (productMode === "goal" && (!goalTitle.trim() || !firstTaskTitle.trim()))
      return;

    const [startHours, startMinutes] = startTime.split(":").map(Number);
    const [endHours, endMinutes] = endTime.split(":").map(Number);

    const scheduledStartAt = new Date(startDate);
    scheduledStartAt.setHours(startHours, startMinutes, 0, 0);

    const scheduledEndAt = new Date(startDate);
    scheduledEndAt.setHours(endHours, endMinutes, 0, 0);

    const recurrenceRule = !repeatEnabled
      ? null
      : recurrenceRuleFromState(recurrenceMode, customRRULE);

    await onSubmit({
      title: productMode === "goal" ? firstTaskTitle.trim() : title.trim(),
      description: description.trim(),
      priority,
      autoExecute,
      autoPlanGenerationEnabled: autoExecute || autoPlanGenerationEnabled,
      autoPlanGenerationTiming,
      autoExecuteTiming,
      dueAt: parseDateTimeInput(dueAt),
      executionRuntime,
      scheduledStartAt,
      scheduledEndAt,
      recurrenceRule,
      recurrenceAnchorStartAt: recurrenceRule
        ? scheduledStartAt.toISOString()
        : null,
      recurrenceAnchorEndAt: recurrenceRule
        ? scheduledEndAt.toISOString()
        : null,
      aiClientId: aiClientId || null,
      mode: productMode,
      goalTitle: productMode === "goal" ? goalTitle.trim() : undefined,
      firstTaskTitle:
        productMode === "goal" ? firstTaskTitle.trim() : undefined,
    });

    onClose();
  }

  function formatLocalDateInput(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  function parseLocalDateInput(value: string) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    if ([year, month, day].some((p) => !Number.isFinite(p))) return null;
    return new Date(year, month - 1, day);
  }

  function formatLocalDateLabel(value: Date) {
    return value.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  const timingOptions = AUTOMATION_TIMING_PRESETS.map((preset) => ({
    value: preset,
    label: dialogCopy.automationTiming[preset],
  }));
  const aiClientOptions = [
    { value: "", label: dialogCopy.defaultAiProvider },
    ...availableAiClients.map((client) => ({
      value: client.id,
      label: client.enabled ? client.name : `${client.name} (disabled)`,
    })),
  ];

  const selectedDate = parseLocalDateInput(startDate);
  const effectiveAutoPlan = autoExecute || autoPlanGenerationEnabled;
  const creationMode = autoExecute
    ? "automatic"
    : autoPlanGenerationEnabled
      ? "plan"
      : "todo";
  function setCreationMode(mode: "todo" | "plan" | "automatic") {
    setAutoExecute(mode === "automatic");
    setAutoPlanGenerationEnabled(mode !== "todo");
  }

  const selectedAiClient =
    availableAiClients.find((client) => client.id === aiClientId) ?? null;
  const policyPreview = deriveAutomationPolicyPreview({
    scheduledStartAt: selectedDate
      ? new Date(`${startDate}T${startTime || "00:00"}:00`)
      : null,
    autoPlanGeneration: effectiveAutoPlan,
    autoExecute,
    autoPlanGenerationTiming,
    autoExecuteTiming,
    providerId:
      aiClientId ||
      (availableAiClients.length > 0 ? "workspace-default" : null),
    providerName:
      selectedAiClient?.name ??
      (availableAiClients.length > 0 ? dialogCopy.defaultAiProvider : null),
    providerConfigured: selectedAiClient
      ? selectedAiClient.enabled
      : availableAiClients.length > 0,
  });
  const automationBlocked =
    policyPreview.readiness !== "ready" &&
    policyPreview.readiness !== "plan_acceptance_required";
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100vh-2rem)] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-background p-0 shadow-2xl sm:max-w-4xl"
      >
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-border/60 px-4 py-3 sm:px-6 sm:py-4">
          <DialogTitle className="text-lg font-semibold text-foreground">
            {dialogCopy.title}
          </DialogTitle>
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label={dialogCopy.close}
              />
            }
          >
            <X className="size-4" />
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {allowGoalMode ? (
            <div
              className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1"
              role="radiogroup"
              aria-label="Creation type"
            >
              <Button
                type="button"
                variant={productMode === "task" ? "secondary" : "ghost"}
                role="radio"
                aria-checked={productMode === "task"}
                onClick={() => setProductMode("task")}
              >
                Task
              </Button>
              <Button
                type="button"
                variant={productMode === "goal" ? "secondary" : "ghost"}
                role="radio"
                aria-checked={productMode === "goal"}
                onClick={() => setProductMode("goal")}
              >
                Goal
              </Button>
            </div>
          ) : null}
          {productMode === "goal" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="goal-title">
                  {dialogCopy.goalLabel}
                </FieldLabel>
                <Input
                  id="goal-title"
                  value={goalTitle}
                  onChange={(event) => setGoalTitle(event.target.value)}
                  placeholder={dialogCopy.goalPlaceholder}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-first-task">
                  {dialogCopy.firstTaskLabel}
                </FieldLabel>
                <Input
                  id="goal-first-task"
                  value={firstTaskTitle}
                  onChange={(event) => setFirstTaskTitle(event.target.value)}
                  placeholder={dialogCopy.firstTaskPlaceholder}
                />
              </Field>
            </div>
          ) : null}
          {productMode === "task" ? (
            <>
              <div className="relative space-y-1.5">
                <label
                  htmlFor="task-create-title"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {dialogCopy.titleLabel}
                </label>
                <input
                  id="task-create-title"
                  type="text"
                  value={title}
                  onChange={(e) => {
                    suppressRef.current = false;
                    setTitle(e.target.value);
                    if (resolvedAutoSuggestionsEnabled && !isComposing) {
                      setShowAutoComplete(true);
                    }
                  }}
                  onCompositionStart={() => {
                    setIsComposing(true);
                    setShowAutoComplete(false);
                  }}
                  onCompositionEnd={(e) => {
                    setIsComposing(false);
                    suppressRef.current = false;
                    setTitle(e.currentTarget.value);
                    if (
                      resolvedAutoSuggestionsEnabled &&
                      e.currentTarget.value.trim().length >= 3
                    ) {
                      setShowAutoComplete(true);
                    }
                  }}
                  onFocus={() => {
                    if (
                      resolvedAutoSuggestionsEnabled &&
                      !isComposing &&
                      (hasAutoCompleteSuggestions ||
                        (acLoading && phase !== "idle"))
                    ) {
                      setShowAutoComplete(true);
                    }
                  }}
                  onBlur={() => {
                    blurTimeoutRef.current = setTimeout(() => {
                      setShowAutoComplete(false);
                    }, 200);
                  }}
                  placeholder={dialogCopy.titlePlaceholder}
                  disabled={isPending}
                  autoFocus
                  className="w-full border-0 border-b border-border/60 bg-transparent px-0 py-2 text-lg font-medium text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
                />

                {showPanel && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border/60 bg-background shadow-lg">
                    <div className="flex items-center gap-1.5 border-b border-border/40 px-3 py-1.5">
                      <Sparkles className="size-3 text-primary" />
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {dialogCopy.aiSuggestions}
                      </span>
                      {acLoading && (
                        <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" />
                      )}
                    </div>

                    {acLoading && statusMessage && (
                      <div className="flex items-center gap-2 border-b border-border/20 px-3 py-1.5 text-[11px] text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        <span>{statusMessage}</span>
                      </div>
                    )}

                    {toolCalls.length > 0 && (
                      <div className="border-b border-border/20 px-3 py-1.5">
                        {toolCalls.map((tc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                          >
                            <Wrench className="size-2.5 text-warning-foreground" />
                            <span className="font-mono">{tc.tool}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {autoCompleteSuggestions
                      .slice(0, 5)
                      .map((suggestion, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="flex w-full flex-col gap-1 px-3 py-2.5 text-left transition hover:bg-muted/50"
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          onClick={() => {
                            if (blurTimeoutRef.current) {
                              clearTimeout(blurTimeoutRef.current);
                              blurTimeoutRef.current = null;
                            }
                            suppressRef.current = true;
                            setTitle(suggestion.title);
                            if (suggestion.description) {
                              setDescription(suggestion.description);
                            }
                            setPriority(suggestion.priority);
                            setShowAutoComplete(false);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {suggestion.title}
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                                priorityBadgeColors[suggestion.priority],
                              )}
                            >
                              {dialogCopy.priorities[suggestion.priority]}
                            </span>
                            {typeof suggestion.estimatedMinutes ===
                              "number" && (
                              <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">
                                ~{suggestion.estimatedMinutes}m
                              </span>
                            )}
                          </div>
                          {suggestion.description && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">
                              {suggestion.description}
                            </span>
                          )}
                        </button>
                      ))}

                    {autoCompleteSuggestions.length === 0 && acLoading && (
                      <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                        {dialogCopy.generatingSuggestions}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <div className="flex flex-col gap-4">
              <TaskConfigSection title={dialogCopy.mode}>
                <div
                  className="grid gap-2 sm:grid-cols-3"
                  role="radiogroup"
                  aria-label={dialogCopy.mode}
                >
                  {(
                    [
                      [
                        "todo",
                        dialogCopy.modeTodo,
                        dialogCopy.modeTodoDescription,
                      ],
                      [
                        "plan",
                        dialogCopy.modePlan,
                        dialogCopy.modePlanDescription,
                      ],
                      [
                        "automatic",
                        dialogCopy.modeAutomatic,
                        dialogCopy.modeAutomaticDescription,
                      ],
                    ] as const
                  ).map(([mode, label, detail]) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={creationMode === mode ? "default" : "outline"}
                      className="h-auto min-h-20 flex-col items-start justify-start whitespace-normal p-3 text-left"
                      role="radio"
                      aria-checked={creationMode === mode}
                      disabled={isPending}
                      onClick={() => setCreationMode(mode)}
                    >
                      <span>{label}</span>
                      <span
                        className={cn(
                          "text-xs font-normal",
                          creationMode === mode
                            ? "text-primary-foreground/80"
                            : "text-muted-foreground",
                        )}
                      >
                        {detail}
                      </span>
                    </Button>
                  ))}
                </div>
              </TaskConfigSection>

              <TaskConfigSection
                title={
                  productMode === "goal"
                    ? dialogCopy.goalAdditionalInformation
                    : dialogCopy.description
                }
              >
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    productMode === "goal"
                      ? dialogCopy.goalAdditionalInformationPlaceholder
                      : dialogCopy.descriptionPlaceholder
                  }
                  disabled={isPending}
                  rows={4}
                  className="bg-background"
                />
              </TaskConfigSection>

              {autoExecute ? (
                <TaskConfigSection title={dialogCopy.date}>
                  <div className="grid gap-3">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isPending}
                          className="w-full justify-start px-3 text-left font-normal"
                        >
                          <CalendarIcon data-icon="inline-start" />
                          {selectedDate
                            ? formatLocalDateLabel(selectedDate)
                            : dialogCopy.date}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="z-[160] w-auto p-0"
                      >
                        <Calendar
                          mode="single"
                          selected={selectedDate ?? undefined}
                          onSelect={(date) =>
                            setStartDate(
                              formatLocalDateInput(date ?? new Date()),
                            )
                          }
                        />
                      </PopoverContent>
                    </Popover>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <TaskConfigField label={dialogCopy.startTime}>
                        <Input
                          type="time"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          disabled={isPending}
                          className="bg-background"
                        />
                      </TaskConfigField>
                      <TaskConfigField label={dialogCopy.endTime}>
                        <Input
                          type="time"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          disabled={isPending}
                          className="bg-background"
                        />
                      </TaskConfigField>
                    </div>
                  </div>
                </TaskConfigSection>
              ) : null}
            </div>

            <div className="flex flex-col gap-4">
              <TaskConfigSection title={dialogCopy.priority}>
                <div className="grid grid-cols-4 gap-2">
                  {(["Low", "Medium", "High", "Urgent"] as const).map(
                    (option) => (
                      <Button
                        key={option}
                        type="button"
                        variant={priority === option ? "default" : "outline"}
                        size="sm"
                        disabled={isPending}
                        onClick={() => setPriority(option)}
                        className="w-full gap-1.5"
                        aria-pressed={priority === option}
                      >
                        {priority === option ? (
                          <Check className="size-3.5" aria-hidden />
                        ) : null}
                        {dialogCopy.priorities[option]}
                      </Button>
                    ),
                  )}
                </div>
              </TaskConfigSection>

              <TaskCreateSchedulingFields
                dialogCopy={dialogCopy}
                dueAt={dueAt}
                onDueAtChange={(value) =>
                  setTaskCreateFields((current) => ({
                    ...current,
                    dueAt: value,
                  }))
                }
                executionRuntime={executionRuntime}
                executionRuntimes={executionRuntimes}
                onExecutionRuntimeChange={(value) =>
                  setTaskCreateFields((current) => ({
                    ...current,
                    executionRuntime: value,
                  }))
                }
                isPending={isPending}
              />

              {autoExecute ? (
                <>
                  <TaskConfigSection title={dialogCopy.recurrence}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={repeatEnabled}
                        disabled={isPending}
                        onCheckedChange={(checked) =>
                          setRepeatEnabled(checked === true)
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 space-y-1">
                        <span className="text-sm font-medium">
                          {dialogCopy.recurrence}
                        </span>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {dialogCopy.recurrenceDescription}
                        </p>
                      </div>
                    </label>

                    {repeatEnabled && (
                      <div className="mt-3 space-y-3 border-t border-border/30 pt-3">
                        <div className="flex gap-2">
                          {RECURRENCE_UI_PRESETS.map((preset) => (
                            <Button
                              key={preset}
                              type="button"
                              variant={
                                recurrenceMode === preset
                                  ? "default"
                                  : "outline"
                              }
                              size="sm"
                              disabled={isPending}
                              onClick={() => setRecurrenceMode(preset)}
                              className="flex-1"
                            >
                              {
                                (
                                  dialogCopy.recurrencePresets as Record<
                                    string,
                                    string
                                  >
                                )[preset]
                              }
                            </Button>
                          ))}
                        </div>
                        {recurrenceMode === "custom" && (
                          <TaskConfigField
                            label={dialogCopy.recurrenceCustomLabel}
                          >
                            <Input
                              value={customRRULE}
                              onChange={(e) => setCustomRRULE(e.target.value)}
                              placeholder={
                                dialogCopy.recurrenceCustomPlaceholder
                              }
                              disabled={isPending}
                              className="bg-background"
                            />
                          </TaskConfigField>
                        )}
                      </div>
                    )}
                  </TaskConfigSection>

                  {aiClientOptions.length > 1 ? (
                    <TaskConfigSection title={dialogCopy.aiProvider}>
                      <TaskConfigField
                        label={dialogCopy.aiProvider}
                        hint={dialogCopy.aiProviderHint}
                      >
                        <TaskConfigSelect
                          name="aiClientId"
                          value={aiClientId}
                          options={aiClientOptions}
                          disabled={isPending}
                          onValueChange={setAiClientId}
                        />
                      </TaskConfigField>
                    </TaskConfigSection>
                  ) : null}
                </>
              ) : null}
              {!autoExecute && autoPlanGenerationEnabled ? (
                <TaskConfigSection title={dialogCopy.automationPreview}>
                  <div
                    aria-label={dialogCopy.automationPreview}
                    className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs leading-5"
                  >
                    <p className="font-semibold text-foreground">
                      {dialogCopy.automaticPlanSummary}
                    </p>
                    {policyPreview.disabledReason ? (
                      <p className="mt-1 text-muted-foreground">
                        {policyPreview.disabledReason}
                      </p>
                    ) : null}
                  </div>
                </TaskConfigSection>
              ) : null}

              {autoExecute ? (
                <TaskConfigSection title={dialogCopy.automationPreview}>
                  <div className="mb-3 grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {dialogCopy.automationTimingLabel}
                    </span>
                    <Select
                      value={autoExecuteTiming}
                      disabled={isPending}
                      onValueChange={(value) =>
                        setAutoExecuteTiming(normalizeAutomationTiming(value))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timingOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div
                    aria-label={dialogCopy.automationPreview}
                    className="rounded-xl border border-border/70 bg-muted/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">
                          {dialogCopy.automaticRunTitle}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {dialogCopy.automaticRunSummary}
                        </p>
                      </div>
                      <Badge
                        variant={automationBlocked ? "destructive" : "default"}
                      >
                        {automationBlocked
                          ? dialogCopy.automaticRunActionRequired
                          : dialogCopy.automaticRunReady}
                      </Badge>
                    </div>
                    {automationBlocked && policyPreview.disabledReason ? (
                      <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                        {policyPreview.disabledReason}
                      </p>
                    ) : null}

                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="font-medium text-muted-foreground">
                          {dialogCopy.automaticRunTime}
                        </dt>
                        <dd className="mt-0.5 text-foreground">
                          {policyPreview.nextOccurrenceAt
                            ? new Intl.DateTimeFormat(
                                locale === "zh" ? "zh-CN" : "en",
                                {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                },
                              ).format(new Date(policyPreview.nextOccurrenceAt))
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-muted-foreground">
                          {dialogCopy.automaticRunProvider}
                        </dt>
                        <dd className="mt-0.5 text-foreground">
                          {policyPreview.providerName ??
                            dialogCopy.defaultProviderSummary}
                        </dd>
                      </div>
                    </dl>

                    <button
                      type="button"
                      className="mt-3 flex w-full items-center justify-between border-t border-border/60 pt-3 text-left text-xs font-medium text-foreground"
                      aria-expanded={showAutomationDetails}
                      onClick={() =>
                        setShowAutomationDetails((current) => !current)
                      }
                    >
                      {dialogCopy.automaticRunDetails}
                      <ChevronDown
                        className={cn(
                          "size-4 transition-transform",
                          showAutomationDetails && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    {showAutomationDetails ? (
                      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
                        <li>• {dialogCopy.automaticRunPause}</li>
                        <li>• {dialogCopy.automaticRunRetry}</li>
                        <li>• {dialogCopy.automaticRunMissed}</li>
                        <li>• {dialogCopy.automaticRunPage}</li>
                      </ul>
                    ) : null}
                  </div>
                </TaskConfigSection>
              ) : null}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t border-border/60 bg-background/95 px-4 py-3 shadow-[0_-8px_20px_rgba(15,23,42,0.06)] backdrop-blur sm:px-6 sm:py-4">
          <DialogClose
            render={
              <Button
                type="button"
                disabled={isPending}
                variant="ghost"
                size="sm"
              />
            }
          >
            {dialogCopy.cancel}
          </DialogClose>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={
              isPending ||
              (productMode === "task"
                ? !title.trim()
                : !goalTitle.trim() || !firstTaskTitle.trim())
            }
            variant="default"
            size="sm"
            className="min-w-20 rounded-lg"
          >
            {isPending
              ? dialogCopy.saving
              : productMode === "goal"
                ? "Create Goal and first task"
                : dialogCopy.save}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
