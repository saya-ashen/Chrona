import { useEffect, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Textarea } from "@shared/ui";
import type { PageEntry, PageInputsView } from "@chrona/contracts";
import { pageRequest, type PageScope } from "../model/client";
import { usePageCommand, useUnsavedPage } from "../hooks/use-page-command";
import { PageSaveState } from "./page-save-state";

function NoteEditor({ scope, inputs, entry, saved, cancel }: { scope: PageScope; inputs: PageInputsView; entry?: PageEntry; saved: () => void; cancel?: () => void }) {
  const c = useI18n().messages.workPages, [text, setText] = useState(entry?.content.text ?? ""), [dirty, setDirty] = useState(false);
  const [noteId, setNoteId] = useState(() => entry?.entryKey.slice(5) ?? crypto.randomUUID());
  const command = usePageCommand(scope, inputs.revision, () => { setDirty(false); if (!entry) { setText(""); setNoteId(crypto.randomUUID()); } saved(); });
  useUnsavedPage(dirty);
  const locked = command.busy || !!command.pending;
  const disabled = !inputs.canRespond || locked;
  return <div className="space-y-3">
    <Textarea aria-label={c.notes} placeholder={c.notePlaceholder} className="min-h-32 resize-y border-0 bg-muted/20 p-4 text-base shadow-none focus-visible:ring-1" value={text} maxLength={8000} disabled={disabled} onChange={(e) => { setText(e.target.value); setDirty(true); command.changed(); }} />
    <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" disabled={disabled || (!text.trim() && !entry)} onClick={() => void command.commit({ type: "note", noteId, text })}>{command.busy ? c.saving : c.saveNote}</Button>{cancel && <Button variant="ghost" size="sm" disabled={locked} onClick={cancel}>{c.cancel}</Button>}{dirty && <span className="text-xs text-muted-foreground">{c.unsaved}</span>}</div>
    <PageSaveState command={command} />
  </div>;
}
export function PageNotes({ scope, onSaved }: { scope: PageScope; onSaved?: () => void }) {
  const c = useI18n().messages.workPages, [inputs, setInputs] = useState<PageInputsView | null>(null), [offset, setOffset] = useState(0), [reload, setReload] = useState(0);
  const [error, setError] = useState(false), [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setError(false);
    void pageRequest<PageInputsView>("read", { ...scope, kind: "note", offset }, controller.signal).then((v) => { if (!controller.signal.aborted) setInputs(v); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [scope.taskId, scope.occurrenceId, offset, reload]);
  function saved() { setEditing(null); setOffset(0); setReload((n) => n + 1); onSaved?.(); }
  return <section className="space-y-5 border-t pt-8" data-ui-surface-kind="product-authored">
    <div><h2 className="text-xl font-semibold">{c.notes}</h2><p className="mt-2 text-sm text-muted-foreground">{c.notesHint}</p></div>
    {error ? <div role="alert"><p>{c.error}</p><Button variant="outline" onClick={() => setReload((n) => n + 1)}>{c.retry}</Button></div> : !inputs ? <p>{c.loading}</p> : <>
      {!inputs.canRespond && <p className="text-sm text-muted-foreground">{c.readOnly}</p>}
      {inputs.entries.map((entry) => <article key={entry.id} className="space-y-3 rounded-lg bg-muted/20 p-4">
        {editing === entry.id ? <NoteEditor scope={scope} inputs={inputs} entry={entry} saved={saved} cancel={() => setEditing(null)} /> : <><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.content.text || "—"}</p><div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><time>{new Date(entry.createdAt).toLocaleString()}</time>{inputs.canRespond && <Button variant="ghost" size="sm" onClick={() => setEditing(entry.id)}>{c.edit}</Button>}</div></>}
      </article>)}
      <div className="flex gap-2">{offset > 0 && <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>{c.recent}</Button>}{inputs.nextOffset !== null && <Button size="sm" variant="ghost" onClick={() => setOffset(inputs.nextOffset!)}>{c.loadMore}</Button>}</div>
      {inputs.canRespond && <NoteEditor scope={scope} inputs={inputs} saved={saved} />}
    </>}
  </section>;
}
export function PageInputHistory({ scope, refreshKey = 0 }: { scope: PageScope; refreshKey?: number }) {
  const c = useI18n().messages.workPages, [open, setOpen] = useState(false), [offset, setOffset] = useState(0), [data, setData] = useState<PageInputsView | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setData(null); setError(false);
    void pageRequest<PageInputsView>("read", { ...scope, view: "history", offset }, controller.signal).then(setData).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [open, offset, scope.taskId, scope.occurrenceId, refreshKey]);
  return <details className="border-t pt-5" onToggle={(e) => setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-sm text-muted-foreground">{c.history}</summary>
    {open && <div className="mt-4 space-y-4">{error ? <p role="alert">{c.error}</p> : !data ? <p>{c.loading}</p> : <>
      {!data.entries.length && <p>{c.historyEmpty}</p>}
      {data.entries.map((entry) => <div key={entry.id} className="space-y-2 border-l pl-3 text-sm"><p className="text-xs text-muted-foreground">{c[entry.kind]} · {new Date(entry.createdAt).toLocaleString()}{entry.formKey ? ` · ${entry.formKey}` : ""}</p>{entry.kind !== "response" ? <p className="whitespace-pre-wrap">{entry.content.text || "—"}</p> : <dl>{Object.entries(entry.content.answers ?? {}).map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{key}</dt><dd className="whitespace-pre-wrap break-words">{Array.isArray(value) ? value.join(", ") : String(value)}</dd></div>)}</dl>}</div>)}
      <div className="flex gap-2">{offset > 0 && <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>{c.recent}</Button>}{data.nextOffset !== null && <Button size="sm" variant="ghost" onClick={() => setOffset(data.nextOffset!)}>{c.loadMore}</Button>}</div>
    </>}</div>}
  </details>;
}
