import { Link } from "react-router-dom";
import type { TodayView } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Badge } from "@shared/ui";
import { PageColumn, Section, Surface } from "./layout";
import { ApprovalItem } from "./approval-item";
import { ResourceStatus } from "./resource-status";
import { useStewardSession } from "../hooks/use-steward-session";
import { pageHref, workspaceHealthy } from "../model/workspace";
import { affairOverview, plainSummary, todaySummary } from "../model/affair-overview";
import { formatShortDateTime } from "../model/format";

function ProgressCard({ item }: { item: TodayView["progress"][number] }) {
  const { messages, locale } = useI18n();
  const copy = messages.steward.overview;
  const model = affairOverview(item.affair, locale, messages.steward.affairCenter);
  const [newest, ...older] = item.updates;
  return <Surface><article className="grid min-w-0 gap-2 p-4 [overflow-wrap:anywhere]">
    <Link className="font-medium underline" to={pageHref(locale, item.affair.id)}>{item.affair.title}</Link>
    {model.status && <p role="status">{model.status}</p>}
    {newest ? <p className="line-clamp-3"><strong>{plainSummary(newest.title)}</strong><br />{plainSummary(newest.body)}</p> : <p>{model.summary}</p>}
    <p className="text-sm text-muted-foreground">{item.changedPages > 0 && <>{copy.pages.replace("{count}", String(item.changedPages))} · </>}<time dateTime={item.affair.lastActivityAt}>{model.updatedAt}</time></p>
    {model.next && <p>{model.next}</p>}
    {older.length > 0 && <details><summary className="cursor-pointer">{copy.earlier}</summary><div className="grid gap-3 pt-2">{older.map((update, index) => <div key={`${update.at}-${index}`}><p><strong>{plainSummary(update.title)}</strong><br />{plainSummary(update.body)}</p><time className="text-sm text-muted-foreground" dateTime={update.at}>{formatShortDateTime(update.at, locale)}</time></div>)}</div></details>}
  </article></Surface>;
}
export function TodayPage() {
  const { messages, locale } = useI18n();
  const { workspace: copy, foundation, overview, affairCenter } = messages.steward;
  const { today: resource } = useStewardSession();
  const view = resource.data;
  return <PageColumn>
    <h1 className="text-2xl font-semibold">{copy.today}</h1>
    {view && <p>{todaySummary(view, { ...foundation, working: overview.working, progress: overview.progressSummary })}</p>}
    <ResourceStatus resource={resource} />
    {view && <>
      {view.approvals.length > 0 && <Section title={foundation.decisions}><div className="min-w-0 rounded-lg border-2 border-primary p-2 [overflow-wrap:anywhere]"><Surface>{view.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={resource.client} refresh={resource.refresh} />)}</Surface></div></Section>}
      {view.progress.length > 0 && <Section title={overview.progress}>{view.progress.map(item => <ProgressCard key={item.affair.id} item={item} />)}</Section>}
      {view.upcoming.length > 0 && <Section title={foundation.upcoming}><Surface>{view.upcoming.map(schedule => <article key={schedule.scheduleId} className="grid min-w-0 gap-2 p-4 [overflow-wrap:anywhere]">
        <p><time dateTime={schedule.at}>{formatShortDateTime(schedule.at, locale)}</time> · {schedule.label ?? affairCenter.followUp} · <Link className="underline" to={pageHref(locale, schedule.affairId)}>{schedule.affairTitle}</Link></p>
        <Badge variant="secondary">{schedule.mode === "remind" ? copy.remind : overview.work}</Badge>
      </article>)}</Surface></Section>}
      {view.todayPage && <Link className="underline" to={pageHref(locale, view.todayPage.affairId, view.todayPage.path)}>{overview.todayPage}</Link>}
      <p className="text-sm text-muted-foreground">{workspaceHealthy(view.health) ? copy.healthy : copy.unhealthy}</p>
    </>}
  </PageColumn>;
}
