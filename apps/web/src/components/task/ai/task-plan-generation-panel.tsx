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
import { TaskPlanGraph } from "@/components/task/plan/task-plan-graph";
import {
  compiledPlanToGraphPlan,
  summarizeCompiledPlan,
} from "@/components/task/plan/task-plan-view-model";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

import { useI18n } from "@/i18n/client";
import { buttonVariants } from "@/components/ui/button";
import type { StreamPhase, StreamToolCall, StreamToolResult } from "@/hooks/ai/types";

interface TaskPlanGenerationPanelProps {
  taskId?: string;
  title: string;
  description?: string | null;
  priority: string;
  dueAt?: Date | null;
  estimatedMinutes?: number;
  autoRequest?: boolean;
  planningPrompt?: string;
  forceRefresh?: boolean;
  savedPlan?: TaskPlanReadModel | null;
  generationStatus?: "idle" | "generating" | "waiting_acceptance" | "accepted";
  onApply?: (result: TaskPlanReadModel) => Promise<void> | void;
  onPlanLoaded?: (savedPlan: TaskPlanReadModel | null) => void;
  activeAcceptedPlanId?: string | null;
  hasUnsavedConfigChanges?: boolean;
  unsavedConfigDraft?: TaskConfigFormDraft | null;
  onSaveConfigBeforeRegenerate?: () => Promise<void> | void;
}

const DEFAULT_DECOMP_COPY = {
  aiTaskPlanning: "AI Task Planning",
  aiPlanning: "AI is planning task...",
  applyPlan: "Apply Plan",
};

function getDecompCopy(messages: Record<string, unknown>) {
  const raw =
    (messages.components as Record<string, Record<string, string>> | undefined)
      ?.taskDecompositionPanel ?? {};
  return { ...DEFAULT_DECOMP_COPY, ...raw };
}

type ActivePlanRequest = {
  taskId: string;
  forceRefresh: boolean;
  requestKey: number;
};

