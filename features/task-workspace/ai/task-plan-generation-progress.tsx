import { Bot, CheckCircle2, Circle, Loader2, Square } from "lucide-react";

import type { StreamPhase, StreamToolCall, StreamToolResult } from "../hooks/plan-generation-types";

type TaskPlanGenerationProgressProps = {
  phase: StreamPhase;
  statusMessage: string | null;
  partialText: string;
  toolCalls: StreamToolCall[];
  toolResults: StreamToolResult[];
  taskId?: string;
  isStoppingGeneration: boolean;
  stopGenerationError: string | null;
  planningLabel: string;
  copy?: Partial<TaskPlanGenerationProgressCopy>;
  onStop: () => void;
};

type TaskPlanGenerationProgressCopy = {
  accessibleTitle: string;
  connectingMessage: string;
  savingMessage: string;
  generatedMessage: string;
  toolCallPrefix: string;
  toolPlanGenerate: string;
  toolSkillView: string;
  usingToolPrefix: string;
  draftReturned: string;
  decomposingSteps: string;
  prepareLabel: string;
  prepareDetail: string;
  generateLabel: string;
  saveLabel: string;
  saveDetail: string;
  finishLabel: string;
  finishDetail: string;
  stop: string;
  stopping: string;
  completedSteps: string;
  completed: string;
};

const DEFAULT_PROGRESS_COPY: TaskPlanGenerationProgressCopy = {
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

type ProgressStepState = "done" | "active" | "pending";

type ProgressStep = {
  key: string;
  label: string;
  detail: string;
  state: ProgressStepState;
};

function normalizeStatusMessage(message: string | null, planningLabel: string, copy: TaskPlanGenerationProgressCopy) {
  if (!message) return planningLabel;
  if (message === "AI is generating suggestions...") return copy.connectingMessage;
  if (message === "Reading saved plan...") return copy.savingMessage;
  if (message === "Plan generated.") return copy.generatedMessage;
  if (message.startsWith("Tool call: ")) {
    return `${copy.toolCallPrefix}${message.slice("Tool call: ".length)}`;
  }
  return message;
}

function summarizeToolName(tool: string, copy: TaskPlanGenerationProgressCopy) {
  return tool === "skill_view" ? copy.toolSkillView : tool;
}

function getPrepareStepState(hasProviderActivity: boolean, isSaving: boolean, isDone: boolean) {
  return hasProviderActivity || isSaving || isDone ? "done" : "active";
}

function getGenerateStepState(hasProviderActivity: boolean, isSaving: boolean, isDone: boolean) {
  if (isSaving || isDone) return "done";
  return hasProviderActivity ? "active" : "pending";
}

function getGenerateStepDetail(toolCalls: StreamToolCall[], toolResults: StreamToolResult[], copy: TaskPlanGenerationProgressCopy) {
  const latestTool = toolCalls[toolCalls.length - 1]?.tool;
  if (latestTool) return `${copy.usingToolPrefix}${summarizeToolName(latestTool, copy)}`;
  if (toolResults.length > 0) return copy.draftReturned;
  return copy.decomposingSteps;
}

function hasProviderActivity(
  phase: StreamPhase,
  statusMessage: string | null,
  partialText: string,
  toolCalls: StreamToolCall[],
  toolResults: StreamToolResult[],
) {
  return phase === "streaming" ||
    Boolean(partialText) ||
    toolCalls.length > 0 ||
    toolResults.length > 0 ||
    statusMessage === "AI is generating suggestions...";
}

function buildProgressSteps({
  phase,
  statusMessage,
  partialText,
  toolCalls,
  toolResults,
  copy,
}: Pick<
  TaskPlanGenerationProgressProps,
  "phase" | "statusMessage" | "partialText" | "toolCalls" | "toolResults"
> & { copy: TaskPlanGenerationProgressCopy }): ProgressStep[] {
  const hasActivity = hasProviderActivity(phase, statusMessage, partialText, toolCalls, toolResults);
  const isSaving = statusMessage === "Reading saved plan..." || statusMessage === "Plan generated.";
  const isDone = phase === "done" || statusMessage === "Plan generated.";

  return [
    {
      key: "prepare",
      label: copy.prepareLabel,
      detail: copy.prepareDetail,
      state: getPrepareStepState(hasActivity, isSaving, isDone),
    },
    {
      key: "generate",
      label: copy.generateLabel,
      detail: getGenerateStepDetail(toolCalls, toolResults, copy),
      state: getGenerateStepState(hasActivity, isSaving, isDone),
    },
    {
      key: "save",
      label: copy.saveLabel,
      detail: copy.saveDetail,
      state: isDone ? "done" : isSaving || toolResults.length > 0 ? "active" : "pending",
    },
    {
      key: "finish",
      label: copy.finishLabel,
      detail: copy.finishDetail,
      state: isDone ? "active" : "pending",
    },
  ];
}

function StepIcon({ state }: { state: ProgressStepState }) {
  if (state === "done") {
    return <CheckCircle2 className="size-4 text-primary" />;
  }
  if (state === "active") {
    return <Loader2 className="size-4 animate-spin text-primary" />;
  }
  return <Circle className="size-4 text-muted-foreground/50" />;
}

export function TaskPlanGenerationProgress({
  phase,
  statusMessage,
  partialText,
  toolCalls,
  toolResults,
  taskId,
  isStoppingGeneration,
  stopGenerationError,
  planningLabel,
  copy: copyOverrides,
  onStop,
}: TaskPlanGenerationProgressProps) {
  const copy = { ...DEFAULT_PROGRESS_COPY, ...copyOverrides };
  const currentMessage = normalizeStatusMessage(statusMessage, planningLabel, copy);
  const progressSteps = buildProgressSteps({
    phase,
    statusMessage,
    partialText,
    toolCalls,
    toolResults,
    copy,
  });

  return (
    <div className="rounded-xl border border-transparent bg-transparent p-0">
      <div className="flex items-center justify-end gap-3">
        <span className="sr-only">{copy.accessibleTitle}</span>
        {taskId ? (
          <button
            type="button"
            onClick={onStop}
            disabled={isStoppingGeneration}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background/80 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:opacity-60"
          >
            <Square className="size-3" />
            {isStoppingGeneration ? copy.stopping : copy.stop}
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-primary">
        <Bot className="size-4 animate-pulse" />
        <span className="font-medium">{currentMessage}</span>
      </div>
      {stopGenerationError ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {stopGenerationError}
        </div>
      ) : null}
      <div className="mt-3 space-y-3 text-xs text-primary/90">
        <div className="space-y-2 rounded-lg border border-primary/15 bg-background/80 px-3 py-3">
          {progressSteps.map((step) => (
            <div key={step.key} className="flex gap-2.5">
              <div className="mt-0.5 shrink-0">
                <StepIcon state={step.state} />
              </div>
              <div className={step.state === "pending" ? "text-muted-foreground" : "text-foreground"}>
                <p className="font-medium">{step.label}</p>
                <p className="text-muted-foreground">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
        {partialText ? (
          <div className="max-h-28 overflow-y-auto rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-muted-foreground">
            {partialText}
          </div>
        ) : null}
        {toolResults.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-border/40 bg-background/70 px-3 py-2">
            <p className="font-medium text-foreground">{copy.completedSteps}</p>
            {toolResults.map((toolResult, index) => (
              <div
                key={`${toolResult.tool}-${index}`}
                className="text-muted-foreground"
              >
                {summarizeToolName(toolResult.tool, copy)}: {toolResult.result === "completed" ? copy.completed : toolResult.result}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
