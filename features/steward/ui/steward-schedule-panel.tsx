import { useCallback, useMemo } from "react";
import { useI18n } from "@chrona/i18n";
import { Badge, Button, Card, CardContent } from "@shared/ui";
import { useStewardClient, useStewardResource } from "../hooks/use-steward";
import { groupScheduleDays, scheduleNeedsConfirmation, stewardScheduleRange } from "../model/schedule";

export function StewardSchedulePanel({ workspaceId }: { workspaceId: string }) {
  const { messages, locale } = useI18n(), c = messages.steward;
  const client = useStewardClient(workspaceId);
  const range = useMemo(() => stewardScheduleRange(new Date()), []);
  const load = useCallback((signal?: AbortSignal) => client.schedule(range, signal), [client, range]);
  const resource = useStewardResource(load);
  const days = groupScheduleDays(resource.data?.items ?? []);
  return <section aria-label={c.stewardSchedule} className="mx-auto w-full min-w-0 max-w-4xl space-y-4 p-4 [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <h2 className="text-2xl font-semibold">{c.stewardSchedule}</h2><p>{c.nextFourteenDays}</p>
    {resource.loading && <p role="status">{c.loading}</p>}
    {resource.error && <p role="alert">{c.error} <Button onClick={resource.refresh}>{c.retry}</Button></p>}
    {resource.data && days.length === 0 && <p role="status">{c.empty}</p>}
    {days.map(({ day, items }) => <section key={day} aria-label={day} className="space-y-3"><h3 className="font-semibold"><time dateTime={day}>{new Date(`${day}T12:00:00`).toLocaleDateString(locale, { dateStyle: "full" })}</time></h3><ul className="space-y-2">{items.map(item => <li key={item.id}><Card className="min-w-0"><CardContent className="space-y-2 pt-4"><Badge variant="outline">{c.scheduleKinds[item.kind]}</Badge><p className="font-semibold">{item.title}</p><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time>{scheduleNeedsConfirmation(item) && <p className="font-semibold">{c.notConfirmed}</p>}</CardContent></Card></li>)}</ul></section>)}
  </section>;
}
