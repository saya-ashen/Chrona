import { useI18n } from "@chrona/i18n";
import { Badge, Button } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { useStewardResource } from "../hooks/use-steward";
import { WorkTextForm } from "./work-section";
import { LocalizedLink } from "./localized-link";
export function TodayWork({ client }: { client: StewardClient }) {
  const { messages } = useI18n(), c = messages.steward, resource = useStewardResource(client.openWorks);
  return <section aria-label={c.work.inProgress} className="space-y-3">
    <h2 className="text-xl font-semibold">{c.work.inProgress}</h2>
    {resource.loading && <p>{c.loading}</p>}
    {resource.error && <p role="alert">{c.error}<Button onClick={resource.refresh}>{c.retry}</Button></p>}
    {resource.data?.length === 0 && <p>{c.empty}</p>}
    <ul>{resource.data?.map(w => <li key={w.id}><LocalizedLink className="underline" href={`/affairs/${encodeURIComponent(w.affairId)}`}>{w.request}</LocalizedLink> <Badge variant="outline">{c.work.statuses[w.status]}</Badge></li>)}</ul>
    <WorkTextForm label={c.work.ask} maxLength={2000} submit={client.createWork} refresh={resource.refresh} />
  </section>;
}
