import { useState } from "react";
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, Clock3, MessageSquarePlus } from "lucide-react";
import { useI18n } from "@chrona/i18n";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";
import { WorkResultsPage } from "@features/work-results";
import type { WorkSummary, WorkView } from "@chrona/contracts";
import { deriveWorkState, formatWorkTime } from "../model/state";
import { WorkChanges, WorkHistory, WorkSignals, WorkSources } from "./work-record-panels";
import { WorkUpdateDialog, type WorkDialog } from "./work-update-dialog";
function MeetingDetails({ record }: { record: WorkSummary }) {
  const c = useI18n().messages.workRecords;
  return <Card className="min-w-0 shadow-none"><CardHeader><CardTitle className="text-base">{c.overview}</CardTitle></CardHeader><CardContent className="space-y-5">
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{record.context.agenda || c.notReported}</p>
    <dl className="grid gap-4 sm:grid-cols-2">{record.context.organizer && <div><dt className="text-xs text-muted-foreground">{c.organizer}</dt><dd className="mt-1 break-words text-sm">{record.context.organizer}</dd></div>}
      {record.context.participants.length > 0 && <div><dt className="text-xs text-muted-foreground">{c.participantsLabel}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{record.context.participants.join(" · ")}</dd></div>}
    </dl>
    {record.context.joinUrl && !record.cancelled && <Button variant="outline" size="sm" asChild><a href={record.context.joinUrl} target="_blank" rel="noopener noreferrer">{c.join}<ArrowUpRight className="size-4" /></a></Button>}
  </CardContent></Card>;
}
function WorkRecordHeader({ record, stateKey }: { record: WorkSummary; stateKey: ReturnType<typeof deriveWorkState>["stateKey"] }) {
  const { messages, locale } = useI18n(), c = messages.workRecords;
  return <header className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{record.context.kind === "meeting" ? c.meeting : c.general}</Badge><Badge variant={record.needsAttention ? "secondary" : "outline"}>{c[stateKey]}</Badge></div>
    <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{record.title}</h1>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">{record.context.window && <span className="flex min-w-0 items-start gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0" /><span>{formatWorkTime(record.context.window, locale)}<span className="ml-2 text-xs">{record.context.window.timezone}</span></span></span>}
      <span>{c.taskStatus}: {(messages.pages.goals.taskStatus as Record<string, string>)[record.taskStatus] ?? record.taskStatus}</span>
    </div>
  </header>;
}
function WorkNextStep({ record, presentation, disabled, open }: { record: WorkSummary; presentation: ReturnType<typeof deriveWorkState>; disabled: boolean; open: (mode: WorkDialog) => void }) {
  const c = useI18n().messages.workRecords;
  return <section aria-label={c.nextAction} className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div className="min-w-0"><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><ArrowRight className="size-4" />{c.nextAction}</p>
      <p className="break-words text-lg font-medium">{record.nextAction || c[presentation.nextKey]}</p>
      {(presentation.pendingCount > 0 || presentation.uncertain || presentation.mismatch) && record.nextAction && <p className="mt-2 text-sm text-muted-foreground">{c[presentation.nextKey]}</p>}
    </div><div className="flex shrink-0 flex-col gap-2">{presentation.pendingCount > 0 && <Button asChild><a href="#work-changes">{c.reviewChange}<ArrowRight className="size-4" /></a></Button>}<Button variant={presentation.pendingCount > 0 ? "outline" : "default"} disabled={disabled} onClick={() => open("report")}><MessageSquarePlus className="size-4" />{c.report}</Button></div></div>
  </section>;
}
export function WorkRecordContent({ record, view, locked, refresh, offset, setOffset, previousOffset }: { record: WorkSummary; view: WorkView; locked: boolean; refresh: () => void; offset: number; setOffset: (n: number) => void; previousOffset: number }) {
  const c = useI18n().messages.workRecords, presentation = deriveWorkState(view);
  const [dialog, setDialog] = useState<WorkDialog | null>(null), disabled = locked || !view.canWrite;
  return <>
    <WorkRecordHeader record={record} stateKey={presentation.stateKey} />
    <WorkNextStep record={record} presentation={presentation} disabled={disabled} open={setDialog} />
    {record.context.kind === "meeting" && <WorkSignals record={record} />}
    {!view.canWrite && <p className="text-sm text-muted-foreground">{c.forbidden}</p>}
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
      <div className="min-w-0 space-y-6"><WorkChanges view={view} open={setDialog} disabled={disabled} />
        <Tabs defaultValue="overview" className="min-w-0"><TabsList className="grid h-auto w-full grid-cols-3"><TabsTrigger className="min-h-11 whitespace-normal px-2 text-xs leading-tight sm:text-sm" value="overview">{c.overview}</TabsTrigger><TabsTrigger className="min-h-11 whitespace-normal px-2 text-xs leading-tight sm:text-sm" value="history">{c.history}</TabsTrigger><TabsTrigger className="min-h-11 whitespace-normal px-2 text-xs leading-tight sm:text-sm" value="results">{c.results}</TabsTrigger></TabsList>
          <TabsContent value="overview" className="space-y-4 pt-3"><MeetingDetails record={record} /><Card className="shadow-none"><CardContent className="flex items-start gap-3 pt-5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><p className="text-xs leading-relaxed text-muted-foreground">{c.authorityHint}</p></CardContent></Card></TabsContent>
          <TabsContent value="history" className="pt-5"><WorkHistory view={view} offset={offset} previousOffset={previousOffset} setOffset={setOffset} loading={locked} /></TabsContent>
          <TabsContent value="results" className="min-w-0 pt-3"><p className="mb-4 text-sm text-muted-foreground">{c.resultsHint}</p><WorkResultsPage taskId={record.taskId} embedded /></TabsContent>
        </Tabs>
      </div>
      <aside className="min-w-0 space-y-4"><WorkSources view={view} open={setDialog} disabled={disabled} />
        {record.context.kind === "meeting" && <Card className="shadow-none"><CardContent className="space-y-3 pt-5"><p className="flex items-center gap-2 text-sm font-medium"><Clock3 className="size-4" />{c.change}</p><p className="text-xs leading-relaxed text-muted-foreground">{c.changeIntro}</p><Button variant="outline" className="w-full" disabled={disabled || record.cancelled} onClick={() => setDialog("change")}>{c.change}</Button></CardContent></Card>}
      </aside>
    </div>
    {dialog && <WorkUpdateDialog record={record} mode={dialog} onClose={() => setDialog(null)} refresh={refresh} />}
  </>;
}
