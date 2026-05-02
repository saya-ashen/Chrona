"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TaskConfigFormDraft } from "@/components/schedule/task-config-form";
import {
  Scissors,
  Clock,
  AlertTriangle,
  Check,
  CheckCircle2,
  Bot,
  Sparkles,
  RotateCcw,
  Square,
} from "lucide-react";
import { TaskPlanGraph } from "@/components/work/task-plan-graph";
import type { TaskPlanGraph as TaskPlanGraphData, TaskPlanGraphResponse } from "@/modules/ai/types";
import { useSmartDecomposition } from "@/hooks/use-ai";

import { useI18n } from "@/i18n/client";

interface TaskDecompositionPanelProps {
  taskId?: string;
  title: string;
  description?: string | null;
  priority: string;
  dueAt?: Date | null;
  estimatedMinutes?: number;
  autoRequest?: boolean;
  planningPrompt?: string;
  forceRefresh?: boolean;
  savedPlan?: {
    id: string;
    status: "draft" | "accepted" | "superseded" | "archived";
    prompt: string | null;
    revision?: number;
    summary?: string | null;
    updatedAt: string;
    plan?: TaskPlanGraphData;
  } | null;
  generationStatus?: "idle" | "generating" | "waiting_acceptance" | "accepted";
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
  activeAcceptedPlanId?: string | null;
  hasUnsavedConfigChanges?: boolean;
  unsavedConfigDraft?: TaskConfigFormDraft | null;
  onSaveConfigBeforeRegenerate?: () => Promise<void> | void;
}

function summarizePlanGraph(graph: TaskPlanGraphData | null) {
  if (!graph) {
    return {
      totalEstimatedMinutes: 0,
      nodeCount: 0,
      warnings: [] as string[],
    };
  }

  const totalEstimatedMinutes = graph.nodes.reduce((sum, node) => sum + (node.estimatedMinutes ?? 0), 0);
  const firstWarnings = graph.nodes.find((node) => Array.isArray(node.metadata?.warnings))?.metadata?.warnings;
  const warnings = Array.isArray(firstWarnings)
    ? firstWarnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return {
    totalEstimatedMinutes,
    nodeCount: graph.nodes.length,
    warnings,
  };
}

const DEFAULT_DECOMP_COPY = {
  aiTaskPlanning: "AI Task Planning",
  aiPlanning: "AI is planning task...",
  applyPlan: "Apply Plan",
};

