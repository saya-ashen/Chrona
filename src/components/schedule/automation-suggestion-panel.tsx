"use client";

import { Bot, Clock, FileText, Lightbulb, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutomationSuggestion } from "@/modules/ai/types";

const executionModeLabels: Record<string, { label: string; icon: typeof Zap; description: string }> = {
  immediate: { label: "Immediate", icon: Zap, description: "Run as soon as the task is created" },
  scheduled: { label: "Scheduled", icon: Clock, description: "Run at the scheduled time" },
  recurring: { label: "Recurring", icon: Clock, description: "Run on a recurring schedule" },
  manual: { label: "Manual", icon: Bot, description: "Requires manual trigger" },
};

const confidenceColors: Record<string, string> = {
  high: "text-green-700 bg-green-100",
  medium: "text-amber-700 bg-amber-100",
  low: "text-muted-foreground bg-muted",
};

export function AutomationSuggestionPanel({
  suggestion,
  isLoading,
  onApplyExecutionMode,
  onApplyReminder,
}: {
  suggestion: AutomationSuggestion | null;
  isLoading?: boolean;
  onApplyExecutionMode?: (mode: string) => void;
  onApplyReminder?: (advanceMinutes: number) => void;
}) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm text-primary">
          <Bot className="size-4 animate-pulse" />
          <span className="font-medium">AI is analyzing your task...</span>
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-3 animate-pulse rounded bg-primary/10" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-primary/10" />
        </div>
      </div>
    );
  }

  if (!suggestion) {
    return null;
  }

  const modeInfo = executionModeLabels[suggestion.executionMode] ?? executionModeLabels.manual;
  const ModeIcon = modeInfo.icon;

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Lightbulb className="size-4" />
          AI Suggestions
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", confidenceColors[suggestion.confidence])}>
          {suggestion.confidence} confidence
        </span>
      </div>

      {/* Execution Mode */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Execution Mode
        </p>
        <button
          type="button"
          onClick={() => onApplyExecutionMode?.(suggestion.executionMode)}
          className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-background"
        >
          <ModeIcon className="size-4 text-primary" />
          <div>
            <p className="font-medium text-foreground">{modeInfo.label}</p>
            <p className="text-xs text-muted-foreground">{modeInfo.description}</p>
          </div>
        </button>
      </div>

      {/* Reminder */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Reminder
        </p>
        <button
          type="button"
          onClick={() => onApplyReminder?.(suggestion.reminderStrategy.advanceMinutes)}
          className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-background"
        >
          <Clock className="size-4 text-primary" />
          <div>
            <p className="font-medium text-foreground">
              {suggestion.reminderStrategy.advanceMinutes}min before · {suggestion.reminderStrategy.frequency}
            </p>
            <p className="text-xs text-muted-foreground">
              via {suggestion.reminderStrategy.channels.join(", ")}
            </p>
          </div>
        </button>
      </div>

      {/* Preparation Steps */}
      {suggestion.preparationSteps.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Preparation
          </p>
          <ul className="space-y-1">
            {suggestion.preparationSteps.slice(0, 3).map((step, index) => (
              <li key={index} className="flex items-start gap-2 text-xs text-muted-foreground">
                <FileText className="mt-0.5 size-3 shrink-0 text-primary/60" />
                {step}
              </li>
            ))}
            {suggestion.preparationSteps.length > 3 ? (
              <li className="text-xs text-muted-foreground/60">
                +{suggestion.preparationSteps.length - 3} more steps
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
