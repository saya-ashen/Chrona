"use client";

import { AlertCircle, CheckCircle2, Loader2, Sparkles, Wrench } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DEFAULT_SCHEDULE_PAGE_COPY, getSchedulePageCopy } from "@/components/schedule/schedule-page-copy";
import type { QuickCreateDraft } from "@/components/schedule/schedule-page-types";
import { buildQuickCreateDraft, toDateForDay } from "@/components/schedule/schedule-page-utils";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { useScheduleAiPreferences } from "@/lib/schedule-ai-preferences";
import { useAutoComplete, type StructuredSuggestion } from "@/hooks/use-ai";
import { createLogger, summarizeText } from "@/lib/logger";

const logger = createLogger("schedule.command-bar");

const priorityBadgeColors: Record<string, string> = {
  Low: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-orange-100 text-orange-700",
  Urgent: "bg-red-100 text-red-700",
};

type ProcessTrace = {
  requestId: string;
  rawInput: string;
  normalizedInput: string;
  finalSubmittedTitle: string | null;
  source: "suggestion" | "direct_submit";
  statusMessage: string | null;
  toolCalls: Array<{ tool: string; input: Record<string, unknown> }>;
  toolResults: Array<{ tool: string; result: string }>;
  partialText: string;
  finalSummary: string | null;
  phase: "idle" | "running" | "done" | "error";
  error: string | null;
  suggestionId?: string;
  suggestionTitle?: string;
};

function newTrace(input: { rawInput: string; normalizedInput: string; source: "suggestion" | "direct_submit"; suggestionId?: string; suggestionTitle?: string }): ProcessTrace {
  return {
    requestId: crypto.randomUUID(),
    rawInput: input.rawInput,
    normalizedInput: input.normalizedInput,
    finalSubmittedTitle: null,
    source: input.source,
    statusMessage: null,
    toolCalls: [],
    toolResults: [],
    partialText: "",
    finalSummary: null,
    phase: "running",
    error: null,
    suggestionId: input.suggestionId,
    suggestionTitle: input.suggestionTitle,
  };
}

function AiProcessPanel({ trace }: { trace: ProcessTrace | null }) {
  if (!trace) return null;

  return (
    <div className="mt-3 rounded-2xl border border-border/60 bg-muted/20 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Sparkles className="size-3.5 text-primary" />
          AI process panel
        </div>
        <span className="text-[10px] text-muted-foreground">{trace.source}</span>
      </div>
      <div className="mt-2 grid gap-1 text-muted-foreground">
        <div>rawInput: {trace.rawInput}</div>
        <div>normalizedInput: {trace.normalizedInput}</div>
        {trace.suggestionTitle ? <div>suggestionTitle: {trace.suggestionTitle}</div> : null}
        {trace.finalSubmittedTitle ? <div className="font-medium text-foreground">finalSubmittedTitle: {trace.finalSubmittedTitle}</div> : null}
      </div>
      {trace.statusMessage ? <div className="mt-2 rounded-lg border border-border/40 bg-background px-2 py-1.5">{trace.statusMessage}</div> : null}
      {trace.toolCalls.length > 0 ? (
        <div className="mt-2 space-y-1">
          <div className="font-medium text-foreground">toolCalls</div>
          {trace.toolCalls.map((toolCall, index) => (
            <div key={`${toolCall.tool}-${index}`} className="flex items-center gap-1.5 text-muted-foreground">
              <Wrench className="size-3 text-amber-500" />
              <span className="font-mono">{toolCall.tool}</span>
            </div>
          ))}
        </div>
      ) : null}
      {trace.toolResults.length > 0 ? (
        <div className="mt-2 space-y-1">
          <div className="font-medium text-foreground">toolResults</div>
          {trace.toolResults.map((toolResult, index) => (
            <div key={`${toolResult.tool}-${index}`} className="text-muted-foreground">
              {toolResult.tool}: {toolResult.result}
            </div>
          ))}
        </div>
      ) : null}
      {trace.partialText ? (
        <div className="mt-2 rounded-lg border border-border/40 bg-background px-2 py-1.5 text-muted-foreground">
          {trace.partialText}
        </div>
      ) : null}
      {trace.finalSummary ? <div className="mt-2 text-muted-foreground">finalSummary: {trace.finalSummary}</div> : null}
      {trace.error ? (
        <div className="mt-2 flex items-center gap-1.5 text-red-600"><AlertCircle className="size-3.5" />{trace.error}</div>
      ) : trace.phase === "done" ? (
        <div className="mt-2 flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="size-3.5" />done</div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-primary"><Loader2 className="size-3.5 animate-spin" />running</div>
      )}
    </div>
  );
}

