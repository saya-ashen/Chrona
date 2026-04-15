"use client";

import { useMemo } from "react";
import {
  Scissors,
  Clock,
  AlertTriangle,
  ChevronDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  decomposeTask,
  type TaskDecompositionResult,
  type SubtaskSuggestion,
} from "@/modules/ai/task-decomposer";

export interface TaskDecompositionPanelProps {
  taskId: string;
  title: string;
  description?: string | null;
  priority: string;
  dueAt?: Date | null;
  estimatedMinutes?: number;
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
  onApply,
}: TaskDecompositionPanelProps) {
  const result = useMemo(() => {
    return decomposeTask({
      taskId,
      title,
      description: description ?? undefined,
      priority,
      dueAt: dueAt ?? undefined,
      estimatedMinutes,
    });
  }, [taskId, title, description, priority, dueAt, estimatedMinutes]);

  // Don't render if decomposition produced no subtasks
  if (result.subtasks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Scissors className="size-4" />
          AI Decomposition
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            feasibilityColor(result.feasibilityScore),
          )}
        >
          {result.feasibilityScore}% feasibility
        </span>
      </div>

      {/* Subtask list */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Suggested Subtasks
        </p>
        <ul className="space-y-0">
          {result.subtasks.map((subtask, index) => (
            <SubtaskItem
              key={`${subtask.order}-${subtask.title}`}
              subtask={subtask}
              isLast={index === result.subtasks.length - 1}
            />
          ))}
        </ul>
      </div>

      {/* Total estimated time */}
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm">
        <Clock className="size-4 text-primary" />
        <span className="font-medium text-foreground">
          Total: {result.totalEstimatedMinutes} min
        </span>
        <span className="text-xs text-muted-foreground">
          ({result.subtasks.length} subtask{result.subtasks.length !== 1 ? "s" : ""})
        </span>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 ? (
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

      {/* Apply button */}
      <button
        type="button"
        onClick={() => onApply?.(result)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
      >
        <Check className="size-4" />
        Apply Decomposition
      </button>
    </div>
  );
}

function SubtaskItem({
  subtask,
  isLast,
}: {
  subtask: SubtaskSuggestion;
  isLast: boolean;
}) {
  return (
    <li className="relative">
      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm">
        {/* Order number */}
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
          {subtask.order}
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{subtask.title}</p>
          {subtask.description ? (
            <p className="text-xs text-muted-foreground">
              {subtask.description}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="size-2.5" />
              {subtask.estimatedMinutes}m
            </span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0 text-[10px] font-medium",
                priorityTone(subtask.priority),
              )}
            >
              {subtask.priority}
            </span>
          </div>
        </div>
      </div>

      {/* Sequential dependency arrow */}
      {!isLast && subtask.dependsOnPrevious ? (
        <div className="flex justify-center py-0.5">
          <ChevronDown className="size-3 text-primary/50" />
        </div>
      ) : !isLast ? (
        <div className="h-1" />
      ) : null}
    </li>
  );
}
