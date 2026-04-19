"use client";

import { useState } from "react";
import {
  Scissors,
  Clock,
  AlertTriangle,
  ChevronDown,
  Check,
  Bot,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type TaskDecompositionResult,
  type SubtaskSuggestion,
} from "@/modules/ai/task-decomposer";
import { useSmartDecomposition } from "@/hooks/use-ai";

export interface TaskDecompositionPanelProps {
  taskId: string;
  title: string;
  description?: string | null;
  priority: string;
  dueAt?: Date | null;
  estimatedMinutes?: number;
  autoRequest?: boolean;
  onApply?: (result: TaskDecompositionResult) => void;
}

const feasibilityColor = (score: number): string => {
  if (score >= 70) return "text-green-700 bg-green-100";
  if (score >= 40) return "text-amber-700 bg-amber-100";
  return "text-muted-foreground bg-muted";
};

const priorityTone = (priority: string): string => {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "text-red-700 bg-red-100";
    case "high":
      return "text-orange-700 bg-orange-100";
    case "medium":
      return "text-amber-700 bg-amber-100";
    case "low":
      return "text-green-700 bg-green-100";
    default:
      return "text-muted-foreground bg-muted";
  }
};

export function TaskDecompositionPanel({
  taskId,
  title,
  description,
  priority,
  dueAt,
  estimatedMinutes,
  autoRequest = false,
  onApply,
}: TaskDecompositionPanelProps) {
  // Only trigger AI when user explicitly requests it
  const [requested, setRequested] = useState(autoRequest);

  const { result, isLoading, error } = useSmartDecomposition(
    requested
      ? {
          taskId,
          title,
          description: description ?? undefined,
          priority,
          dueAt,
          estimatedMinutes,
        }
      : null,
  );

  // Not requested yet — show trigger button
  if (!requested) {
    return (
      <button
        type="button"
        onClick={() => setRequested(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border/60 bg-background/50 px-4 py-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
      >
        <Scissors className="size-4" />
        <span>AI 任务分解</span>
        <Sparkles className="ml-auto size-3" />
      </button>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm text-primary">
          <Bot className="size-4 animate-pulse" />
          <span className="font-medium">AI 正在分解任务...</span>
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-3 animate-pulse rounded bg-primary/10" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-primary/10" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-primary/10" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>Failed to decompose: {error}</p>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Scissors className="size-4" />
          Task Decomposition
        </div>
        {result.feasibilityScore != null && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              feasibilityColor(result.feasibilityScore),
            )}
          >
            {result.feasibilityScore}% feasible
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" />
          Total: {result.totalEstimatedMinutes} min
        </span>
        <span className="text-xs text-muted-foreground">
          ({result.subtasks.length} subtask{result.subtasks.length !== 1 ? "s" : ""})
        </span>
      </div>

      {/* Warnings */}
      {result.warnings && result.warnings.length > 0 ? (
        <div className="space-y-1">
          {result.warnings.map((warning, index) => (
            <div
              key={index}
              className="flex items-start gap-2 text-xs text-amber-700"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Subtask list */}
      <div className="space-y-1.5">
        {result.subtasks.map((subtask: SubtaskSuggestion, index: number) => (
          <SubtaskRow key={index} subtask={subtask} />
        ))}
      </div>

      {/* Apply button */}
      {onApply ? (
        <button
          type="button"
          onClick={() => onApply(result)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
        >
          <Check className="size-4" />
          Apply Decomposition
        </button>
      ) : null}
    </div>
  );
}

function SubtaskRow({ subtask }: { subtask: SubtaskSuggestion }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border/40 bg-background/60">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition",
            expanded && "rotate-180",
          )}
        />
        <span className="flex-1 truncate font-medium text-foreground">
          {subtask.title}
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
            priorityTone(subtask.priority ?? "Medium"),
          )}
        >
          {subtask.priority ?? "Medium"}
        </span>
        {subtask.estimatedMinutes != null && (
          <span className="text-[10px] text-muted-foreground">
            {subtask.estimatedMinutes}m
          </span>
        )}
      </button>
      {expanded && subtask.description ? (
        <div className="border-t border-border/30 px-3 py-2 text-xs text-muted-foreground">
          {subtask.description}
        </div>
      ) : null}
    </div>
  );
}