function getDecompCopy(messages: Record<string, unknown>) {
  const raw = (messages.components as Record<string, Record<string, string>> | undefined)?.taskDecompositionPanel ?? {};
  return { ...DEFAULT_DECOMP_COPY, ...raw };
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
  savedPlan = null,
  generationStatus = "idle",
  onApply,
  onPlanLoaded,
  activeAcceptedPlanId = null,
  hasUnsavedConfigChanges = false,
  unsavedConfigDraft = null,
  onSaveConfigBeforeRegenerate,
}: TaskDecompositionPanelProps) {
  const [requested, setRequested] = useState(autoRequest);
  const [requestKey, setRequestKey] = useState(0);
  const [showSaveBeforeRegenerate, setShowSaveBeforeRegenerate] = useState(false);
  const [isSavingBeforeRegenerate, setIsSavingBeforeRegenerate] = useState(false);
  const [isStoppingGeneration, setIsStoppingGeneration] = useState(false);
  const [stopGenerationError, setStopGenerationError] = useState<string | null>(null);
  const [localForceRefresh, setLocalForceRefresh] = useState(Boolean(forceRefresh));
  const [requestSnapshot, setRequestSnapshot] = useState(() => ({
    taskId,
    title,
    description: description ?? undefined,
    priority,
    dueAt,
    estimatedMinutes,
    planningPrompt,
  }));
  const hasInitializedAutoRequestRef = useRef(autoRequest);
  const { messages } = useI18n();
  const decompCopy = getDecompCopy(messages as Record<string, unknown>);

  const latestRequestSnapshot = (draft?: TaskConfigFormDraft | null) => ({
    taskId,
    title: draft?.title ?? title,
    description: draft ? draft.description : description ?? undefined,
    priority: draft?.priority ?? priority,
    dueAt: draft ? draft.dueAt : dueAt,
    estimatedMinutes,
    planningPrompt,
  });

  const planInput = requested
    ? {
        ...requestSnapshot,
        forceRefresh: localForceRefresh,
        requestKey,
      }
    : null;

  const {
    result,
    isLoading,
    error,
    phase,
    statusMessage,
    partialText,
    toolCalls,
    toolResults,
  } = useSmartDecomposition(planInput);

  const hookSavedPlanMeta = useMemo(() => {
    if (!result?.savedPlan) {
      return null;
    }

    return {
      ...result.savedPlan,
      plan: result.planGraph,
    };
  }, [result]);
  const savedPlanMeta = hookSavedPlanMeta ?? savedPlan;
  const displayPlanGraph = result?.planGraph ?? savedPlanMeta?.plan ?? null;
  const displayResult = result ?? (savedPlanMeta?.plan
    ? {
        source: "saved",
        planGraph: savedPlanMeta.plan,
        savedPlan: {
          id: savedPlanMeta.id,
          status: savedPlanMeta.status,
          prompt: savedPlanMeta.prompt,
          revision: savedPlanMeta.revision ?? 0,
          summary: savedPlanMeta.summary ?? null,
          updatedAt: savedPlanMeta.updatedAt,
        },
      }
    : null);

  const planGraph = useMemo(() => {
    const graph = displayPlanGraph;
    if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
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
        requiresHumanInput: node.requiresHumanInput || node.status === "waiting_for_user",
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
  }, [displayPlanGraph]);

  const graphSummary = useMemo(() => summarizePlanGraph(displayPlanGraph ?? null), [displayPlanGraph]);
  const isAppliedPlan = Boolean(
    activeAcceptedPlanId
      && savedPlanMeta?.id
      && savedPlanMeta.id === activeAcceptedPlanId,
  );

  const requestFreshPlan = (draft?: TaskConfigFormDraft | null) => {
    setRequestSnapshot(latestRequestSnapshot(draft));
    setRequested(true);
    setLocalForceRefresh(true);
    setRequestKey((current) => current + 1);
  };

  const handleRegenerate = () => {
    if (hasUnsavedConfigChanges) {
      setShowSaveBeforeRegenerate(true);
      return;
    }

    requestFreshPlan();
  };

  const handleSaveAndRegenerate = async () => {
    setIsSavingBeforeRegenerate(true);
    try {
      await onSaveConfigBeforeRegenerate?.();
      setShowSaveBeforeRegenerate(false);
      requestFreshPlan(unsavedConfigDraft);
    } finally {
      setIsSavingBeforeRegenerate(false);
    }
  };

  const handleStopGeneration = async () => {
    if (!taskId || isStoppingGeneration) {
      return;
    }

    setIsStoppingGeneration(true);
    setStopGenerationError(null);
    try {
      const response = await fetch("/api/ai/generate-task-plan/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
          (errorBody as { error?: string }).error ?? `Failed to stop generation (${response.status})`,
        );
      }
    } catch (stopError) {
      setStopGenerationError(stopError instanceof Error ? stopError.message : "Failed to stop generation");
    } finally {
      setIsStoppingGeneration(false);
    }
  };

  useEffect(() => {
    setLocalForceRefresh(Boolean(forceRefresh));
  }, [forceRefresh]);

  useEffect(() => {
    if (!autoRequest || hasInitializedAutoRequestRef.current) {
      return;
    }

    hasInitializedAutoRequestRef.current = true;
    setRequested(true);
    setRequestSnapshot(latestRequestSnapshot());
  }, [autoRequest]);

  useEffect(() => {
    if (!hookSavedPlanMeta) {
      return;
    }

    onPlanLoaded?.(hookSavedPlanMeta);
  }, [onPlanLoaded, hookSavedPlanMeta]);

  const isGenerationRunning = isLoading || generationStatus === "generating";

  const renderPanelHeader = (action?: ReactNode) => (
    <div className="flex items-center justify-end gap-3">
      <span className="sr-only">{decompCopy.aiTaskPlanning}</span>
      {action}
    </div>
  );

  if (isGenerationRunning) {
    return (
      <div className="rounded-xl border border-transparent bg-transparent p-0">
        {renderPanelHeader(
          taskId ? (
            <button
              type="button"
              onClick={() => void handleStopGeneration()}
              disabled={isStoppingGeneration}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background/80 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:opacity-60"
            >
              <Square className="size-3" />
              {isStoppingGeneration ? "Stopping..." : "Stop"}
            </button>
          ) : null,
        )}
        <div className="mt-3 flex items-center gap-2 text-sm text-primary">
          <Bot className="size-4 animate-pulse" />
          <span className="font-medium">{statusMessage ?? decompCopy.aiPlanning}</span>
        </div>
        {stopGenerationError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {stopGenerationError}
          </div>
        ) : null}
        {phase !== "thinking" || statusMessage || partialText || toolCalls.length || toolResults.length ? (
          <div className="mt-3 space-y-3 text-xs text-primary/90">
            {statusMessage ? (
              <div className="rounded-lg border border-primary/20 bg-background/70 px-3 py-2">
                {statusMessage}
              </div>
            ) : null}
            {partialText ? (
              <div className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-muted-foreground">
                {partialText}
              </div>
            ) : null}
            {toolCalls.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-border/40 bg-background/70 px-3 py-2">
                <p className="font-medium text-foreground">Tools in progress</p>
                {toolCalls.map((call, index) => (
                  <div key={`${call.tool}-${index}`} className="text-muted-foreground">
                    {call.tool}
                  </div>
                ))}
              </div>
            ) : null}
            {toolResults.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-border/40 bg-background/70 px-3 py-2">
                <p className="font-medium text-foreground">Tool results</p>
                {toolResults.map((toolResult, index) => (
                  <div key={`${toolResult.tool}-${index}`} className="text-muted-foreground">
                    {toolResult.tool}: {toolResult.result}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="h-3 animate-pulse rounded bg-primary/10" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-primary/10" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-primary/10" />
          </div>
        )}
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

  const saveBeforeRegenerateDialog = showSaveBeforeRegenerate ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save changes before regenerating"
      className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p className="font-medium">Save changes before regenerating?</p>
      <p className="mt-1 text-xs text-amber-800">
        You have unsaved task configuration changes. Save them and use the new configuration to regenerate the plan.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowSaveBeforeRegenerate(false)}
          disabled={isSavingBeforeRegenerate}
          className="rounded-lg border border-amber-300 bg-background px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSaveAndRegenerate()}
          disabled={isSavingBeforeRegenerate}
          className="rounded-lg border border-amber-500 bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {isSavingBeforeRegenerate ? "Saving..." : "Save and regenerate"}
        </button>
      </div>
    </div>
  ) : null;

  if (!displayResult || !planGraph) {
    return (
      <div className="space-y-3 rounded-xl border border-transparent bg-transparent p-0">
        {renderPanelHeader(
          <button
            type="button"
            onClick={handleRegenerate}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background/80 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
          >
            <Sparkles className="size-3.5" />
            Generate plan
          </button>,
        )}
        {saveBeforeRegenerateDialog}
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_42%),hsl(var(--background)/0.78)] px-3 py-3 text-sm text-muted-foreground">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-border/60">
            <Sparkles className="size-4" />
          </span>
          <span className="font-medium text-foreground">No plan yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-transparent bg-transparent p-0">
      {renderPanelHeader(
        <button
          type="button"
          onClick={handleRegenerate}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background/80 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/10"
        >
          <RotateCcw className="size-3.5" />
          Regenerate plan
        </button>,
      )}

      {saveBeforeRegenerateDialog}

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background/70 px-3 py-2 shadow-sm">
          <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock className="size-3.5" />
          </span>
          <span className="font-medium text-foreground">{graphSummary.totalEstimatedMinutes} min</span>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background/70 px-3 py-2 shadow-sm">
          <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Scissors className="size-3.5" />
          </span>
          <span className="font-medium text-foreground">{graphSummary.nodeCount} nodes</span>
        </div>
      </div>

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

      {isAppliedPlan ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
            <CheckCircle2 className="size-4" />
          </span>
          <span>Active in main panel</span>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border/40 bg-background/60 p-3">
            <TaskPlanGraph plan={planGraph} />
          </div>

          {onApply ? (
            <div className="flex justify-end rounded-lg border border-border/40 bg-background/70 px-3 py-2">
              <button
                type="button"
                onClick={() => displayResult && onApply(displayResult)}
                className="flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/20"
              >
                <Check className="size-4" />
                Apply Plan
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

