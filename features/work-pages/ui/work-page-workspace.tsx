import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CalendarDays, MoreHorizontal, RefreshCw } from "lucide-react";
import { localizeHref, useI18n } from "@chrona/i18n";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, PageFrame } from "@shared/ui";
import type { PageInputsView, WorkResultView } from "@chrona/contracts";
import { loadPageResponses, readPageResult, type PageScope } from "../model/client";
import { PageDraftProvider, usePageDrafts } from "../hooks/page-drafts";
import { PageInputHistory, PageNotes } from "./page-notes";
import { WorkPageRenderer } from "./work-page-renderer";
import { PageClassification } from "./page-classification";
import { PageTaskDescription } from "./page-task-description";
import { PageContinuationPanel, PageUpdateSummary } from "./page-continuation";

type Props = { taskId: string; title: string; description?: string | null; occurrenceId?: string | null; context?: ReactNode };
function PageContent({ view, description, scope, inputs, resultPath, onSaved }: { view: WorkResultView | null; description?: string | null; scope: PageScope; inputs: PageInputsView | null; resultPath: string; onSaved: () => void }) {
  const { messages, locale } = useI18n(), c = messages.workPages;
  if (!view) return <p role="status">{c.loading}</p>;
  const content = view.version?.content;
  if (!content) return <PageTaskDescription description={description} />;
  if (content.page) return <WorkPageRenderer key={view.version!.id} page={content.page} scope={scope} versionId={view.version!.id} inputs={inputs} onSaved={onSaved} />;
  return <div className="space-y-6">{(["nextActions", "findings", "decisions", "caveats"] as const).map((kind) => content[kind].length > 0 && <section key={kind}><h2 className="mb-3 text-lg font-semibold">{messages.workResults[kind]}</h2>{content[kind].map((item) => <div key={item.key} className="mb-3 max-w-[75ch] whitespace-pre-wrap">{item.title && <h3 className="font-medium">{item.title}</h3>}<p>{item.content}</p></div>)}</section>)}<Button variant="outline" asChild><Link to={localizeHref(locale, resultPath)}>{c.results}</Link></Button></div>;
}
function PageHeading({ title, view }: { title: string; view: WorkResultView | null }) {
  const { messages } = useI18n(), c = messages.workPages, version = view?.version;
  return <header className="space-y-3"><h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
    {version && <><p className="max-w-[75ch] whitespace-pre-wrap text-base leading-relaxed text-muted-foreground">{version.content.outcome.summary}</p><p className="text-xs text-muted-foreground">{c.source} {version.sourceLabel ?? (version.sourceKind === "external" ? messages.workResults.external : messages.workResults.human)} · {c.version} {version.version}</p></>}
  </header>;
}
function WorkspaceContent({ taskId, title, description, occurrenceId = null, context }: Props) {
  const { messages, locale } = useI18n(), c = messages.workPages, drafts = usePageDrafts();
  const scope: PageScope = { taskId, occurrenceId };
  const [view, setView] = useState<WorkResultView | null>(null), [inputs, setInputs] = useState<PageInputsView | null>(null);
  const [error, setError] = useState(false), [inputError, setInputError] = useState(false), [reload, setReload] = useState(0), [answerReload, setAnswerReload] = useState(0);
  const href = (path: string) => localizeHref(locale, path);
  const resultPath = `/tasks/${taskId}/results${occurrenceId ? `?occurrenceId=${encodeURIComponent(occurrenceId)}` : ""}`;
  useEffect(() => {
    const controller = new AbortController(); setError(false);
    void readPageResult({ taskId, occurrenceId }, controller.signal).then((next) => { if (!controller.signal.aborted) { setView(next); setInputs(null); } }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [taskId, occurrenceId, reload]);
  const versionId = view?.version?.id;
  useEffect(() => {
    if (!versionId) return;
    const controller = new AbortController(); setInputError(false);
    void loadPageResponses({ taskId, occurrenceId }, versionId, controller.signal).then((next) => { if (!controller.signal.aborted) setInputs(next); }).catch(() => { if (!controller.signal.aborted) setInputError(true); });
    return () => controller.abort();
  }, [taskId, occurrenceId, versionId, answerReload]);
  function refresh() { if (!drafts?.dirty || window.confirm(c.leaveDraft)) { setReload((n) => n + 1); } }
  return <PageFrame mode="workspace" data-domain="work-pages" className="mx-auto w-full max-w-[1360px] px-0 py-2 sm:py-4">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3" data-ui-surface-kind="product-authored">
      <Button variant="ghost" size="sm" asChild><Link to={href("/home")}><ArrowLeft className="size-4" />{c.home}</Link></Button>
      <div className="flex items-center gap-1"><Button variant="ghost" size="sm" asChild><Link to={href(`/schedule?task=${encodeURIComponent(taskId)}`)}><CalendarDays className="size-4" />{c.schedule}</Link></Button>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={c.more} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem render={<Link to={href(resultPath)} />}>{c.results}</DropdownMenuItem>
          <DropdownMenuItem render={<Link to={href(`/tasks/${taskId}/work`)} />}>{c.workRecord}</DropdownMenuItem>
          <DropdownMenuItem render={<Link to={href(`/tasks/${taskId}?view=execution`)} />}>{c.execution}</DropdownMenuItem>
          <DropdownMenuItem onClick={refresh}><RefreshCw className="size-4" />{c.refresh}</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>
    </div>
    <article className="min-w-0 space-y-8 pb-10">
      <PageHeading title={title} view={view} />
      <PageClassification taskId={taskId} title={title} />
      <PageUpdateSummary report={view?.version?.content.continuation} />
      {view?.pageUnavailable && <p role="alert">{c.pageFallback}</p>}
      {context}
      {inputError && <div role="alert"><p>{c.error}</p><Button variant="outline" onClick={() => setAnswerReload((n) => n + 1)}>{c.retry}</Button></div>}
      {error ? <div role="alert"><p>{c.error}</p><Button variant="outline" onClick={refresh}>{c.retry}</Button></div> : <PageContent view={view} description={description} scope={scope} inputs={inputs} resultPath={resultPath} onSaved={() => setAnswerReload((n) => n + 1)} />}
      <PageNotes scope={scope} onSaved={() => setAnswerReload((n) => n + 1)} />
      <PageContinuationPanel scope={scope} versionId={versionId} refreshKey={answerReload} onSaved={() => setAnswerReload((n) => n + 1)} />
      <PageInputHistory scope={scope} refreshKey={answerReload} />
    </article>
  </PageFrame>;
}
export function WorkPageWorkspace(props: Props) {
  return <PageDraftProvider><WorkspaceContent {...props} /></PageDraftProvider>;
}
