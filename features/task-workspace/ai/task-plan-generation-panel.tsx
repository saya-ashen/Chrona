"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskConfigFormDraft } from "@features/task-workspace/public/task-config-draft";
import {
  compiledPlanToGraphPlan,
  summarizeCompiledPlan,
  taskPlanReadModelToGraphPlan,
} from "../plan/task-plan-view-model";
import type { TaskPlanReadModel } from "@chrona/contracts"
import { TaskPlanEmptyState } from "./task-plan-empty-state";
import { TaskPlanGenerationProgress } from "./task-plan-generation-progress";
import { TaskPlanResultPanel } from "./task-plan-result-panel";
import { TaskPlanSaveBeforeRegenerateDialog } from "./task-plan-save-before-regenerate-dialog";
import { useI18n } from "@chrona/i18n"
import { useTaskPlanGeneration } from "../hooks/use-task-plan-generation";

interface TaskPlanGenerationPanelProps {
  taskId?: string;
  workBlockId?: string | null;
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
  showGraph?: boolean;
  requestGenerationKey?: number;
  userInstruction?: string | null;
  showEmptyGenerateButton?: boolean;
  emptyStateDescription?: string;
  showRegenerateButton?: boolean;
  renderIdleEmptyState?: boolean;
}

const DEFAULT_DECOMP_COPY = {
  aiTaskPlanning: "AI Task Planning",
  aiPlanning: "AI is planning task...",
  applyPlan: "Apply Plan",
};

const DEFAULT_PROGRESS_COPY = {
  accessibleTitle: "AI Task Planning",
  connectingMessage: "Connecting to AI and preparing the plan...",
  savingMessage: "Organizing and saving the plan...",
  generatedMessage: "Plan generated. Updating the view...",
  toolCallPrefix: "Using tool: ",
  toolPlanGenerate: "generating plan structure",
  toolSkillView: "reading planning skill",
  usingToolPrefix: "Using ",
  draftReturned: "AI returned a plan draft",
  decomposingSteps: "AI is decomposing task steps",
  prepareLabel: "Prepare task context",
  prepareDetail: "Reading task information and plan constraints",
  generateLabel: "Generate work plan",
  saveLabel: "Organize results",
  saveDetail: "Saving the plan and preparing display",
  finishLabel: "Finish display",
  finishDetail: "Updating the frontend plan view",
  stop: "Stop",
  stopping: "Stopping...",
  completedSteps: "Completed background steps",
  completed: "Completed",
};

function toProgressPhase(
  phase: ReturnType<typeof useTaskPlanGeneration>["phase"],
): "idle" | "connecting" | "thinking" | "streaming" | "done" | "error" {
  switch (phase) {
    case "starting":
    case "loading_task":
    case "requesting_provider":
      return "connecting";
    case "streaming":
      return "streaming";
    case "extracting_tool_payload":
    case "compiling":
    case "saving":
    case "completed":
      return "thinking";
    case "done":
      return "done";
    case "error":
      return "error";
    case "idle":
    case "connecting":
    default:
      return phase;
  }
}

function getDecompCopy(messages: Record<string, unknown>) {
  const raw =
    (messages.components as Record<string, Record<string, string>> | undefined)
      ?.taskDecompositionPanel ?? {};
  return { ...DEFAULT_DECOMP_COPY, ...raw };
}

function getProgressCopy(messages: Record<string, unknown>) {
  const raw =
    (messages.components as Record<string, Record<string, string>> | undefined)
      ?.taskPlanGenerationProgress ?? {};
  return { ...DEFAULT_PROGRESS_COPY, ...raw };
}

export function TaskPlanGenerationPanel({
  taskId,
  workBlockId = null,
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
  showGraph = true,
  requestGenerationKey,
  userInstruction = null,
  showEmptyGenerateButton = true,
  emptyStateDescription,
  showRegenerateButton = true,
  renderIdleEmptyState = true,
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
  const progressCopy = getProgressCopy(messages as Record<string, unknown>);
  const viewModelCopy = (messages as { components?: { taskPlanViewModel?: Record<string, string> } })
    .components?.taskPlanViewModel;
  const {
    result,
    isLoading,
    error,
    phase,
    statusMessage,
    requestGeneration,
    stopGeneration,
  } = useTaskPlanGeneration({
    taskId,
    workBlockId,
    autoRequest,
    forceRefresh: Boolean(forceRefresh),
    onPlanLoaded,
  });

  const activeReadModel = savedPlan?.status === "accepted"
    ? savedPlan
    : result ?? savedPlan ?? null;
  const compiledPlan = activeReadModel?.compiledPlan ?? null;

  const planGraph = useMemo(() => {
    return activeReadModel
      ? taskPlanReadModelToGraphPlan(activeReadModel, viewModelCopy)
      : compiledPlanToGraphPlan(compiledPlan, viewModelCopy);
  }, [activeReadModel, compiledPlan, viewModelCopy]);

  const graphSummary = useMemo(
    () => summarizeCompiledPlan(compiledPlan),
    [compiledPlan],
  );
  const isAppliedPlan = Boolean(
    activeAcceptedPlanId &&
      activeReadModel?.id &&
      activeReadModel.id === activeAcceptedPlanId,
  );

  const requestFreshPlan = useCallback((_draft?: TaskConfigFormDraft | null) => {
    setHasRequestedStop(false);
    requestGeneration({ forceRefresh: true, userInstruction });
  }, [requestGeneration, userInstruction]);

  const handleRegenerate = useCallback(() => {
    if (hasUnsavedConfigChanges) {
      setShowSaveBeforeRegenerate(true);
      return;
    }

    requestFreshPlan();
  }, [hasUnsavedConfigChanges, requestFreshPlan]);

  useEffect(() => {
    if (!requestGenerationKey) {
      return;
    }

    handleRegenerate();
  }, [handleRegenerate, requestGenerationKey]);

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
    try {
      await stopGeneration();
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
  const progressPhase = toProgressPhase(phase);

  if (isGenerationRunning) {
    return (
      <TaskPlanGenerationProgress
        phase={progressPhase}
        statusMessage={statusMessage}
        partialText=""
        toolCalls={[]}
        toolResults={[]}
        taskId={taskId}
        isStoppingGeneration={isStoppingGeneration}
        stopGenerationError={stopGenerationError}
        planningLabel={decompCopy.aiPlanning}
        copy={progressCopy}
        onStop={() => void handleStopGeneration()}
      />
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
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
    if (!renderIdleEmptyState) {
      return saveBeforeRegenerateDialog;
    }

    return (
      <div className="space-y-3">
        {saveBeforeRegenerateDialog}
        <TaskPlanEmptyState
          onGenerate={handleRegenerate}
          showGenerateButton={showEmptyGenerateButton}
          description={emptyStateDescription}
        />
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
        showGraph={showGraph}
        showRegenerateButton={showRegenerateButton}
      />
    </div>
  );
}
