"use client";

import { CalendarIcon, Loader2, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAutoComplete } from "@/hooks/use-ai";
import { useI18n } from "@chrona/i18n/react";
import { useScheduleAiPreferences } from "@/lib/schedule-ai-preferences";
import { AUTOMATION_TIMING_PRESETS, normalizeAutomationTiming } from "@chrona/contracts";
import type { AutomationTimingPreset } from "@chrona/contracts";
import {
  TaskConfigSection,
  TaskConfigField,
} from "@/components/schedule/forms/task-config-form";

/* ------------------------------------------------------------------ */
/*  Recurrence presets                                                */
/* ------------------------------------------------------------------ */
const RECURRENCE_PRESETS = ["daily", "weekly", "monthly", "custom"] as const;
type RecurrencePreset = (typeof RECURRENCE_PRESETS)[number];

const RECURRENCE_PRESET_RRULE: Record<Exclude<RecurrencePreset, "custom">, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
};

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
  aiSuggestions: "AI Suggestions",
  generatingSuggestions: "Generating suggestions...",
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
  autoExecuteDescription: "Force plan generation on, accept the generated plan, then start execution at the scheduled time.",
  autoPlanGeneration: "Auto-generate plan",
  autoPlanGenerationDescription: "Automatically generate an execution plan after saving. Required when auto-execute is enabled.",
  automationTimingLabel: "Start timing",
  automationTiming: {
    immediate: "Immediately",
    at_start: "At scheduled start",
    before_30m: "30 minutes before start",
    before_1h: "1 hour before start",
    before_2h: "2 hours before start",
    before_1d: "1 day before start",
  },
  description: "Description (optional)",
  descriptionPlaceholder: "Add description",
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
  initialStartAt: Date;
  initialEndAt: Date;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    description: string;
    priority: "Low" | "Medium" | "High" | "Urgent";
    autoExecute: boolean;
    autoPlanGenerationEnabled: boolean;
    autoPlanGenerationTiming: AutomationTimingPreset;
    autoExecuteTiming: AutomationTimingPreset;
    dueAt: Date | null;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
    recurrenceRule: string | null;
    recurrenceAnchorStartAt: string | null;
    recurrenceAnchorEndAt: string | null;
  }) => Promise<void>;
  autoSuggestionsEnabled?: boolean;
};

