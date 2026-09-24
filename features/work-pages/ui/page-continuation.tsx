import { useEffect, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Textarea } from "@shared/ui";
import type { PageInputsView, WorkResultView } from "@chrona/contracts";
import { pageRequest, type PageScope } from "../model/client";
import { usePageCommand, useUnsavedPage } from "../hooks/use-page-command";
import { usePageDrafts } from "../hooks/page-drafts";
import { PageSaveState } from "./page-save-state";

type Report = NonNullable<NonNullable<WorkResultView["version"]>["content"]["continuation"]>;
export function PageUpdateSummary({ report }: { report?: Report }) {
  const c = useI18n().messages.workPages;
  if (!report) return null;
  return <section className="space-y-3 rounded-xl bg-muted/30 p-4 sm:p-5" data-ui-surface-kind="product-authored" aria-label={c.updateTitle}>
    <h2 className="font-semibold">{c.updateTitle}</h2><p className="whitespace-pre-wrap break-words">{report.summary}</p>
    <ul className="list-disc space-y-1 pl-5">{report.changes.map((text, i) => <li key={i} className="break-words">{text}</li>)}</ul>
    <p className="text-xs text-muted-foreground">{c.reportIsClaim}</p>
    {report.feedback.length > 0 && <details><summary className="cursor-pointer text-sm">{c.feedbackDetails}</summary><ul className="mt-3 space-y-3">{report.feedback.map((item) => <li key={item.entryId} className="text-sm"><span className="font-medium">{c[item.disposition]}</span><p className="whitespace-pre-wrap break-words">{item.explanation}</p></li>)}</ul></details>}
  </section>;
}
function RequestEditor({ scope, inputs, versionId, onSaved, onCancel }: { scope: PageScope; inputs: PageInputsView; versionId: string; onSaved: () => void; onCancel: () => void }) {
  const c = useI18n().messages.workPages, [text, setText] = useState("");
  const command = usePageCommand(scope, inputs.revision, () => { setText(""); onSaved(); });
  const key = useUnsavedPage(Boolean(text) || !!command.pending), drafts = usePageDrafts();
  const otherDrafts = drafts?.hasOtherDraft(key), stale = inputs.headVersionId !== versionId;
  const locked = command.busy || !!command.pending;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{c.handoffHint}</p>
    <Textarea aria-label={c.handoffQuestion} placeholder={c.handoffPlaceholder} value={text} maxLength={2000} disabled={locked} onChange={(e) => { setText(e.target.value); command.changed(); }} />
    {otherDrafts && <p role="status" className="text-sm">{c.saveDraftsFirst}</p>}
    {stale && <p role="alert">{c.newVersion}</p>}
    <Button disabled={!text.trim() || otherDrafts || stale || !inputs.canRespond || locked} onClick={() => void command.commit({ type: "handoff", versionId, text })}>{command.busy ? c.saving : c.saveHandoff}</Button>
    <Button variant="ghost" disabled={locked} onClick={() => { if (!text || window.confirm(c.leaveDraft)) onCancel(); }}>{c.cancel}</Button>
    <PageSaveState command={command} versionId={versionId} />
  </div>;
}
function CopyHandoff({ scope, requestId }: { scope: PageScope; requestId: string }) {
  const { messages, locale } = useI18n(), c = messages.workPages, [copied, setCopied] = useState(false), [failed, setFailed] = useState(false);
  const url = new URL(`/${locale}/tasks/${encodeURIComponent(scope.taskId)}/page`, window.location.origin);
  if (scope.occurrenceId) url.searchParams.set("occurrenceId", scope.occurrenceId);
  // No notes, credentials or author-provided instructions are placed on the clipboard.
  const text = `${c.continuePrompt}\n${url}\ntaskId: ${scope.taskId}\noccurrenceId: ${scope.occurrenceId ?? "null"}\nrequestId: ${requestId}\n${c.continueBoundary}`;
  async function copy() { try { await navigator.clipboard.writeText(text); setCopied(true); setFailed(false); } catch { setFailed(true); } }
  return <div className="space-y-2"><Button size="sm" variant="outline" onClick={() => void copy()}>{copied ? c.copiedHandoff : c.copyHandoff}</Button>
    {failed && <><p role="alert" className="text-sm">{c.copyFailed}</p><Textarea readOnly aria-label={c.copyHandoff} value={text} className="min-h-40" /></>}
  </div>;
}
export function PageContinuationPanel({ scope, versionId, refreshKey, onSaved }: { scope: PageScope; versionId?: string; refreshKey: number; onSaved: () => void }) {
  const c = useI18n().messages.workPages;
  const [data, setData] = useState<PageInputsView | null>(null), [error, setError] = useState(false), [open, setOpen] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(false);
    void pageRequest<PageInputsView>("read", { ...scope, view: "handoff", limit: 1 }, controller.signal).then((v) => { if (!controller.signal.aborted) setData(v); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [scope.taskId, scope.occurrenceId, versionId, refreshKey, reload]);
  if (!versionId) return null;
  const handoff = data?.handoff;
  return <section className="space-y-4 border-t pt-6" data-ui-surface-kind="product-authored" aria-label={c.handoff}>
    {error ? <div role="alert"><p>{c.error}</p><Button variant="outline" onClick={() => setReload((n) => n + 1)}>{c.retry}</Button></div> : !data ? <p role="status">{c.loading}</p> : <>
      {handoff && <div className="space-y-3">
        <h2 className="font-semibold">{handoff.latestReport ? c.handoffUpdated : c.handoffWaiting}</h2>
        <p className="whitespace-pre-wrap break-words text-sm">{handoff.request.content.text}</p>
        <p className="text-sm text-muted-foreground">{c.noAutoWake}</p>
        {handoff.newInputCount > 0 && <p className="text-sm">{c.newFeedback.replace("{count}", String(handoff.newInputCount))}</p>}
        {handoff.latestReport && <p className="text-sm text-muted-foreground">{c.reportCoverage.replace("{version}", String(handoff.latestReport.version)).replace("{count}", String(handoff.unaddressedCount))}</p>}
        <CopyHandoff scope={scope} requestId={handoff.request.id} />
      </div>}
      {!data.canRespond ? <p className="text-sm text-muted-foreground">{c.readOnly}</p> : <>
        {!open && <Button variant="outline" aria-expanded={false} onClick={() => setOpen(true)}>{c.handoff}</Button>}
        {open && <RequestEditor scope={scope} inputs={data} versionId={versionId} onCancel={() => setOpen(false)} onSaved={() => { setOpen(false); setReload((n) => n + 1); onSaved(); }} />}
      </>}
    </>}
  </section>;
}
