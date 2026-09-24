import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { useI18n } from "@chrona/i18n";
import { Button, Card, CardContent, CardHeader, CardTitle, PageFrame, Skeleton } from "@shared/ui";
import { useWorkRecord } from "../hooks/use-work-records";
import { WorkRecordContent } from "./work-record-content";
import { WorkRecordEnrollment } from "./work-record-enrollment";
function EmptyWorkRecord({ loading, failed }: { loading: boolean; failed: boolean }) {
  const c = useI18n().messages.workRecords;
  if (failed) return null;
  return loading ? <div className="space-y-5"><Skeleton className="h-10 w-3/4" /><Skeleton className="h-36 w-full rounded-2xl" /><Skeleton className="h-60 w-full rounded-2xl" /></div> : <Card><CardHeader><CardTitle>{c.missing}</CardTitle></CardHeader><CardContent>{c.missingHint}</CardContent></Card>;
}
function WorkRecordBody({ state }: { state: ReturnType<typeof useWorkRecord> }) {
  const view = state.data;
  return view?.record ? <WorkRecordContent record={view.record} view={view} locked={state.loading || !!state.error} refresh={state.refresh} offset={state.offset} previousOffset={state.previousOffset} setOffset={state.setOffset} /> : <EmptyWorkRecord loading={state.loading} failed={!!state.error} />;
}
export function WorkRecordPage({ taskId, fallback, initialTitle = "" }: { taskId: string; fallback?: ReactNode; initialTitle?: string }) {
  const { messages, locale } = useI18n(), c = messages.workRecords, state = useWorkRecord(taskId);
  const view = state.data;
  const canEnroll = !state.loading && !state.error && view?.record === null;
  if (canEnroll && fallback) return <><WorkRecordEnrollment taskId={taskId} title={initialTitle} view={view} refresh={state.refresh} />{fallback}</>;
  return <PageFrame mode="main" data-domain="work-records" className="min-w-0 p-2 sm:p-4">
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 pb-10" data-ui-surface-kind="product-authored">
      <nav className="flex flex-wrap items-center justify-between gap-2"><Button variant="ghost" size="sm" asChild><Link to={`/${locale}/work`}><ArrowLeft className="size-4" />{c.back}</Link></Button><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={state.refresh} disabled={state.loading}><RefreshCw className="size-4" />{c.refresh}</Button><Button variant="outline" size="sm" asChild><Link to={`/${locale}/tasks/${encodeURIComponent(taskId)}?view=execution`}>{c.taskDetails}<ArrowUpRight className="size-3" /></Link></Button></div></nav>
      {state.error && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">{c[state.error]}</p>}
      {canEnroll && initialTitle && <WorkRecordEnrollment taskId={taskId} title={initialTitle} view={view} refresh={state.refresh} />}
      {state.loading && <p role="status" className="text-sm text-muted-foreground">{c.loading}</p>}
      <WorkRecordBody state={state} />
    </div>
  </PageFrame>;
}
