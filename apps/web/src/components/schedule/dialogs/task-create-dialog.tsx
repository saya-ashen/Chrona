"use client";

import { Loader2, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAutoComplete } from "@/hooks/use-ai";
import { useI18n } from "@chrona/i18n/react";
import { useScheduleAiPreferences } from "@/lib/schedule-ai-preferences";

/* ------------------------------------------------------------------ */
/*  Priority badge color map                                          */
/* ------------------------------------------------------------------ */
const priorityBadgeColors: Record<string, string> = {
  Low: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-orange-100 text-orange-700",
  Urgent: "bg-red-100 text-red-700",
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
  autoExecute: "Auto-execute at scheduled time",
  autoExecuteDescription: "Force plan generation on, accept the generated plan, then start execution at the scheduled time.",
  autoPlanGeneration: "Generate plan after saving",
  autoPlanGenerationDescription: "Create a draft execution plan after saving. Required when auto-execute is enabled.",
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
    dueAt: Date | null;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
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
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

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

    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      priority,
      autoExecute,
      autoPlanGenerationEnabled: autoExecute || autoPlanGenerationEnabled,
      dueAt: null,
      scheduledStartAt,
      scheduledEndAt,
    });

    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100vh-2rem)] max-w-md overflow-hidden rounded-2xl border border-border/60 bg-background p-0 shadow-2xl"
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

        {/* Content */}
        <div className="space-y-4 px-6 py-5">
          {/* Title with auto-complete */}
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

            {/* Auto-complete dropdown with streaming */}
            {showPanel && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border/60 bg-background shadow-lg">
                {/* Header */}
                <div className="flex items-center gap-1.5 border-b border-border/40 px-3 py-1.5">
                  <Sparkles className="size-3 text-primary" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {dialogCopy.aiSuggestions}
                  </span>
                  {acLoading && (
                    <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" />
                  )}
                </div>

                {/* Streaming status */}
                {acLoading && statusMessage && (
                  <div className="flex items-center gap-2 border-b border-border/20 px-3 py-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    <span>{statusMessage}</span>
                  </div>
                )}

                {/* Tool calls */}
                {toolCalls.length > 0 && (
                  <div className="border-b border-border/20 px-3 py-1.5">
                    {toolCalls.map((tc, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Wrench className="size-2.5 text-amber-500" />
                        <span className="font-mono">{tc.tool}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Suggestions list */}
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

                {/* Loading placeholder */}
                {autoCompleteSuggestions.length === 0 && acLoading && (
                  <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                    {dialogCopy.generatingSuggestions}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Date and Time */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {dialogCopy.date}
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={isPending}
                  className="h-10 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {dialogCopy.startTime}
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={isPending}
                  className="h-10 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {dialogCopy.endTime}
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  disabled={isPending}
                  className="h-10 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
                />
              </div>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={autoExecute}
              onChange={(e) => {
                const checked = e.target.checked;
                setAutoExecute(checked);
                if (checked) {
                  setAutoPlanGenerationEnabled(true);
                }
              }}
              disabled={isPending}
              className="mt-1 shrink-0"
            />
            <span className="min-w-0">
              <span className="block font-medium">{dialogCopy.autoExecute}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {dialogCopy.autoExecuteDescription}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={autoExecute || autoPlanGenerationEnabled}
              onChange={(e) => setAutoPlanGenerationEnabled(e.target.checked)}
              disabled={isPending || autoExecute}
              className="mt-1 shrink-0"
            />
            <span className="min-w-0">
              <span className="block font-medium">{dialogCopy.autoPlanGeneration}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {dialogCopy.autoPlanGenerationDescription}
              </span>
            </span>
          </label>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {dialogCopy.description}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={dialogCopy.descriptionPlaceholder}
              disabled={isPending}
              rows={3}
              className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">
              {dialogCopy.priority}
            </label>
            <div className="flex gap-2">
              {(["Low", "Medium", "High", "Urgent"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPriority(option)}
                  disabled={isPending}
                  className={cn(
                    "flex-1 rounded-lg border py-2 text-xs font-medium transition",
                    priority === option
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {dialogCopy.priorities[option]}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Footer */}
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
