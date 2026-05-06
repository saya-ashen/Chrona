"use client";

import { useMemo, useState } from "react";
import type { TaskConfigFormDraft } from "@/components/schedule/task-config-form";
import {
  compiledPlanToGraphPlan,
  summarizeCompiledPlan,
} from "@/components/task/plan/task-plan-view-model";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";

import { TaskPlanEmptyState } from "@/components/task/ai/task-plan-empty-state";
import { TaskPlanGenerationProgress } from "@/components/task/ai/task-plan-generation-progress";
import { TaskPlanResultPanel } from "@/components/task/ai/task-plan-result-panel";
import { TaskPlanSaveBeforeRegenerateDialog } from "@/components/task/ai/task-plan-save-before-regenerate-dialog";
import { useI18n } from "@/i18n/client";
import { useTaskPlanGeneration } from "@/hooks/ai/use-task-plan-generation";

interface TaskPlanGenerationPanelProps {
  taskId?: string;
  title: string;
  description?: string | null;
  priority: string;
  dueAt?: Date | null;
  estimatedMinutes?: number;
  autoRequest?: boolean;
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

export function TaskPlanGenerationPanel({
  taskId,
  title: _title,
  description: _description,
  priority: _priority,
  dueAt: _dueAt,
  estimatedMinutes: _estimatedMinutes,
  autoRequest = false,
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
  const [showSaveBeforeRegenerate, setShowSaveBeforeRegenerate] =
    useState(false);
  const [isSavingBeforeRegenerate, setIsSavingBeforeRegenerate] =
    useState(false);
  const [isStoppingGeneration, setIsStoppingGeneration] = useState(false);
  const [hasRequestedStop, setHasRequestedStop] = useState(false);
  const [stopGenerationError, setStopGenerationError] = useState<string | null>(
    null,
  );
  const { messages } = useI18n();
  const decompCopy = getDecompCopy(messages as Record<string, unknown>);
  const {
    result,
    isLoading,
    error,
    phase,
    statusMessage,
    partialText,
    toolCalls,
    toolResults,
    requestGeneration,
    stopGeneration,
  } = useTaskPlanGeneration({
    taskId,
    autoRequest,
    forceRefresh: Boolean(forceRefresh),
    onPlanLoaded,
  });

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

  const requestFreshPlan = (_draft?: TaskConfigFormDraft | null) => {
    setHasRequestedStop(false);
    requestGeneration(true);
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
    setHasRequestedStop(true);
    setStopGenerationError(null);
    stopGeneration();
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
      setHasRequestedStop(false);
      setStopGenerationError(
        stopError instanceof Error
          ? stopError.message
          : "Failed to stop generation",
      );
    } finally {
      setIsStoppingGeneration(false);
    }
  };
  const isGenerationRunning =
    !hasRequestedStop && (isLoading || generationStatus === "generating");

  if (isGenerationRunning) {
    return (
      <TaskPlanGenerationProgress
        phase={phase}
        statusMessage={statusMessage}
        partialText={partialText}
        toolCalls={toolCalls}
        toolResults={toolResults}
        taskId={taskId}
        isStoppingGeneration={isStoppingGeneration}
        stopGenerationError={stopGenerationError}
        planningLabel={decompCopy.aiPlanning}
        onStop={() => void handleStopGeneration()}
      />
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
    <TaskPlanSaveBeforeRegenerateDialog
      isSaving={isSavingBeforeRegenerate}
      onCancel={() => setShowSaveBeforeRegenerate(false)}
      onConfirm={() => void handleSaveAndRegenerate()}
    />
  ) : null;

  if (!activeReadModel || !planGraph) {
    return (
      <div className="space-y-3">
        {saveBeforeRegenerateDialog}
        <TaskPlanEmptyState onGenerate={handleRegenerate} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {saveBeforeRegenerateDialog}
      <TaskPlanResultPanel
        activeReadModel={activeReadModel}
        planGraph={planGraph}
        graphSummary={graphSummary}
        isAppliedPlan={isAppliedPlan}
        onRegenerate={handleRegenerate}
        onApply={onApply}
      />
    </div>
  );
}
