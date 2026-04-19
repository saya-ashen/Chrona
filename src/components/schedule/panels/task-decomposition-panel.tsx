"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Scissors,
  Clock,
  AlertTriangle,
  Check,
  Bot,
  Sparkles,
  CalendarClock,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";
import type { TaskPlanGraph as TaskPlanGraphData, TaskPlanGraphResponse } from "@/modules/ai/types";
import { useSmartAutomation, useSmartDecomposition } from "@/hooks/use-ai";

export interface TaskDecompositionPanelProps {
  taskId?: string;
  title: string;
  description?: string | null;
  priority: string;
  dueAt?: Date | null;
  estimatedMinutes?: number;
  autoRequest?: boolean;
  planningPrompt?: string;
  forceRefresh?: boolean;
  onApply?: (result: TaskPlanGraphResponse) => Promise<void> | void;
  onPlanLoaded?: (savedPlan: {
    id: string;
    status: "draft" | "accepted" | "superseded" | "archived";
    prompt: string | null;
    revision?: number;
    summary?: string | null;
    updatedAt: string;
    plan?: TaskPlanGraphData;
  } | null) => void;
}

const feasibilityColor = (score: number): string => {
  if (score >= 70) return "text-green-700 bg-green-100";
  if (score >= 40) return "text-amber-700 bg-amber-100";
  return "text-muted-foreground bg-muted";
};

function summarizePlanGraph(graph: TaskPlanGraphData | null) {
  if (!graph) {
    return {
      totalEstimatedMinutes: 0,
      nodeCount: 0,
      feasibilityScore: 0,
      warnings: [] as string[],
    };
  }

  const totalEstimatedMinutes = graph.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0);
  const firstWarnings = graph.nodes.find((node) => Array.isArray(node.metadata?.warnings))?.metadata?.warnings;
  const warnings = Array.isArray(firstWarnings)
    ? firstWarnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const feasibilityScore = graph.nodes.find((node) => typeof node.metadata?.feasibilityScore === "number")?.metadata?.feasibilityScore;

  return {
    totalEstimatedMinutes,
    nodeCount: graph.nodes.length,
    feasibilityScore: typeof feasibilityScore === "number" ? feasibilityScore : 0,
    warnings,
  };
}

export function TaskDecompositionPanel({
  taskId,
  title,
  description,
  priority,
  dueAt,
  estimatedMinutes,
  autoRequest = false,
  planningPrompt,
  forceRefresh,
  onApply,
  onPlanLoaded,
}: TaskDecompositionPanelProps) {
  const [requested, setRequested] = useState(autoRequest);

  const decompositionInput = requested
    ? {
        taskId,
        title,
        description: description ?? undefined,
        priority,
        dueAt,
        estimatedMinutes,
        planningPrompt,
        forceRefresh,
      }
    : null;

  const automationInput = requested
    ? {
        title,
        description: description ?? undefined,
        priority,
        dueAt,
        scheduledStartAt: null,
        scheduledEndAt: null,
        isRunnable: false,
        runnabilityState: "not_configured",
        ownerType: "human",
      }
    : null;

  const { result, isLoading, error } = useSmartDecomposition(decompositionInput);
  const { suggestion } = useSmartAutomation(automationInput);

  const savedPlanMeta = useMemo(() => {
    if (!result?.savedPlan) {
      return null;
    }

    return {
      ...result.savedPlan,
      plan: result.planGraph,
    };
  }, [result]);

  const planGraph = useMemo(() => {
    const graph = result?.planGraph;
    if (!graph || !Array.isArray(graph.nodes)) {
      return null;
    }

    return {
      state: "ready" as const,
      revision: typeof graph.revision === "number" ? `r${graph.revision}` : null,
      generatedBy: graph.generatedBy,
      isMock: false,
      summary: graph.summary,
      updatedAt: graph.updatedAt,
      changeSummary: graph.changeSummary,
      currentStepId:
        graph.nodes.find((node) => ["in_progress", "waiting_for_user", "blocked"].includes(node.status))?.id ?? null,
      steps: graph.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        objective: node.objective,
        phase: node.phase ?? node.type,
        status: node.status === "skipped" ? "done" : node.status,
        needsUserInput: node.needsUserInput || node.status === "waiting_for_user",
        type: node.type,
        linkedTaskId: node.linkedTaskId,
        executionMode: node.executionMode,
        estimatedMinutes: node.estimatedMinutes,
        priority: node.priority,
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        type: edge.type,
      })),
    };
  }, [result]);

  const graphSummary = useMemo(() => summarizePlanGraph(result?.planGraph ?? null), [result]);

  useEffect(() => {
    onPlanLoaded?.(savedPlanMeta);
  }, [onPlanLoaded, savedPlanMeta]);

  if (!requested) {
    return (
      <button
        type="button"
        onClick={() => setRequested(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border/60 bg-background/50 px-4 py-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
      >
        <Scissors className="size-4" />
        <span>AI 任务规划</span>
        <Sparkles className="ml-auto size-3" />
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm text-primary">
          <Bot className="size-4 animate-pulse" />
          <span className="font-medium">AI 正在规划任务...</span>
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
        <p>Failed to plan task: {error}</p>
      </div>
    );
  }

  if (!result || !planGraph) return null;

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Scissors className="size-4" />
          AI Task Plan
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            feasibilityColor(graphSummary.feasibilityScore),
          )}
        >
          {graphSummary.feasibilityScore}% feasible
        </span>
      </div>

      <div className="grid gap-2 rounded-lg border border-border/50 bg-background/70 p-3 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-primary" />
          <span>Total: {graphSummary.totalEstimatedMinutes} min</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Scissors className="size-3.5 text-primary" />
          <span>{graphSummary.nodeCount} planned nodes</span>
        </div>
        {suggestion ? (
          <div className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5 text-primary" />
            <span>{suggestion.executionMode} execution</span>
          </div>
        ) : null}
      </div>

      {suggestion ? (
        <div className="grid gap-2 rounded-lg border border-border/40 bg-background/60 p-3 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <div>
              <p className="font-medium text-foreground">Execution mode</p>
              <p>{suggestion.executionMode}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <div>
              <p className="font-medium text-foreground">Reminder</p>
              <p>
                {suggestion.reminderStrategy.advanceMinutes}m before · {suggestion.reminderStrategy.frequency}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {graphSummary.warnings.length > 0 ? (
        <div className="space-y-1">
          {graphSummary.warnings.map((warning, index) => (
            <div key={index} className="flex items-start gap-2 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border/40 bg-background/60 p-3">
        <TaskPlanGraph plan={planGraph} />
      </div>

      {onApply ? (
        <button
          type="button"
          onClick={() => onApply(result)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
        >
          <Check className="size-4" />
          Apply Plan
        </button>
      ) : null}
    </div>
  );
}
