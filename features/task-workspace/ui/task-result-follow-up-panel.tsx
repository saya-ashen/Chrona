import { useEffect, useState, type KeyboardEvent } from "react";
import { localizeHref, useLocale } from "@chrona/i18n";
import { Badge, Button, Card, CardContent, Textarea } from "@shared/ui";
import { ExternalLink, ListPlus, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useTaskResultFollowUp } from "../hooks/use-task-result-follow-up";
import { TaskMarkdown } from "./task-markdown";

export function TaskResultFollowUpPanel({
  taskId,
  copy,
  initialMode = "ask",
}: {
  taskId: string;
  copy: Record<string, string | undefined>;
  initialMode?: "ask" | "create_task";
}) {
  const locale = useLocale();
  const { state, setMode, setDraft, submit } = useTaskResultFollowUp(taskId, true);
  const [sessionStrategy, setSessionStrategy] = useState<
    "handoff_compact" | "fresh_with_result"
  >("handoff_compact");

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, setMode]);

  const draft = state.mode === "ask" ? state.askDraft : state.createTaskDraft;
  const submitting = state.status === "submitting";
  const sourceSession = state.state?.sourceSession;

  useEffect(() => {
    if (sourceSession && !sourceSession.supportsHandoff) {
      setSessionStrategy("fresh_with_result");
    }
  }, [sourceSession]);
  const sessionHealth = sourceSession?.health ?? "unknown";
  const sessionLabel = !sourceSession?.available
    ? copy.followUpSessionUnavailable ?? "Original session unavailable — answers use the accepted result."
    : sessionHealth === "compacted"
      ? copy.followUpSessionCompacted ?? "Continuing the original session · earlier context was compacted"
      : copy.followUpSessionActive ?? "Continuing the original execution conversation";

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit({ sessionStrategy });
    }
  };

  return (
    <section className="space-y-3 border-t border-border/70 pt-4" data-testid="result-follow-up-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-full items-center gap-1 rounded-lg border border-border/80 bg-muted/70 p-1 sm:w-auto" role="tablist">
          <Button
            type="button"
            size="sm"
            variant={state.mode === "ask" ? "default" : "ghost"}
            className="h-8 flex-1 gap-1.5 rounded-md px-3 text-xs shadow-none sm:flex-none"
            role="tab"
            aria-selected={state.mode === "ask"}
            disabled={submitting}
            onClick={() => setMode("ask")}
          >
            <MessageCircle className="size-3.5" aria-hidden />
            {copy.followUpAskOnly ?? "Ask a follow-up"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={state.mode === "create_task" ? "default" : "ghost"}
            className="h-8 flex-1 gap-1.5 rounded-md px-3 text-xs shadow-none sm:flex-none"
            role="tab"
            aria-selected={state.mode === "create_task"}
            disabled={submitting}
            onClick={() => setMode("create_task")}
          >
            <ListPlus className="size-3.5" aria-hidden />
            {copy.followUpCreateTask ?? "Create next task"}
          </Button>
        </div>
        <Badge variant={sourceSession?.available ? "secondary" : "outline"} className="w-fit">
          {sessionLabel}
        </Badge>
      </div>

      {state.mode === "create_task" ? (
        <fieldset className="grid gap-2 rounded-xl border border-border/70 bg-muted/35 p-3 text-sm sm:grid-cols-2">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            {copy.followUpSessionStrategyLabel ?? "Context strategy"}
          </legend>
          <label
            className={`flex gap-2 rounded-lg border bg-background p-2.5 ${sourceSession?.supportsHandoff ? "cursor-pointer border-border/60" : "cursor-not-allowed border-border/40 opacity-60"}`}
          >
            <input
              type="radio"
              name="result-session-strategy"
              value="handoff_compact"
              checked={sessionStrategy === "handoff_compact"}
              disabled={!sourceSession?.supportsHandoff}
              onChange={() => setSessionStrategy("handoff_compact")}
            />
            <span>
              <span className="block font-medium">
                {copy.followUpHandoffSession ?? "Handoff to a new session"}
              </span>
              <span className="text-xs text-muted-foreground">
                {sourceSession?.supportsHandoff
                  ? (copy.followUpHandoffSessionDescription ??
                    "Compact the source conversation into a focused handoff for a new independent session.")
                  : (copy.followUpHandoffUnavailable ??
                    "The selected coding agent cannot hand off this source session.")}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-2 rounded-lg border border-border/60 bg-background p-2.5">
            <input
              type="radio"
              name="result-session-strategy"
              value="fresh_with_result"
              checked={sessionStrategy === "fresh_with_result"}
              onChange={() => setSessionStrategy("fresh_with_result")}
            />
            <span>
              <span className="block font-medium">{copy.followUpFreshSession ?? "Use clean context"}</span>
              <span className="text-xs text-muted-foreground">{copy.followUpFreshSessionDescription ?? "Carry only the accepted result and deliverables."}</span>
            </span>
          </label>
        </fieldset>
      ) : null}

      {state.mode === "ask" && state.state?.entries.some((entry) => entry.intent === "ask") ? (
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl bg-muted/55 p-3 text-sm" aria-live="polite">
          {state.state.entries.filter((entry) => entry.intent === "ask").map((entry) => (
            <div key={entry.id} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{copy.followUpYouLabel ?? "You"}</p>
              <p className="whitespace-pre-wrap leading-6 text-foreground">{entry.instruction}</p>
              {entry.answer ? (
                <>
                  <p className="pt-1 text-xs font-medium text-muted-foreground">{copy.followUpChronaLabel ?? "Chrona"}</p>
                  <TaskMarkdown className="py-0">{entry.answer}</TaskMarkdown>
                  <p className="text-[11px] text-muted-foreground">
                    {entry.contextSource === "source_session"
                      ? copy.followUpAnsweredFromSession ?? "Answered from the original execution conversation"
                      : copy.followUpAnsweredFromResult ?? "Answered from the accepted result fallback"}
                    {entry.cache?.readInputTokens
                      ? ` · ${copy.followUpCacheReused ?? "Prompt cache reused"}`
                      : entry.cache?.creationInputTokens
                        ? ` · ${copy.followUpCacheRebuilt ?? "Prompt cache rebuilt"}`
                        : ""}
                  </p>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(state.mode, event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            state.mode === "ask"
              ? copy.followUpAskPlaceholder ?? "Ask a question about the accepted result…"
              : copy.followUpCreateTaskPlaceholder ?? "Describe what should happen next…"
          }
          className="min-h-20 flex-1 rounded-xl bg-background sm:min-h-16"
          aria-label={copy.followUpInputLabel ?? "Follow-up request"}
          disabled={submitting || state.status === "loading"}
        />
        <Button
          type="button"
          size="lg"
          className="shrink-0 sm:min-w-32"
          disabled={!draft.trim() || submitting || state.status === "loading"}
          onClick={() => void submit({ sessionStrategy })}
        >
          {submitting
            ? copy.followUpSubmitting ?? "Working..."
            : state.mode === "ask"
              ? copy.followUpAskSubmit ?? "Ask Chrona"
              : copy.followUpCreateTaskSubmit ?? "Create task"}
        </Button>
      </div>

      {state.error ? (
        <p
          className="rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}

      {state.state?.entries
        .filter((entry) => entry.intent === "create_task" && entry.createdTask)
        .map((entry) => (
          <Card key={entry.id} className="border-success/35 bg-success/10">
            <CardContent className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>
                {copy.followUpTaskCreated ?? "Follow-up task created"}: {entry.createdTask?.title}
              </span>
              <Button asChild type="button" size="sm" variant="outline">
                <Link to={localizeHref(locale, `/tasks/${entry.createdTask?.id}`)}>
                  {copy.followUpOpenTask ?? "Open task"}
                  <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
    </section>
  );
}
