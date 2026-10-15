import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { MarkdownContent } from "@shared/ui";
import { PageColumn, Section, Surface } from "./layout";
import { ApprovalItem } from "./approval-item";
import { ResourceStatus } from "./resource-status";
import { useStewardSession } from "../hooks/use-steward-session";
import { useStewardResource } from "../hooks/use-steward";
import type { StewardClient } from "../model/client";
import { pageHref, workspaceHealthy } from "../model/workspace";

function TodayFile({ client, affairId, path }: { client: StewardClient; affairId: string; path: string }) {
  const load = useCallback((signal?: AbortSignal) => client.file(affairId, path, signal), [client, affairId, path]);
  const resource = useStewardResource(load);
  return <><ResourceStatus resource={resource} />{resource.data && <MarkdownContent>{resource.data.content}</MarkdownContent>}</>;
}
export function TodayPage() {
  const { messages, locale } = useI18n();
  const copy = messages.steward.workspace;
  const { today: resource } = useStewardSession();
  const view = resource.data;
  const time = (at: string) => <time dateTime={at}>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(at))}</time>;
  return <PageColumn>
    <h1 className="text-2xl font-semibold">{copy.today}</h1>
    <ResourceStatus resource={resource} />
    {view && <>
      {view.approvals.length > 0 && <Section title={copy.approvals}><Surface>{view.approvals.map(approval => <ApprovalItem key={approval.id} approval={approval} client={resource.client} refresh={resource.refresh} />)}</Surface></Section>}
      <Section title={copy.agenda}><Surface>{view.agenda.length === 0 ? <p className="p-4">{copy.empty}</p> : view.agenda.map(schedule => <article key={schedule.id} className="grid gap-2 p-4">
        <p>{schedule.nextAt && time(schedule.nextAt)} · <span aria-hidden="true">{schedule.mode === "remind" ? "◷" : schedule.mode === "wake" ? "✦" : "✓"}</span> {copy[schedule.mode]}</p>
        <p>{schedule.text}</p><Link className="underline" to={pageHref(locale, schedule.affairId)}>{schedule.affairTitle}</Link>
      </article>)}</Surface></Section>
      {view.todayPage && <Section title={copy.todayPage}><TodayFile client={resource.client} {...view.todayPage} /></Section>}
      {view.changes.length > 0 && <Section title={copy.changes}><Surface>{view.changes.map((change, index) => <article key={`${change.affairId}-${change.path}-${index}`} className="grid gap-2 p-4">
        <Link className="underline" to={pageHref(locale, change.affairId, change.path)}>{change.affairTitle} · {change.path}</Link><p>{change.message}</p><p className="text-sm text-muted-foreground">{copy[change.author]} · {time(change.at)}</p>
      </article>)}</Surface></Section>}
      {view.running.length > 0 && <Section title={copy.running}><Surface>{view.running.map(run => <article className="p-4" key={run.id}>{run.affairId ? <Link className="underline" to={pageHref(locale, run.affairId)}>{copy.running} · {run.provider}</Link> : <p>{copy.running} · {run.provider}</p>}{run.startedAt && time(run.startedAt)}</article>)}</Surface></Section>}
      <p className="text-sm text-muted-foreground">{workspaceHealthy(view.health) ? copy.healthy : copy.unhealthy}</p>
    </>}
  </PageColumn>;
}
