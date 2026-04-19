"use client";

import { Loader2, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AutomationSuggestionPanel } from "@/components/schedule/automation-suggestion-panel";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAutoComplete, useSmartAutomation } from "@/hooks/use-ai";

/* ------------------------------------------------------------------ */
/*  Priority badge color map                                          */
/* ------------------------------------------------------------------ */
const priorityBadgeColors: Record<string, string> = {
  Low: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-orange-100 text-orange-700",
  Urgent: "bg-red-100 text-red-700",
};

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
    dueAt: Date | null;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
  }) => Promise<void>;
};

export function TaskCreateDialog({
  isOpen,
  initialTitle = "",
  initialStartAt,
  initialEndAt,
  isPending,
  onClose,
  onSubmit,
}: TaskCreateDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"Low" | "Medium" | "High" | "Urgent">("Medium");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  /* ---- Auto-complete state ---- */
  const [showAutoComplete, setShowAutoComplete] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Suppress auto-complete after applying a suggestion until next manual input */
  const suppressRef = useRef(false);

  /* ---- AI hooks ---- */
  const {
    suggestions: autoCompleteSuggestions,
    isLoading: acLoading,
    phase,
    statusMessage,
    toolCalls,
  } = useAutoComplete(
    !suppressRef.current && title.trim().length >= 3 ? title.trim() : null,
  );

  const automationInput =
    !suppressRef.current && title.trim().length >= 3
      ? {
          title: title.trim(),
          description,
          priority,
          dueAt: null as Date | null,
          scheduledStartAt: initialStartAt,
          scheduledEndAt: initialEndAt,
          isRunnable: false,
          runnabilityState: "not_configured" as const,
          ownerType: "human" as const,
        }
      : null;

  const { suggestion: aiSuggestion, isLoading: aiLoading } =
    useSmartAutomation(automationInput);

  /* ---- Derive dropdown visibility ---- */
  const hasAutoCompleteSuggestions =
    !suppressRef.current &&
    title.trim().length >= 3 &&
    autoCompleteSuggestions != null &&
    autoCompleteSuggestions.length > 0;

  const showPanel = showAutoComplete && (
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
      setShowAutoComplete(false);
      suppressRef.current = false;
    }
  }, [isOpen, initialStartAt, initialEndAt, initialTitle]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

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
      dueAt: null,
      scheduledStartAt,
      scheduledEndAt,
    });

    onClose();
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop - 不模糊，只是半透明遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Add task</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

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
                setShowAutoComplete(true);
              }}
              onFocus={() => {
                if (hasAutoCompleteSuggestions || (acLoading && phase !== "idle")) {
                  setShowAutoComplete(true);
                }
              }}
              onBlur={() => {
                blurTimeoutRef.current = setTimeout(() => {
                  setShowAutoComplete(false);
                }, 200);
              }}
              placeholder="Add title"
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
                    AI Suggestions
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
                      if (suggestion.priority) {
                        setPriority(
                          suggestion.priority as "Low" | "Medium" | "High" | "Urgent",
                        );
                      }
                      setShowAutoComplete(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {suggestion.title}
                      </span>
                      {suggestion.priority && (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                            priorityBadgeColors[suggestion.priority] ??
                              "bg-muted text-muted-foreground",
                          )}
                        >
                          {suggestion.priority}
                        </span>
                      )}
                      {suggestion.estimatedMinutes != null && (
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
                    正在生成建议...
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
                  Date
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
                  Start time
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
                  End time
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

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description"
              disabled={isPending}
              rows={3}
              className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">
              Priority
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
                  {option}
                </button>
              ))}
            </div>
          </div>

          {/* AI Suggestion */}
          <AutomationSuggestionPanel
            suggestion={aiSuggestion}
            isLoading={aiLoading}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border/60 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isPending || !title.trim()}
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "min-w-20 rounded-lg",
            )}
          >
            {isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
