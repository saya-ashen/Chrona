import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Badge } from "@shared/ui";
import { PageColumn, Section, Surface } from "./layout";
import { useStewardSession } from "../hooks/use-steward-session";
import { useStewardResource } from "../hooks/use-steward";
import { groupWorkspaceAffairs, pageHref } from "../model/workspace";
import { ResourceStatus } from "./resource-status";

export function AffairsPage() {
  const { today: { client } } = useStewardSession();
  const load = useCallback((signal?: AbortSignal) => client.affairs(undefined, signal), [client]);
  const resource = useStewardResource(load, true);
  const { messages, locale } = useI18n();
  const copy = messages.steward.affairs, workspace = messages.steward.workspace;
  const time = (at: string) => <time dateTime={at}>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(at))}</time>;
  return <PageColumn>
    <h1 className="text-2xl font-semibold">{copy.title}</h1><ResourceStatus resource={resource} />
    {resource.data?.items.length === 0 && <p>{copy.empty}</p>}
    {resource.data && groupWorkspaceAffairs(resource.data.items).map(group => {
      if (!group.items.length) return null;
      const rows = <Surface>{group.items.map(affair => <article key={affair.id} className="grid min-w-0 gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2"><Link className="font-medium underline" to={pageHref(locale, affair.id)}>{affair.title}</Link>
          {affair.running && <Badge>{copy.running}</Badge>}
          {affair.openApprovals > 0 && <Badge variant="outline">{workspace.openApprovals} · {affair.openApprovals}</Badge>}
        </div><p>{affair.summary}</p>
        {affair.nextSchedule && <p>{workspace.next} · {time(affair.nextSchedule.at)} · {workspace[affair.nextSchedule.mode]} · {affair.nextSchedule.text}</p>}
        <p className="text-sm text-muted-foreground">{time(affair.lastActivityAt)}</p>
      </article>)}</Surface>;
      return group.key === "done" ? <details key={group.key}><summary>{copy.done} · {group.items.length}</summary>{rows}</details> : <Section key={group.key} title={copy[group.key]} count={group.items.length}>{rows}</Section>;
    })}
  </PageColumn>;
}