export function ScheduleCommandBar({
  id,
  selectedDay,
  isPending,
  onSubmit,
  autoSuggestionsEnabled,
}: {
  id?: string;
  selectedDay: string;
  isPending: boolean;
  onSubmit: (draft: QuickCreateDraft) => Promise<void>;
  autoSuggestionsEnabled?: boolean;
}) {
  const { messages } = useI18n();
  const aiPreferences = useScheduleAiPreferences();
  const resolvedAutoSuggestionsEnabled = autoSuggestionsEnabled ?? aiPreferences.autoSuggestionsEnabled;
  const copy = useMemo(() => getSchedulePageCopy(messages.components?.schedulePage), [messages.components?.schedulePage]);
  const cmdBarCopy = {
    generatingSuggestions: "Generating suggestions...",
    ...((messages.components as unknown as Record<string, Record<string, string>> | undefined)?.scheduleCommandBar ?? {}),
  };
  const [value, setValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [trace, setTrace] = useState<ProcessTrace | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressRef = useRef(false);

  const normalizedValue = value.trim();
  const autoCompleteInput = resolvedAutoSuggestionsEnabled && !suppressRef.current && !isComposing && normalizedValue.length >= 3 ? normalizedValue : null;
  const { structuredSuggestions, isLoading: aiLoading, error: autoCompleteError, phase, statusMessage, toolCalls, toolResults, partialText } = useAutoComplete(
    autoCompleteInput,
  );

  const showPanel = resolvedAutoSuggestionsEnabled && showSuggestions && ((structuredSuggestions?.length ?? 0) > 0 || (aiLoading && phase !== "idle"));
  const processTrace = trace ?? (aiLoading || toolCalls.length > 0 || toolResults.length > 0 || Boolean(partialText)
    ? {
        requestId: "live-auto-complete",
        rawInput: value,
        normalizedInput: value.trim(),
        finalSubmittedTitle: null,
        source: "direct_submit" as const,
        statusMessage,
        toolCalls: toolCalls ?? [],
        toolResults: toolResults ?? [],
        partialText,
        finalSummary: null,
        phase: aiLoading ? "running" as const : "idle" as const,
        error: null,
      }
    : null);

  async function submitDraft(draft: QuickCreateDraft, currentTrace: ProcessTrace, finalTitle: string) {
    setTrace({ ...currentTrace, finalSubmittedTitle: finalTitle, phase: "done" });
    await onSubmit(draft);
    setValue("");
  }

  function buildDraftFromSuggestion(suggestion: StructuredSuggestion) {
    const now = new Date();
    const referenceDate = toDateForDay(selectedDay, now.getHours() * 60 + now.getMinutes());
    const draft = buildQuickCreateDraft({
      title: suggestion.action.title,
      selectedDay,
      now: referenceDate,
      priority: suggestion.action.priority,
      durationMinutes: suggestion.action.estimatedMinutes,
    });

    if (suggestion.action.scheduledStartAt && suggestion.action.scheduledEndAt) {
      draft.scheduledStartAt = new Date(suggestion.action.scheduledStartAt);
      draft.scheduledEndAt = new Date(suggestion.action.scheduledEndAt);
    }
    return draft;
  }

  async function handleSelectSuggestion(structured: StructuredSuggestion) {
    const normalized = value.trim() || structured.action.title;
    const currentTrace = newTrace({
      rawInput: value,
      normalizedInput: normalized,
      source: "suggestion",
      suggestionId: structured.id,
      suggestionTitle: structured.action.title,
    });
    logger.info("quick_create.select_suggestion", {
      requestId: currentTrace.requestId,
      rawInput: summarizeText(value),
      normalizedInput: summarizeText(normalized),
      suggestionId: structured.id,
      suggestionTitle: structured.action.title,
      finalSubmittedTitle: structured.action.title,
    });
    suppressRef.current = true;
    setSubmitError(null);
    setTrace({
      ...currentTrace,
      finalSummary: structured.summary,
      finalSubmittedTitle: structured.action.title,
      statusMessage: "Using selected AI suggestion",
      toolCalls,
      toolResults,
      partialText,
      phase: "done",
    });
    setValue(structured.action.title);
    setShowSuggestions(false);
    await onSubmit(buildDraftFromSuggestion(structured));
    setValue("");
  }

  async function handleSubmit() {
    const rawInput = value;
    const normalized = rawInput.trim();
    if (!normalized) return;

    const currentTrace = newTrace({ rawInput, normalizedInput: normalized, source: "direct_submit" });
    setTrace({
      ...currentTrace,
      statusMessage,
      toolCalls,
      toolResults,
      partialText,
      finalSummary: structuredSuggestions[0]?.summary ?? null,
      phase: aiLoading ? "running" : autoCompleteError ? "error" : "done",
      error: autoCompleteError,
    });
    setSubmitError(null);
    setIsResolving(true);
    logger.info("quick_create.submit_start", {
      requestId: currentTrace.requestId,
      rawInput: summarizeText(rawInput),
      normalizedInput: summarizeText(normalized),
      suggestionVisible: showSuggestions,
      structuredSuggestionCount: structuredSuggestions.length,
      autoCompletePhase: phase,
    });

    try {
      const chosen = structuredSuggestions[0] ?? null;
      if (!chosen) {
        throw new Error(
          autoCompleteError
            ? autoCompleteError
            : aiLoading || phase === "connecting" || phase === "thinking" || phase === "streaming"
              ? "AI suggestions are still loading. Please wait a moment and submit again."
              : "AI 无法可靠理解该输入，请补充更明确的任务描述后重试。未执行本地 parser 降级。\nAI could not safely interpret this input.",
        );
      }

      const draft = buildDraftFromSuggestion(chosen);
      logger.info("quick_create.submit_resolved", {
        requestId: currentTrace.requestId,
        finalSubmittedTitle: chosen.action.title,
        suggestionCount: structuredSuggestions.length,
      });
      await submitDraft(draft, currentTrace, chosen.action.title);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create task";
      setSubmitError(message);
      setTrace((prev) => (prev ? { ...prev, phase: "error", error: message } : prev));
      logger.error("quick_create.submit_error", {
        requestId: currentTrace.requestId,
        error: message,
      });
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <div id={id} className="rounded-2xl border border-border/60 bg-background/70 p-3 shadow-sm">
      <div className="relative flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <input
            value={value}
            disabled={isPending || isResolving}
            onChange={(event) => {
              suppressRef.current = false;
              setValue(event.target.value);
              setSubmitError(null);
              if (resolvedAutoSuggestionsEnabled && !isComposing) setShowSuggestions(true);
              logger.debug("quick_create.input_change", {
                rawInput: summarizeText(event.target.value),
                normalizedInput: summarizeText(event.target.value.trim()),
              });
            }}
            onCompositionStart={() => {
              setIsComposing(true);
              setShowSuggestions(false);
            }}
            onCompositionEnd={(event) => {
              setIsComposing(false);
              suppressRef.current = false;
              setValue(event.currentTarget.value);
              if (resolvedAutoSuggestionsEnabled && event.currentTarget.value.trim().length >= 3) setShowSuggestions(true);
            }}
            onFocus={() => {
              if (resolvedAutoSuggestionsEnabled && !isComposing) setShowSuggestions(true);
            }}
            onBlur={() => {
              blurTimeoutRef.current = setTimeout(() => setShowSuggestions(false), 200);
            }}
            onKeyDown={(event) => {
              const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & {
                isComposing?: boolean;
                keyCode?: number;
              };
              if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
              if (event.key === "Escape") setShowSuggestions(false);
            }}
            placeholder={copy.quickCreatePlaceholder}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-0 transition focus:border-primary/50"
          />

          {showPanel ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border/60 bg-background shadow-lg">
              <div className="flex items-center gap-1.5 border-b border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="size-3 text-primary" />
                AI suggestions
                {aiLoading && <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" />}
              </div>
              {aiLoading && statusMessage ? (
                <div className="flex items-center gap-2 border-b border-border/20 px-3 py-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  <span>{statusMessage}</span>
                </div>
              ) : null}
              {toolCalls?.length > 0 ? (
                <div className="border-b border-border/20 px-3 py-1.5">
                  {toolCalls.map((tc, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Wrench className="size-2.5 text-amber-500" />
                      <span className="font-mono">{tc.tool}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {(structuredSuggestions ?? []).slice(0, 5).map((s, i) => (
                <button
                  key={`${s.id}-${i}`}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted/60"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleSelectSuggestion(s);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{s.action.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.summary}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {s.action.estimatedMinutes ? <span className="text-[10px] text-muted-foreground">{s.action.estimatedMinutes}m</span> : null}
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", priorityBadgeColors[s.action.priority] ?? "bg-muted text-muted-foreground")}>
                      {s.action.priority}
                    </span>
                  </div>
                </button>
              ))}
              {(structuredSuggestions?.length ?? 0) === 0 && aiLoading ? (
                <div className="px-3 py-3 text-center text-xs text-muted-foreground">{cmdBarCopy.generatingSuggestions}</div>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          disabled={isPending || isResolving || value.trim().length === 0}
          onClick={() => void handleSubmit()}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-10 rounded-xl px-4")}
        >
          {isResolving ? <Loader2 className="size-4 animate-spin" /> : copy.quickCreateSubmit}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{copy.quickCreateHint || DEFAULT_SCHEDULE_PAGE_COPY.quickCreateHint}</p>
      {submitError ? <div className="mt-2 text-xs text-red-600">{submitError}</div> : null}
      <AiProcessPanel trace={processTrace} />
    </div>
  );
}
