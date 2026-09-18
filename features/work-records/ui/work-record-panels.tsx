import { useI18n } from "@chrona/i18n";
import { ArrowUpRight, CalendarDays, Link2, Mail } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@shared/ui";
import { workChangeSchema, workSignalSchema, type WorkView, type WorkSummary } from "@chrona/contracts";
import { dimensions, formatWorkTime, proposalStale } from "../model/state";
import type { WorkDialog } from "./work-update-dialog";
export function WorkSignals({ record }: { record: WorkSummary }) {
  const c = useI18n().messages.workRecords;
  return <section aria-label={c.sourceReports} className="space-y-3"><p className="text-xs text-muted-foreground">{c.sourceReports}</p><dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
    {dimensions.map(d => { const signal = record.signals[d]; return <div key={d} className="min-w-0 rounded-xl border bg-card p-4"><dt className="text-sm text-muted-foreground">{d === "meeting" ? c.meetingState : c[d]}</dt>
      <dd className="mt-2 break-words font-medium">{d === "meeting" && record.cancelled ? c.cancelled : signal ? (c.states as Record<string, string>)[signal.value] ?? c.notReported : c.notReported}</dd>
      {signal && <dd className="mt-2 text-xs text-muted-foreground">{signal.actorKey.startsWith("owner:") ? c.ownerRecord : c.reportedBy}</dd>}
    </div>; })}
  </dl></section>;
}
export function WorkSources({ view, open, disabled }: { view: WorkView; open: (mode: WorkDialog) => void; disabled: boolean }) {
  const c = useI18n().messages.workRecords;
  return <Card className="min-w-0 shadow-none"><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-base">{c.sources}</CardTitle><Button size="sm" variant="ghost" disabled={disabled} onClick={() => open("source")}>{c.addSource}</Button></CardHeader>
    <CardContent className="space-y-4">{view.sources.length === 0 ? <p className="text-sm text-muted-foreground">{c.sourceEmpty}</p> : view.sources.map(source => {
      const Icon = source.kind === "email" ? Mail : source.kind === "calendar" ? CalendarDays : Link2;
      return <div key={source.id} className="flex min-w-0 items-start gap-3"><Icon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{source.label}</p><p className="break-all text-xs text-muted-foreground">{source.system} · {source.account}</p><p className="mt-1 break-all text-xs text-muted-foreground">{source.externalId}</p>
        {source.url && <Button size="sm" variant="link" className="h-auto px-0 py-1" asChild><a href={source.url} target="_blank" rel="noopener noreferrer">{c.openSource}<ArrowUpRight className="size-3" /></a></Button>}
      </div></div>;
    })}</CardContent>
  </Card>;
}
export function WorkChanges({ view, open, disabled }: { view: WorkView; open: (mode: WorkDialog) => void; disabled: boolean }) {
  const { messages, locale } = useI18n(), c = messages.workRecords;
  if (!view.pendingChanges.length || !view.record) return null;
  return <section id="work-changes" aria-label={c.pendingChanges} className="scroll-mt-4 space-y-3"><h2 className="text-base font-semibold">{c.pendingChanges}</h2>{view.pendingChanges.map(entry => {
    const change = workChangeSchema.safeParse(entry.details.change), stale = proposalStale(view.record!, entry);
    return <Card key={entry.id} className="border-amber-500/30 bg-amber-500/5 shadow-none"><CardContent className="space-y-3 pt-5">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{change.success && change.data.type === "cancel" ? c.cancelMeeting : c.reschedule}</Badge><span className="text-xs text-muted-foreground">{entry.actorKey.startsWith("owner:") ? c.ownerRecord : c.reportedBy}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm">{entry.summary}</p>
      {change.success && change.data.type === "reschedule" && <dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">{c.oldTime}</dt><dd>{formatWorkTime(view.record!.context.window, locale)}</dd></div><div><dt className="text-muted-foreground">{c.newTime}</dt><dd className="font-medium">{formatWorkTime(change.data.window, locale)} · {change.data.window.timezone}</dd></div></dl>}
      {stale && <p className="text-sm" role="status">{c.staleProposal}</p>}
      <p className="text-xs text-muted-foreground">{c.resolveHint}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled || !view.canResolve || stale || !change.success} onClick={() => open({ entry, decision: "apply" })}>{c.apply}</Button><Button size="sm" variant="outline" disabled={disabled || !view.canResolve} onClick={() => open({ entry, decision: "dismiss" })}>{c.dismiss}</Button></div>
    </CardContent></Card>;
  })}</section>;
}
function WorkEntrySignal({ value }: { value: unknown }) {
  const c = useI18n().messages.workRecords, signal = workSignalSchema.safeParse(value);
  if (!signal.success) return null;
  return <Badge variant="outline" className="mt-2">{signal.data.dimension === "meeting" ? c.meetingState : c[signal.data.dimension]} · {c.states[signal.data.value]}</Badge>;
}
export function WorkHistory({ view, offset, previousOffset, loading, setOffset }: { view: WorkView; offset: number; previousOffset: number; loading: boolean; setOffset: (offset: number) => void }) {
  const { messages, locale } = useI18n(), c = messages.workRecords;
  const labels: Record<string, string> = { capture: c.captureEntry, source: c.sourceEntry, report: c.reportEntry, propose: c.proposeEntry, resolve: c.resolveEntry };
  return <section className="space-y-5" aria-label={c.history}>
    {view.entries.length === 0 && <p className="text-muted-foreground">{c.historyEmpty}</p>}
    <ol className="space-y-0">{view.entries.map(entry => <li key={entry.id} className="relative ml-2 min-w-0 border-l pb-6 pl-6 last:border-transparent"><span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-background bg-muted-foreground" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className="text-sm font-medium">{labels[entry.kind] ?? c.reportEntry}</p><time className="text-xs text-muted-foreground" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(locale)}</time></div>
      <p className="mt-1 text-xs text-muted-foreground">{entry.actorKey.startsWith("owner:") ? c.ownerRecord : c.reportedBy}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{entry.summary}</p><WorkEntrySignal value={entry.details.signal} />
      {typeof entry.details.receiptRef === "string" && <p className="mt-2 break-all text-xs text-muted-foreground">{c.receipt}: {entry.details.receiptRef}</p>}
      {entry.kind === "resolve" && <Badge className="mt-2" variant="outline">{entry.details.decision === "apply" ? c.applied : c.dismissed}</Badge>}
    </li>)}</ol>
    <div className="flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={loading || offset === 0} onClick={() => setOffset(previousOffset)}>{c.previous}</Button><span className="text-xs text-muted-foreground">{view.total === 0 ? 0 : offset + 1}–{offset + view.entries.length} / {view.total}</span><Button size="sm" variant="outline" disabled={loading || view.nextOffset === null} onClick={() => setOffset(view.nextOffset!)}>{c.next}</Button></div>
  </section>;
}
