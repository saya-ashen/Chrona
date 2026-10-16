import { Link } from "react-router-dom";
import type { TodayView } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Badge } from "@shared/ui";
import { PageColumn, Section, Surface } from "./layout";
import { ApprovalItem } from "./approval-item";
import { ResourceStatus } from "./resource-status";
import { useStewardSession } from "../hooks/use-steward-session";
import { pageHref, workspaceHealthy } from "../model/workspace";
import { affairOverview, plainSummary, todaySummary, todayDetail } from "../model/affair-overview";
import { formatShortDateTime } from "../model/format";

function ProgressItem({ item }: { item: TodayView["progress"][number] }) {
  const { messages, locale } = useI18n();
  const copy = messages.steward.overview;
  const c = messages.steward.affairCenter;
  const model = affairOverview(item.affair, locale, c);
  const { affair } = item;
  const [newest, ...older] = item.updates;
  const pill = affair.work?.state === "running" ? c.runningPill : affair.work?.state === "queued" ? c.queuedPill : affair.openApprovals ? c.waitingPill : null;
  return <article className="grid min-w-0 gap-1.5 px-3.5 py-3 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-baseline gap-2.5">
      <Link className="font-medium text-primary hover:underline" to={pageHref(locale, affair.id)}>{affair.title}</Link>
      {pill && <Badge role={affair.work ? "status" : undefined} variant="secondary" className={`rounded-full border-0 px-2 py-px text-xs ${affair.work?.state === "running" ? "bg-primary-soft text-primary" : affair.work ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning"}`}>{pill}</Badge>}
      <time className="ml-auto text-xs text-muted-foreground tabular-nums" dateTime={affair.lastActivityAt}>{model.updatedAt}</time>
    </div>
    {newest ? <><p className="font-medium">{plainSummary(newest.title)}</p><p className="line-clamp-3 max-w-[72ch] text-[13px] text-muted-foreground">{plainSummary(newest.body)}</p></> : <p className="line-clamp-3 text-[13px] text-muted-foreground">{model.summary}</p>}
    {(item.changedPages > 0 || model.next) && <p className="text-xs text-muted-foreground">{[item.changedPages > 0 ? copy.pages.replace("{count}", String(item.changedPages)) : null, model.next].filter(Boolean).join(" · ")}</p>}
    {older.length > 0 && <details className="text-[13px] text-muted-foreground"><summary className="cursor-pointer">{copy.earlier}</summary><div className="grid gap-3 pt-2">{older.map((update, index) => <div key={`${update.at}-${index}`}><p className="font-medium">{plainSummary(update.title)}</p><p>{plainSummary(update.body)}</p><time className="text-xs" dateTime={update.at}>{formatShortDateTime(update.at, locale)}</time></div>)}</div></details>}
  </article>;
}
export function TodayPage() {
  const { messages, locale } = useI18n();
  const { workspace: copy, foundation, overview, affairCenter } = messages.steward;
  const { today: resource } = useStewardSession();
  const view = resource.data;
  const summaryCopy = { ...foundation, working: overview.working, progress: overview.progressSummary, upcoming: overview.upcomingPart, separator: overview.separator, end: overview.end };
  return <PageColumn className="text-[15px] leading-[1.6] [&_section]:gap-2.5 [&_section>header]:justify-start [&_section>header]:gap-2 [&_h2]:text-[13px]">
    <header className="grid gap-1">
      <p className="flex gap-1 text-[13px] text-muted-foreground"><span>{new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" }).format(new Date())}</span><span>{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date())}</span></p>
      <h1 className="text-2xl font-semibold">{view ? todaySummary(view, summaryCopy) : copy.today}</h1>
      {view && todayDetail(view, summaryCopy) && <p className="max-w-[65ch] text-muted-foreground">{todayDetail(view, summaryCopy)}</p>}
    </header>
    <ResourceStatus resource={resource} />
    {view && <>
      {view.approvals.length > 0 && <Section title={foundation.decisions} count={view.approvals.length}><Surface className="overflow-hidden">{view.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={resource.client} refresh={resource.refresh} />)}</Surface></Section>}
      {(view.progress.length > 0 || view.upcoming.length > 0) && <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-7">
        {view.progress.length > 0 && <Section title={overview.progress} count={view.progress.length}><Surface>{view.progress.map(item => <ProgressItem key={item.affair.id} item={item} />)}</Surface></Section>}
        {view.upcoming.length > 0 && <Section title={foundation.upcoming} count={view.upcoming.length}><Surface>{view.upcoming.map(schedule => <article key={schedule.scheduleId} className="grid min-w-0 gap-1.5 px-3.5 py-3 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-baseline gap-2.5"><p className="font-medium">{schedule.label ?? affairCenter.followUp}</p><time className="ml-auto text-xs text-muted-foreground tabular-nums" dateTime={schedule.at}>{formatShortDateTime(schedule.at, locale)}</time></div>
          <p className="text-xs text-muted-foreground">{schedule.mode === "remind" ? copy.remind : overview.work} · <Link className="hover:underline" to={pageHref(locale, schedule.affairId)}>{schedule.affairTitle}</Link></p>
        </article>)}</Surface></Section>}
      </div>}
      <footer className="grid gap-2 text-xs text-muted-foreground">
        {view.todayPage && <Link className="underline" to={pageHref(locale, view.todayPage.affairId, view.todayPage.path)}>{overview.todayPage}</Link>}
        <p>{workspaceHealthy(view.health) ? copy.healthy : copy.unhealthy}</p>
      </footer>
    </>}
  </PageColumn>;
}
