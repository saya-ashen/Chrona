import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Badge } from "@shared/ui";
import { PageColumn, Section, Surface } from "./layout";
import { useStewardSession } from "../hooks/use-steward-session";
import { useStewardResource } from "../hooks/use-steward";
import { groupWorkspaceAffairs, pageHref } from "../model/workspace";
import { ResourceStatus } from "./resource-status";
import { affairOverview } from "../model/affair-overview";

export function AffairsPage() {
  const { today: { client } } = useStewardSession();
  const load = useCallback((signal?: AbortSignal) => client.affairs(undefined, signal), [client]);
  const resource = useStewardResource(load, true);
  const { messages, locale } = useI18n();
  const copy = messages.steward.affairs;
  const decisions = messages.steward.foundation.decisions;
  return <PageColumn className="text-[15px] leading-[1.6] [&_section]:gap-2.5 [&_section>header]:justify-start [&_section>header]:gap-2 [&_h2]:text-[13px]">
    <h1 className="text-2xl font-semibold">{copy.title}</h1><ResourceStatus resource={resource} />
    {resource.data?.items.length === 0 && <p>{copy.empty}</p>}
    {resource.data && groupWorkspaceAffairs(resource.data.items).map(group => {
      if (!group.items.length) return null;
      const rows = <Surface>{group.items.map(affair => {
        const model = affairOverview(affair, locale, messages.steward.affairCenter);
        const c = messages.steward.affairCenter;
        const pill = affair.work?.state === "running" ? c.runningPill : affair.work?.state === "queued" ? c.queuedPill : affair.openApprovals ? c.waitingPill : affair.status === "active" ? c.activePill : copy[affair.status];
        return <article key={affair.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-3.5 py-3 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-baseline gap-2">
            <Link className="font-medium text-primary hover:underline" to={pageHref(locale, affair.id)}>{affair.title}</Link>
            <Badge variant="secondary" className={`rounded-full border-0 px-2 py-px text-xs ${affair.openApprovals && !affair.work ? "bg-warning/10 text-warning" : affair.work?.state === "running" || affair.status === "active" && !affair.work ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"}`}>{pill}</Badge>
          </div>
          <time className="text-xs text-muted-foreground tabular-nums" dateTime={affair.lastActivityAt}>{model.updatedAt}</time>
          <p className="col-span-full line-clamp-2 text-[13px] text-muted-foreground">{model.summary}</p>
          {model.next && <p className="col-span-full text-xs text-muted-foreground">{model.next}</p>}
        </article>;
      })}</Surface>;
      return group.key === "done" ? <details key={group.key}><summary className="cursor-pointer text-[13px] text-muted-foreground">{copy.done} · {group.items.length}</summary>{rows}</details> : <Section key={group.key} title={group.key === "waiting" ? decisions : copy[group.key]} count={group.items.length}>{rows}</Section>;
    })}
  </PageColumn>;
}
