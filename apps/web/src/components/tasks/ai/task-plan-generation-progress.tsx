import { Bot, CheckCircle2, Circle, Loader2, Square } from "lucide-react";

import type { StreamPhase, StreamToolCall, StreamToolResult } from "@/hooks/ai/types";

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
  onStop: () => void;
};

type ProgressStepState = "done" | "active" | "pending";

type ProgressStep = {
  key: string;
  label: string;
  detail: string;
  state: ProgressStepState;
};

function normalizeStatusMessage(message: string | null, planningLabel: string) {
  if (!message) return planningLabel;
  if (message === "AI 正在生成建议...") return "正在连接 AI，准备生成计划...";
  if (message === "Reading saved plan...") return "正在整理并保存计划...";
  if (message === "Plan generated.") return "计划已生成，正在更新界面...";
  if (message.startsWith("Tool call: ")) {
    return `正在使用工具：${message.slice("Tool call: ".length)}`;
  }
  return message;
}

function summarizeToolName(tool: string) {
  switch (tool) {
    case "chrona_plan_generate":
      return "生成计划结构";
    case "skill_view":
      return "读取规划技能";
    default:
      return tool;
  }
}

function getPrepareStepState(hasProviderActivity: boolean, isSaving: boolean, isDone: boolean) {
  return hasProviderActivity || isSaving || isDone ? "done" : "active";
}

function getGenerateStepState(hasProviderActivity: boolean, isSaving: boolean, isDone: boolean) {
  if (isSaving || isDone) return "done";
  return hasProviderActivity ? "active" : "pending";
}

function getGenerateStepDetail(toolCalls: StreamToolCall[], toolResults: StreamToolResult[]) {
  const latestTool = toolCalls[toolCalls.length - 1]?.tool;
  if (latestTool) return `正在${summarizeToolName(latestTool)}`;
  if (toolResults.length > 0) return "AI 已返回计划草稿";
  return "AI 正在拆解任务步骤";
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
    statusMessage === "AI 正在生成建议...";
}

function buildProgressSteps({
  phase,
  statusMessage,
  partialText,
  toolCalls,
  toolResults,
}: Pick<
  TaskPlanGenerationProgressProps,
  "phase" | "statusMessage" | "partialText" | "toolCalls" | "toolResults"
>): ProgressStep[] {
  const hasActivity = hasProviderActivity(phase, statusMessage, partialText, toolCalls, toolResults);
  const isSaving = statusMessage === "Reading saved plan..." || statusMessage === "Plan generated.";
  const isDone = phase === "done" || statusMessage === "Plan generated.";

  return [
    {
      key: "prepare",
      label: "准备任务上下文",
      detail: "读取任务信息和计划约束",
      state: getPrepareStepState(hasActivity, isSaving, isDone),
    },
    {
      key: "generate",
      label: "生成工作计划",
      detail: getGenerateStepDetail(toolCalls, toolResults),
      state: getGenerateStepState(hasActivity, isSaving, isDone),
    },
    {
      key: "save",
      label: "整理结果",
      detail: "保存计划并准备展示",
      state: isDone ? "done" : isSaving || toolResults.length > 0 ? "active" : "pending",
    },
    {
      key: "finish",
      label: "完成展示",
      detail: "更新前端计划视图",
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
  onStop,
}: TaskPlanGenerationProgressProps) {
  const currentMessage = normalizeStatusMessage(statusMessage, planningLabel);
  const progressSteps = buildProgressSteps({
    phase,
    statusMessage,
    partialText,
    toolCalls,
    toolResults,
  });

  return (
    <div className="rounded-xl border border-transparent bg-transparent p-0">
      <div className="flex items-center justify-end gap-3">
        <span className="sr-only">AI Task Planning</span>
        {taskId ? (
          <button
            type="button"
            onClick={onStop}
            disabled={isStoppingGeneration}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background/80 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:opacity-60"
          >
            <Square className="size-3" />
            {isStoppingGeneration ? "Stopping..." : "Stop"}
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-primary">
        <Bot className="size-4 animate-pulse" />
        <span className="font-medium">{currentMessage}</span>
      </div>
      {stopGenerationError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
            <p className="font-medium text-foreground">已完成的后台步骤</p>
            {toolResults.map((toolResult, index) => (
              <div
                key={`${toolResult.tool}-${index}`}
                className="text-muted-foreground"
              >
                {summarizeToolName(toolResult.tool)}：{toolResult.result === "completed" ? "已完成" : toolResult.result}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