export function TaskPlanGenerationPanel({
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
}: TaskPlanGenerationPanelProps) {
  const [requested, setRequested] = useState(autoRequest);
  const [requestKey, setRequestKey] = useState(0);
  const [showSaveBeforeRegenerate, setShowSaveBeforeRegenerate] =
    useState(false);
  const [isSavingBeforeRegenerate, setIsSavingBeforeRegenerate] =
    useState(false);
  const [isStoppingGeneration, setIsStoppingGeneration] = useState(false);
  const [stopGenerationError, setStopGenerationError] = useState<string | null>(
    null,
  );
  const [localForceRefresh, setLocalForceRefresh] = useState(
    Boolean(forceRefresh),
  );
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
    description: draft ? draft.description : (description ?? undefined),
    priority: draft?.priority ?? priority,
    dueAt: draft ? draft.dueAt : dueAt,
    estimatedMinutes,
    planningPrompt,
  });

  const planInput = useMemo<ActivePlanRequest | null>(() => {
    if (!requested || !requestSnapshot.taskId) {
      return null;
    }

    return {
      taskId: requestSnapshot.taskId,
      forceRefresh: localForceRefresh,
      requestKey,
    };
  }, [localForceRefresh, requestKey, requestSnapshot.taskId, requested]);

  const [result, setResult] = useState<TaskPlanReadModel | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [partialText, setPartialText] = useState("");
  const [toolCalls, setToolCalls] = useState<StreamToolCall[]>([]);
  const [toolResults, setToolResults] = useState<StreamToolResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!planInput?.taskId) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setResult(null);
      setIsLoading(false);
      setError(null);
      setPhase("idle");
      setStatusMessage(null);
      setPartialText("");
      setToolCalls([]);
      setToolResults([]);
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const requestId = ++requestSeqRef.current;
    const isActive = () => requestId === requestSeqRef.current && !controller.signal.aborted;

    setResult(null);
    setIsLoading(true);
    setError(null);
    setPhase("connecting");
    setStatusMessage(null);
    setPartialText("");
    setToolCalls([]);
    setToolResults([]);

    const readStream = async (activeRequest: ActivePlanRequest) => {
      try {
        const response = await fetch(`/api/tasks/${activeRequest.taskId}/plan/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            forceRefresh: activeRequest.forceRefresh,
            planningPrompt: requestSnapshot.planningPrompt ?? null,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error((errorBody as { error?: string }).error ?? `Request failed (${response.status})`);
        }

        if (!response.body) {
          throw new Error("Plan generation stream did not return a readable body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventType = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || !isActive()) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
              continue;
            }

            if (!line.startsWith("data: ")) {
              continue;
            }

            const raw = line.slice(6).trim();
            const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
            if (!isActive()) return;

            switch (eventType) {
              case "status":
                setPhase("thinking");
                setStatusMessage(typeof data.message === "string" ? data.message : null);
                break;
              case "tool_call":
                setPhase("thinking");
                setToolCalls((current) => [...current, {
                  tool: typeof data.tool === "string" ? data.tool : "unknown",
                  input: (data.input as Record<string, unknown> | undefined) ?? {},
                }]);
                break;
              case "tool_result":
                setToolResults((current) => [...current, {
                  tool: typeof data.tool === "string" ? data.tool : "unknown",
                  result: typeof data.result === "string" ? data.result : JSON.stringify(data.result ?? ""),
                }]);
                break;
              case "partial":
                setPhase("streaming");
                setPartialText((current) => current + (typeof data.text === "string" ? data.text : ""));
                break;
              case "result":
                setResult((data.result as TaskPlanReadModel | undefined) ?? null);
                setPhase("done");
                setIsLoading(false);
                break;
              case "error":
                setError(typeof data.message === "string" ? data.message : "Failed to generate task plan");
                setPhase("error");
                setIsLoading(false);
                break;
            }

            eventType = "";
          }
        }

        if (isActive()) {
          setIsLoading(false);
          setPhase((current) => current === "error" ? current : "done");
        }
      } catch (streamError) {
        if (streamError instanceof DOMException && streamError.name === "AbortError") {
          return;
        }
        if (isActive()) {
          setError(streamError instanceof Error ? streamError.message : "Failed to generate task plan");
          setPhase("error");
          setIsLoading(false);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    };

    void readStream(planInput);

    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [planInput, requestSnapshot.planningPrompt]);

  const activeReadModel = result ?? savedPlan ?? null;
  const compiledPlan = activeReadModel?.compiledPlan ?? null;

  const planGraph = useMemo(() => {
    return compiledPlanToGraphPlan(compiledPlan);
  }, [compiledPlan]);

  const graphSummary = useMemo(
    () => summarizeCompiledPlan(compiledPlan),
    [compiledPlan],
  );
  const isAppliedPlan = Boolean(
    activeAcceptedPlanId &&
      activeReadModel?.id &&
      activeReadModel.id === activeAcceptedPlanId,
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
      const response = await fetch(`/api/tasks/${taskId}/plan/generate/stop`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
          (errorBody as { error?: string }).error ??
            `Failed to stop generation (${response.status})`,
        );
      }
    } catch (stopError) {
      setStopGenerationError(
        stopError instanceof Error
          ? stopError.message
          : "Failed to stop generation",
      );
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
    if (!result) {
      return;
    }

    onPlanLoaded?.(result);
  }, [onPlanLoaded, result]);

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
          <span className="font-medium">
            {statusMessage ?? decompCopy.aiPlanning}
          </span>
        </div>
        {stopGenerationError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {stopGenerationError}
          </div>
        ) : null}
        {phase !== "thinking" ||
        statusMessage ||
        partialText ||
        toolCalls.length ||
        toolResults.length ? (
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
                  <div
                    key={`${call.tool}-${index}`}
                    className="text-muted-foreground"
                  >
                    {call.tool}
                  </div>
                ))}
              </div>
            ) : null}
            {toolResults.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-border/40 bg-background/70 px-3 py-2">
                <p className="font-medium text-foreground">Tool results</p>
                {toolResults.map((toolResult, index) => (
                  <div
                    key={`${toolResult.tool}-${index}`}
                    className="text-muted-foreground"
                  >
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
        You have unsaved task configuration changes. Save them and use the new
        configuration to regenerate the plan.
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

  if (!activeReadModel || !planGraph) {
    return (
      <div className="space-y-3 rounded-xl border border-transparent bg-transparent p-0">
        {renderPanelHeader(
          <button
            type="button"
            onClick={handleRegenerate}
            className={buttonVariants({
              variant: "soft",
              size: "sm",
              className: "rounded-full",
            })}
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
          <span className="font-medium text-foreground">
            {graphSummary.totalEstimatedMinutes} min
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background/70 px-3 py-2 shadow-sm">
          <span className="flex size-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Scissors className="size-3.5" />
          </span>
          <span className="font-medium text-foreground">
            {graphSummary.nodeCount} nodes
          </span>
        </div>
      </div>

      {graphSummary.warnings.length > 0 ? (
        <div className="space-y-1">
          {graphSummary.warnings.map((warning, index) => (
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
                onClick={() => activeReadModel && onApply(activeReadModel)}
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
