import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CircleCheck } from "lucide-react";
import { useI18n } from "@chrona/i18n";
import { Badge, Button, Card, CardContent } from "@shared/ui";
import type { WorkSummary } from "@chrona/contracts";
import type { useWorkInbox } from "../hooks/use-work-records";
import { formatWorkTime } from "../model/state";
function WorkInboxRow({ record }: { record: WorkSummary }) {
  const { messages, locale } = useI18n(), c = messages.workRecords;
  return <li><Link className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" to={`/${locale}/tasks/${encodeURIComponent(record.taskId)}`}><Card className="min-w-0 shadow-none transition-colors group-hover:border-primary/40"><CardContent className="flex min-w-0 items-start gap-4 p-5"><div className="hidden rounded-lg bg-muted p-2.5 sm:block"><CalendarDays className="size-5 text-muted-foreground" /></div><div className="min-w-0 flex-1 space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold">{record.title}</h3><Badge variant="outline">{record.cancelled ? c.cancelled : record.needsAttention ? c.needsAttention : c.upToDate}</Badge></div>
    {record.context.window && <p className="text-xs text-muted-foreground">{formatWorkTime(record.context.window, locale)} · {record.context.window.timezone}</p>}
    <p className="break-words text-sm text-muted-foreground">{c.nextAction} · {record.nextAction || c.chooseNext}</p></div><ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" /></CardContent></Card></Link></li>;
}
function EmptyWorkInbox({ attentionOnly, canWrite, capture, hasQuery }: { attentionOnly: boolean; canWrite: boolean; capture: () => void; hasQuery: boolean }) {
  const c = useI18n().messages.workRecords;
  return <Card className="border-dashed shadow-none"><CardContent className="flex flex-col items-center gap-3 px-5 py-12 text-center"><CircleCheck className="size-8 text-muted-foreground" /><h3 className="font-medium">{hasQuery ? c.noMatches : attentionOnly ? c.caughtUp : c.empty}</h3><p className="max-w-md text-sm text-muted-foreground">{hasQuery ? c.noMatchesHint : attentionOnly ? c.caughtUpHint : c.emptyHint}</p>{!attentionOnly && !hasQuery && <Button variant="outline" disabled={!canWrite} onClick={capture}>{c.create}</Button>}</CardContent></Card>;
}
export function WorkInboxResults({ state, attentionOnly, canWrite, capture, hasQuery }: { state: ReturnType<typeof useWorkInbox>; attentionOnly: boolean; canWrite: boolean; capture: () => void; hasQuery: boolean }) {
  const c = useI18n().messages.workRecords, data = state.data;
  if (!data) return null;
  return <>
    {!state.loading && !state.error && data.items.length === 0 && <EmptyWorkInbox attentionOnly={attentionOnly} canWrite={canWrite} capture={capture} hasQuery={hasQuery} />}
    <ul className="space-y-3">{data.items.map(record => <WorkInboxRow key={record.taskId} record={record} />)}</ul>
    {(state.offset > 0 || data.nextOffset !== null) && <div className="flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={state.loading || state.offset === 0} onClick={() => state.setOffset(state.previousOffset)}>{c.previous}</Button><span className="text-xs text-muted-foreground">{data.total}</span><Button size="sm" variant="outline" disabled={state.loading || data.nextOffset === null} onClick={() => state.setOffset(data.nextOffset!)}>{c.next}</Button></div>}
  </>;
}
