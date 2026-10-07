import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Badge, Button, PageFrame } from "@shared/ui";
import { useWorkResults } from "../hooks/use-work-results";
import type { ResultBundle, ResultScope } from "../model/client";
import { resultWriteReason, canComposeResult } from "../model/state";
import { ResultContent } from "./result-content";
import { ResultComposer } from "./result-composer";
import { ResultReview } from "./result-review";
import { ResultReviewHistory, ResultVersionNavigation } from "./result-history";

type State = ReturnType<typeof useWorkResults>;
function allowedContext(data: ResultBundle, blocked: boolean, composing: boolean) {
  return { ...data.context, canSubmit: data.context.canSubmit && !blocked, canReview: data.context.canReview && !blocked && !composing,
    canUpload: data.context.canUpload && !blocked, canDownload: data.context.canDownload && !blocked };
}
function ResultWorkspace({ state, data, scope, saved }: { state: State; data: ResultBundle; scope: ResultScope; saved: () => void }) {
  const c = useI18n().messages.workResults;
  const [composing, setComposing] = useState(false);
  const context = allowedContext(data, state.loading || !!state.error, composing);
  const reason = resultWriteReason(context, context.canSubmit);
  function published() { saved(); setComposing(false); state.select("latest"); state.refresh(); }
  const canCompose = canComposeResult(context, data.view);
  return <>
    <ResultTaskStatus status={context.task.status} />
    {data.view.state?.newerVersionPending && <p role="status">{c.newerPending}</p>}
    {reason && !state.loading && <p>{c[reason]}</p>}
    <ResultVersionNavigation state={state} locked={composing || state.loading} />
    <ResultContent key={data.view.version?.id ?? "empty"} view={data.view} scope={scope} canDownload={context.canDownload} />
    <ResultEditorToggle composing={composing} canCompose={!!canCompose} start={() => setComposing(true)}>
      <ResultComposer scope={scope} context={context} view={data.view} onClose={() => setComposing(false)} onRefresh={state.refresh} onSaved={published} />
    </ResultEditorToggle>
    {data.view.version && <ResultReview scope={scope} view={data.view} context={context} onSaved={() => { saved(); state.refresh(); }} />}
    <ResultReviewHistory reviews={data.reviews} state={state} />
  </>;
}
function ResultTaskStatus({ status }: { status: string }) {
  const { messages } = useI18n();
  const labels = messages.pages.goals.taskStatus as Record<string, string>;
  return <Badge variant="outline">{messages.workResults.taskStatus}: {labels[status] ?? status}</Badge>;
}
function ResultEditorToggle({ composing, canCompose, start, children }: { composing: boolean; canCompose: boolean; start: () => void; children: React.ReactNode }) {
  const c = useI18n().messages.workResults;
  return composing ? children : <Button disabled={!canCompose} onClick={start}>{c.newVersion}</Button>;
}
export function WorkResultsPage({ taskId, occurrenceId = null, embedded = false }: { taskId: string; occurrenceId?: string | null; embedded?: boolean }) {
  const { messages, locale } = useI18n(), c = messages.workResults;
  const scope: ResultScope = { taskId, occurrenceId };
  const state = useWorkResults(scope);
  const [saved, setSaved] = useState(false);
  const data = state.bundle;
  const content = <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 pb-8" data-ui-surface-kind="product-authored">
      {!embedded && <><Button variant="outline" asChild><Link to={`/${locale}/tasks/${encodeURIComponent(taskId)}`}>{c.back}</Link></Button>
      <h1 className="break-words text-2xl font-semibold">{c.title}{data ? ` · ${data.context.task.title}` : ""}</h1><p>{c.intro}</p></>}
      <Button variant="ghost" asChild><Link to={`/${locale}/tasks/${encodeURIComponent(taskId)}/page${occurrenceId ? `?occurrenceId=${encodeURIComponent(occurrenceId)}` : ""}`}>{messages.workPages.viewPage}</Link></Button>
      <p className="break-all text-sm">{occurrenceId ? `${c.occurrenceScope}: ${occurrenceId}` : c.taskScope}</p>
      <Button variant="outline" onClick={state.refresh} disabled={state.loading}>{c.refresh}</Button>
      {state.loading && <p role="status">{c.loading}</p>}{state.error && <p role="alert">{c[state.error]}</p>}{saved && <p role="status">{c.saved}</p>}
      {data && <ResultWorkspace state={state} data={data} scope={scope} saved={() => setSaved(true)} />}
    </div>;
  return embedded ? content : <PageFrame mode="main" data-domain="work-results" className="min-w-0 p-2 sm:p-4">{content}</PageFrame>;
}
