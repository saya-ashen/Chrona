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
  return <PageColumn>
    <h1 className="text-2xl font-semibold">{copy.title}</h1><ResourceStatus resource={resource} />
    {resource.data?.items.length === 0 && <p>{copy.empty}</p>}
    {resource.data && groupWorkspaceAffairs(resource.data.items).map(group => {
      if (!group.items.length) return null;
      const rows = <Surface>{group.items.map(affair => {
        const model = affairOverview(affair, locale, messages.steward.affairCenter);
        return <article key={affair.id} className="grid min-w-0 gap-2 p-4 [overflow-wrap:anywhere]">
          <Link className="font-medium underline" to={pageHref(locale, affair.id)}>{affair.title}</Link>
          {affair.openApprovals > 0 ? <Badge>{decisions}</Badge> : model.status && <p role="status">{model.status}</p>}
          <p>{model.summary}</p>
          {model.next && <p>{model.next}</p>}
          <p className="text-sm text-muted-foreground"><time dateTime={affair.lastActivityAt}>{model.updatedAt}</time></p>
        </article>;
      })}</Surface>;
      return group.key === "done" ? <details key={group.key}><summary>{copy.done} · {group.items.length}</summary>{rows}</details> : <Section key={group.key} title={group.key === "waiting" ? decisions : copy[group.key]} count={group.items.length}>{rows}</Section>;
    })}
  </PageColumn>;
}
