import { Link } from "react-router-dom";
import { localizeHref, useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import { useWorkRecord } from "../hooks/use-work-records";
import { deriveWorkState, formatWorkTime } from "../model/state";
/** Product-owned context. Important schedule/uncertainty signals must not disappear behind an authored page. */
export function WorkRecordSummary({ taskId }: { taskId: string }) {
  const { messages, locale } = useI18n(), c = messages.workRecords, state = useWorkRecord(taskId);
  if (state.loading) return <p role="status" className="text-xs text-muted-foreground">{c.loading}</p>;
  if (state.error) return <div role="alert" className="text-sm"><p>{c[state.error]}</p><Button size="sm" variant="ghost" onClick={state.refresh}>{c.refresh}</Button></div>;
  const record = state.data?.record;
  if (!state.data || !record) return null;
  const derived = deriveWorkState(state.data);
  const important = [derived.pendingCount > 0, derived.uncertain, derived.mismatch, record.cancelled].some(Boolean);
  if (![record.context.window, record.nextAction, important].some(Boolean)) return null;
  return <aside className="space-y-3 rounded-xl border bg-muted/20 p-4" data-ui-surface-kind="product-authored">
    {record.context.window && <p className="text-sm font-medium">{formatWorkTime(record.context.window, locale)}</p>}
    {important && <p className="font-medium">{c[derived.nextKey]}</p>}
    {record.nextAction && <p className="whitespace-pre-wrap text-sm">{record.nextAction}</p>}
    <Button size="sm" variant="outline" asChild><Link to={localizeHref(locale, `/tasks/${taskId}/work`)}>{important ? c.reviewChange : messages.workPages.workRecord}</Link></Button>
  </aside>;
}
