import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { PageColumn, Section, Surface } from "./layout";
import { ApprovalItem } from "./approval-item";
import { ResourceStatus } from "./resource-status";
import { useStewardSession } from "../hooks/use-steward-session";
import { pageHref, workspaceHealthy } from "../model/workspace";
import { formatShortDateTime } from "../model/format";
import { ProviderWork } from "./provider-work";

export function TodayPage() {
  const { messages, locale } = useI18n();
  const c = messages.steward;
  const { today: resource } = useStewardSession();
  const view = resource.data;
  return <PageColumn>
    <h1 className="text-2xl font-semibold">{c.shell.today}</h1>
    <ResourceStatus resource={resource} />
    {view && <>
      <Section title={c.foundation.decisions} count={view.approvals.length}><Surface>
        {view.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={resource.client} refresh={resource.refresh} />)}
        {!view.approvals.length && <p className="p-3">{c.foundation.clear}</p>}
      </Surface></Section>
      <ProviderWork client={resource.client} mode="summary" onChange={resource.refresh} />
      <Section title={c.foundation.upcoming} count={view.upcoming.length}><Surface>
        {view.upcoming.map(schedule => <article key={schedule.scheduleId} className="flex flex-wrap gap-3 p-3">
          <p>{schedule.label ?? (schedule.mode === "module" ? c.apps.title : c.workspace.wake)}</p>
          <time className="ml-auto text-xs" dateTime={schedule.at}>{formatShortDateTime(schedule.at, locale)}</time>
        </article>)}
        {!view.upcoming.length && <p className="p-3">{c.apps.none}</p>}
      </Surface></Section>
      <Section title={c.overview.updates} count={view.updates.length}><Surface>
        {view.updates.map(update => <article key={update.id} className="grid gap-1 p-3"><h3 className="font-medium">{update.title}</h3><p className="whitespace-pre-wrap">{update.body}</p><time className="text-xs text-muted-foreground" dateTime={update.createdAt}>{formatShortDateTime(update.createdAt, locale)}</time></article>)}
        {!view.updates.length && <p className="p-3">{c.apps.none}</p>}
      </Surface></Section>
      <Section title={c.apps.title} count={view.apps.length}><Surface>
        {view.apps.map(app => <Link key={app.id} className="grid gap-1 p-3 hover:underline" to={pageHref(locale, app.id)}><span className="font-medium">{app.name}</span><span className="text-sm text-muted-foreground">{app.description} · {c.apps[app.status]}</span></Link>)}
        {!view.apps.length && <p className="p-3">{c.apps.empty}</p>}
      </Surface></Section>
      <Section title={c.sessions.title} count={view.sessions.length}><Surface>
        {view.sessions.map(session => <Link key={session.id} className="p-3 hover:underline" to={`/${locale}/chat?sessionId=${encodeURIComponent(session.id)}`}>{session.title ?? c.sessions.untitled} · {session.source}</Link>)}
        {!view.sessions.length && <p className="p-3">{c.sessions.empty}</p>}
      </Surface></Section>
      {!view.health.moduleSandbox && <p role="alert" className="text-sm text-destructive">{c.workspace.noSandbox}</p>}
      <p className="text-xs text-muted-foreground">{workspaceHealthy(view.health) ? c.workspace.healthy : c.workspace.unhealthy}</p>
    </>}
  </PageColumn>;
}
