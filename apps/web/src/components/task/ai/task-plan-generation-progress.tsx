import { Bot, Square } from "lucide-react";

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
  const hasTrace =
    phase !== "thinking" ||
    Boolean(statusMessage) ||
    Boolean(partialText) ||
    toolCalls.length > 0 ||
    toolResults.length > 0;

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
        <span className="font-medium">{statusMessage ?? planningLabel}</span>
      </div>
      {stopGenerationError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {stopGenerationError}
        </div>
      ) : null}
      {hasTrace ? (
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