export function TaskCreateDialog({
  isOpen,
  initialTitle = "",
  initialStartAt,
  initialEndAt,
  isPending,
  onClose,
  onSubmit,
  autoSuggestionsEnabled,
}: TaskCreateDialogProps) {
  const aiPreferences = useScheduleAiPreferences();
  const resolvedAutoSuggestionsEnabled = autoSuggestionsEnabled ?? aiPreferences.autoSuggestionsEnabled;
  const defaultAutoExecuteEnabled = aiPreferences.defaultAutoExecuteEnabled;
  const defaultAutoPlanGenerationEnabled = aiPreferences.autoPlanGenerationEnabled;
  const [title, setTitle] = useState(initialTitle);
  const { messages } = useI18n();
  const localizedDialogCopy = (messages.components as { taskCreateDialog?: Partial<typeof DEFAULT_DIALOG_COPY> } | undefined)?.taskCreateDialog;
  const dialogCopy = {
    ...DEFAULT_DIALOG_COPY,
    ...localizedDialogCopy,
    priorities: {
      ...DEFAULT_DIALOG_COPY.priorities,
      ...localizedDialogCopy?.priorities,
    },
  };
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"Low" | "Medium" | "High" | "Urgent">("Medium");
  const [autoExecute, setAutoExecute] = useState(defaultAutoExecuteEnabled);
  const [autoPlanGenerationEnabled, setAutoPlanGenerationEnabled] = useState(defaultAutoPlanGenerationEnabled);
  const [autoPlanGenerationTiming, setAutoPlanGenerationTiming] = useState<AutomationTimingPreset>("at_start");
  const [autoExecuteTiming, setAutoExecuteTiming] = useState<AutomationTimingPreset>("at_start");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrencePreset>("daily");
  const [customRRULE, setCustomRRULE] = useState("");
  const [repeatEnabled, setRepeatEnabled] = useState(false);

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
    resolvedAutoSuggestionsEnabled && !suppressRef.current && !isComposing && title.trim().length >= 3 ? title.trim() : null,
  );

  /* ---- Derive dropdown visibility ---- */
  const hasAutoCompleteSuggestions =
    resolvedAutoSuggestionsEnabled &&
    !suppressRef.current &&
    !isComposing &&
    title.trim().length >= 3 &&
    autoCompleteSuggestions.length > 0;

  const showPanel = resolvedAutoSuggestionsEnabled && showAutoComplete && (
    hasAutoCompleteSuggestions ||
    (acLoading && phase !== "idle")
  );

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
      setDescription("");
      setPriority("Medium");
      setAutoExecute(defaultAutoExecuteEnabled);
      setAutoPlanGenerationEnabled(defaultAutoPlanGenerationEnabled);
      setAutoPlanGenerationTiming("at_start");
      setAutoExecuteTiming("at_start");
      setRecurrenceMode("daily");
      setCustomRRULE("");
      setRepeatEnabled(false);
      setShowAutoComplete(false);
      suppressRef.current = false;
    }
  }, [isOpen, initialStartAt, initialEndAt, initialTitle, defaultAutoExecuteEnabled, defaultAutoPlanGenerationEnabled]);

  async function handleSubmit() {
    if (!title.trim()) return;

    const [startHours, startMinutes] = startTime.split(":").map(Number);
    const [endHours, endMinutes] = endTime.split(":").map(Number);

    const scheduledStartAt = new Date(startDate);
    scheduledStartAt.setHours(startHours, startMinutes, 0, 0);

    const scheduledEndAt = new Date(startDate);
    scheduledEndAt.setHours(endHours, endMinutes, 0, 0);

    const recurrenceRule = !repeatEnabled
      ? null
      : recurrenceMode === "custom"
        ? customRRULE.trim() || null
        : RECURRENCE_PRESET_RRULE[recurrenceMode] ?? null;

    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      priority,
      autoExecute,
      autoPlanGenerationEnabled: autoExecute || autoPlanGenerationEnabled,
      autoPlanGenerationTiming,
      autoExecuteTiming,
      dueAt: null,
      scheduledStartAt,
      scheduledEndAt,
      recurrenceRule,
      recurrenceAnchorStartAt: recurrenceRule ? scheduledStartAt.toISOString() : null,
      recurrenceAnchorEndAt: recurrenceRule ? scheduledEndAt.toISOString() : null,
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
    return value.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  const timingOptions = AUTOMATION_TIMING_PRESETS.map((preset) => ({
    value: preset,
    label: dialogCopy.automationTiming[preset],
  }));

  const selectedDate = parseLocalDateInput(startDate);
  const effectiveAutoPlan = autoExecute || autoPlanGenerationEnabled;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100vh-2rem)] max-w-[calc(100%-2rem)] sm:max-w-4xl overflow-hidden rounded-2xl border border-border/60 bg-background p-0 shadow-2xl"
      >
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-border/60 px-6 py-4">
          <DialogTitle className="text-lg font-semibold text-foreground">{dialogCopy.title}</DialogTitle>
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

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <div className="relative">
            <input
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
                if (resolvedAutoSuggestionsEnabled && e.currentTarget.value.trim().length >= 3) {
                  setShowAutoComplete(true);
                }
              }}
              onFocus={() => {
                if (resolvedAutoSuggestionsEnabled && !isComposing && (hasAutoCompleteSuggestions || (acLoading && phase !== "idle"))) {
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
                      <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Wrench className="size-2.5 text-warning-foreground" />
                        <span className="font-mono">{tc.tool}</span>
                      </div>
                    ))}
                  </div>
                )}

                {autoCompleteSuggestions.slice(0, 5).map((suggestion, idx) => (
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
                      {typeof suggestion.estimatedMinutes === "number" && (
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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <div className="flex flex-col gap-4">
              <TaskConfigSection title={dialogCopy.description}>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={dialogCopy.descriptionPlaceholder}
                  disabled={isPending}
                  rows={4}
                  className="bg-background"
                />
              </TaskConfigSection>

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
                        {selectedDate ? formatLocalDateLabel(selectedDate) : dialogCopy.date}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="z-[160] w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={selectedDate ?? undefined}
                        onSelect={(date) => setStartDate(formatLocalDateInput(date ?? new Date()))}
                      />
                    </PopoverContent>
                  </Popover>

                  <div className="grid grid-cols-2 gap-3">
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
            </div>

            <div className="flex flex-col gap-4">
              <TaskConfigSection title={dialogCopy.priority}>
                <div className="grid grid-cols-4 gap-2">
                  {(["Low", "Medium", "High", "Urgent"] as const).map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={priority === option ? "default" : "outline"}
                      size="sm"
                      disabled={isPending}
                      onClick={() => setPriority(option)}
                      className="w-full"
                    >
                      {dialogCopy.priorities[option]}
                    </Button>
                  ))}
                </div>
              </TaskConfigSection>

              <TaskConfigSection title={dialogCopy.recurrence}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={repeatEnabled}
                    disabled={isPending}
                    onCheckedChange={(checked) => setRepeatEnabled(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 space-y-1">
                    <span className="text-sm font-medium">{dialogCopy.recurrence}</span>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {dialogCopy.recurrenceDescription}
                    </p>
                  </div>
                </label>

                {repeatEnabled && (
                  <div className="mt-3 space-y-3 border-t border-border/30 pt-3">
                    <div className="flex gap-2">
                      {RECURRENCE_PRESETS.map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          variant={recurrenceMode === preset ? "default" : "outline"}
                          size="sm"
                          disabled={isPending}
                          onClick={() => setRecurrenceMode(preset)}
                          className="flex-1"
                        >
                          {(dialogCopy.recurrencePresets as Record<string, string>)[preset]}
                        </Button>
                      ))}
                    </div>
                    {recurrenceMode === "custom" && (
                      <TaskConfigField label={dialogCopy.recurrenceCustomLabel}>
                        <Input
                          value={customRRULE}
                          onChange={(e) => setCustomRRULE(e.target.value)}
                          placeholder={dialogCopy.recurrenceCustomPlaceholder}
                          disabled={isPending}
                          className="bg-background"
                        />
                      </TaskConfigField>
                    )}
                  </div>
                )}
              </TaskConfigSection>

              <TaskConfigSection
                title={dialogCopy.autoPlanGeneration}
                actions={effectiveAutoPlan || autoExecute ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">On</span>
                ) : null}
              >
                <div className="grid gap-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={effectiveAutoPlan}
                      disabled={isPending || autoExecute}
                      onCheckedChange={(checked) => setAutoPlanGenerationEnabled(checked === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 space-y-1">
                      <span className="text-sm font-medium">{dialogCopy.autoPlanGeneration}</span>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {dialogCopy.autoPlanGenerationDescription}
                      </p>
                    </div>
                  </label>

                  {effectiveAutoPlan && (
                    <div className="ml-9 grid gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">{dialogCopy.automationTimingLabel}</span>
                      <Select
                        value={autoPlanGenerationTiming}
                        disabled={isPending}
                        onValueChange={(v) => setAutoPlanGenerationTiming(normalizeAutomationTiming(v))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[160]">
                          <SelectGroup>
                            {timingOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="border-t border-border/30 pt-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={autoExecute}
                        disabled={isPending}
                        onCheckedChange={(checked) => {
                          const c = checked === true;
                          setAutoExecute(c);
                          if (c) setAutoPlanGenerationEnabled(true);
                        }}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 space-y-1">
                        <span className="text-sm font-medium">{dialogCopy.autoExecute}</span>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {dialogCopy.autoExecuteDescription}
                        </p>
                      </div>
                    </label>

                    {autoExecute && (
                      <div className="ml-9 mt-3 grid gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">{dialogCopy.automationTimingLabel}</span>
                        <Select
                          value={autoExecuteTiming}
                          disabled={isPending}
                          onValueChange={(v) => setAutoExecuteTiming(normalizeAutomationTiming(v))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="z-[160]">
                            <SelectGroup>
                              {timingOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </TaskConfigSection>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border/60 px-6 py-4">
          <DialogClose
            render={<Button type="button" disabled={isPending} variant="ghost" size="sm" />}
          >
            {dialogCopy.cancel}
          </DialogClose>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isPending || !title.trim()}
            variant="default"
            size="sm"
            className="min-w-20 rounded-lg"
          >
            {isPending ? dialogCopy.saving : dialogCopy.save}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
