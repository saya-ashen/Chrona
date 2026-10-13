import { useCallback, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { CONNECTION_KINDS, EVENT_STATUSES, type ConnectionKind, type EventStatus, type SyncResult } from "@chrona/contracts";
import { Badge, Button, Card, CardContent, Input, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@shared/ui";
import { useStewardClient, useStewardResource } from "../hooks/use-steward";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { canAcknowledge, canSync, connectionTransitions, connectionWarning } from "../model/management";

export function ConnectionsPage({ workspaceId }: { workspaceId: string }) {
  const { messages } = useI18n(), c = messages.steward;
  const client = useStewardClient(workspaceId), resource = useStewardResource(client.connections);
  const [filter, setFilter] = useState<EventStatus | "all">("all");
  const loadEvents = useCallback((signal?: AbortSignal) => client.events(filter === "all" ? {} : { status: filter }, signal), [client, filter]);
  const events = useStewardResource(loadEvents), notifications = useStewardResource(client.notifications);
  const mutation = useStewardMutation(() => { resource.refresh(); events.refresh(); notifications.refresh(); });
  const [kind, setKind] = useState<ConnectionKind>("local_test"), [label, setLabel] = useState("");
  const [sync, setSync] = useState<{ id: string; result: SyncResult } | null>(null);
  const disabled = mutation.busy || mutation.notice === "mutationError";
  return <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 p-4 [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <h1 className="text-2xl font-semibold">{c.connections}</h1>
    {resource.loading && <p role="status">{c.loading}</p>}
    {resource.error && <p role="alert">{c.error}<Button onClick={resource.refresh}>{c.retry}</Button></p>}
    {mutation.notice && <p role={mutation.notice === "mutationError" ? "alert" : "status"}>{c[mutation.notice]}{mutation.notice === "mutationError" && <Button onClick={() => { mutation.reset(); resource.refresh(); events.refresh(); notifications.refresh(); }}>{c.retry}</Button>}</p>}
    {resource.data?.items.length === 0 && <p role="status">{c.empty}</p>}
    <ul className="space-y-3">{resource.data?.items.map(item => <li key={item.id}><Card><CardContent className="space-y-3 pt-4">
      <h2 className="font-semibold">{item.label}</h2>{item.kind === "local_test" && <Badge>{c.testData}</Badge>}
      <p>{c.status}: <Badge variant={connectionWarning(item.status) ? "destructive" : "outline"}>{c.statuses[item.status]}</Badge></p>
      <dl className="space-y-2">{[[c.kind, c[item.kind]], [c.mode, c[item.mode]], [c.readScopes, item.readScopes.join(", ")], [c.writeScopes, item.writeScopes.join(", ")], [c.lastSuccess, item.lastSuccessAt], [c.lastFailure, item.lastFailureAt], [c.lastError, item.lastError], [c.nextCheck, item.nextCheckAt], [c.pendingEvents, item.pendingEvents], [c.failedEvents, item.failedEvents]].map(([name, value]) => <div key={name}><dt className="font-medium">{name}</dt><dd>{value === "" || value == null ? c.notProvided : value}</dd></div>)}</dl>
      <h3 className="font-medium">{c.coverage}</h3><p className="whitespace-pre-wrap">{item.coverageNote}</p>
      {sync?.id === item.id && <p role="status">{c.received}: {sync.result.received}; {c.duplicates}: {sync.result.duplicates}; {c.baseline}: {sync.result.baseline ? c.yes : c.no}</p>}
      <div className="flex flex-wrap gap-2">{canSync(item.status) && <Button disabled={disabled} onClick={() => { setSync(null); void mutation.run(async () => { const result = await client.syncConnection(item.id); setSync({ id: item.id, result }); }); }}>{c.sync}</Button>}{connectionTransitions(item.status).map(action => <Button key={action} variant="outline" disabled={disabled} onClick={() => void mutation.run(() => client.transitionConnection(item.id, { action }))}>{c[action]}</Button>)}</div>
    </CardContent></Card></li>)}</ul>
    <section className="space-y-3"><h2 className="text-xl font-semibold">{c.newConnection}</h2><form className="space-y-3" onSubmit={event => { event.preventDefault(); void mutation.run(() => client.createConnection({ kind, label })).then(saved => { if (saved) setLabel(""); }); }}>
      <Label htmlFor="connection-kind">{c.kind}</Label><Select value={kind} onValueChange={value => setKind(value as ConnectionKind)}><SelectTrigger id="connection-kind" className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{CONNECTION_KINDS.map(value => <SelectItem key={value} value={value}>{c[value]}</SelectItem>)}</SelectContent></Select>
      <Label htmlFor="connection-label">{c.label}</Label><Input id="connection-label" required maxLength={200} value={label} onChange={e => setLabel(e.target.value)} /><Button disabled={disabled} type="submit">{c.create}</Button>
    </form></section>
    <details className="space-y-3"><summary className="cursor-pointer font-semibold">{c.rawInbox}</summary>
      <Label htmlFor="event-filter">{c.status}</Label><Select value={filter} onValueChange={value => setFilter(value as EventStatus | "all")}><SelectTrigger id="event-filter" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{c.allStatuses}</SelectItem>{EVENT_STATUSES.map(value => <SelectItem key={value} value={value}>{c.eventStatuses[value]}</SelectItem>)}</SelectContent></Select>
      {events.loading && <p role="status">{c.loading}</p>}{events.error && <p role="alert">{c.error}<Button onClick={events.refresh}>{c.retry}</Button></p>}{events.data?.items.length === 0 && <p>{c.empty}</p>}
      <ul className="space-y-3">{events.data?.items.map(item => <li key={item.id}><Card><CardContent className="space-y-2 pt-4"><h3>{item.title}</h3><Badge variant="outline">{c.eventStatuses[item.status]}</Badge><p>{c.linkStatus}: {c.linkStatuses[item.linkStatus]}</p><p>{c.attempts}: {item.attempts}</p><p>{c.lastError}: {item.lastError ?? c.notProvided}</p></CardContent></Card></li>)}</ul>
    </details>
    <details className="space-y-3"><summary className="cursor-pointer font-semibold">{c.deliveryLog}</summary>
      {notifications.loading && <p role="status">{c.loading}</p>}{notifications.error && <p role="alert">{c.error}<Button onClick={notifications.refresh}>{c.retry}</Button></p>}{notifications.data?.items.length === 0 && <p>{c.empty}</p>}
      <ul className="space-y-3">{notifications.data?.items.map(item => <li key={item.id}><Card><CardContent className="space-y-2 pt-4"><h3>{item.title}</h3><Badge variant="outline">{c.notificationStatuses[item.status]}</Badge><p className="whitespace-pre-wrap">{item.body}</p><p>{c.attempts}: {item.attempts}</p><p>{c.lastError}: {item.lastError ?? c.notProvided}</p>{canAcknowledge(item.status) && <Button disabled={disabled} onClick={() => void mutation.run(() => client.acknowledgeNotification(item.id))}>{c.acknowledge}</Button>}</CardContent></Card></li>)}</ul>
    </details>
  </div>;
}
