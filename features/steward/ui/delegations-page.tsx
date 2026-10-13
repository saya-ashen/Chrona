import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { STEWARD_ACTIONS, type StewardAction, type Delegation } from "@chrona/contracts/steward";
import { Badge, Button, Card, CardContent, Checkbox, Input, Label, Textarea, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@shared/ui";
import { useStewardClient, useStewardResource } from "../hooks/use-steward";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { delegationTransitions, pilotDenied } from "../model/management";

export function DelegationsPage({ workspaceId }: { workspaceId: string }) {
  const { messages } = useI18n(), c = messages.steward;
  const client = useStewardClient(workspaceId), resource = useStewardResource(client.delegations), connections = useStewardResource(client.connections);
  const mutation = useStewardMutation(resource.refresh);
  const [purpose, setPurpose] = useState(""), [wording, setWording] = useState(""), [connection, setConnection] = useState("none"), [cadence, setCadence] = useState("");
  const [allowed, setAllowed] = useState<StewardAction[]>([]), [ask, setAsk] = useState<StewardAction[]>([]);
  return <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 p-4 [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <h1 className="text-2xl font-semibold">{c.delegations}</h1>
    {resource.loading && <p role="status">{c.loading}</p>}
    {resource.error && <p role="alert">{c.error} <Button onClick={resource.refresh}>{c.retry}</Button></p>}
    {mutation.notice && <p role={mutation.notice === "mutationError" ? "alert" : "status"}>{c[mutation.notice]}{mutation.notice === "mutationError" && <Button onClick={() => { mutation.reset(); resource.refresh(); }}>{c.retry}</Button>}</p>}
    {resource.data?.items.length === 0 && <p role="status">{c.empty}</p>}
    <ul className="space-y-3">{resource.data?.items.map(item => <li key={item.id}><Card><CardContent className="space-y-3 pt-4">
      <h2 className="font-semibold">{item.purpose}</h2><Badge variant="outline">{c.statuses[item.status]}</Badge>
      <DelegationFacts item={item} />
      <div className="flex flex-wrap gap-2">{delegationTransitions(item.status).map(action => <Button key={action} variant="outline" disabled={mutation.busy || mutation.notice === "mutationError" || resource.loading} onClick={() => void mutation.run(() => client.transitionDelegation(item.id, { action, expectedRevision: item.revision }))}>{c[action]}</Button>)}</div>
    </CardContent></Card></li>)}</ul>
    <section className="space-y-3"><h2 className="text-xl font-semibold">{c.newDelegation}</h2><p>{c.proposalHint}</p>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void mutation.run(() => client.proposeDelegation({ purpose, originalWording: wording, ...(connection === "none" ? {} : { connectionId: connection }), ...(cadence ? { cadenceSeconds: Number(cadence) } : {}), allowedActions: allowed, askFirstActions: ask })).then(saved => { if (saved) { setPurpose(""); setWording(""); setAllowed([]); setAsk([]); } }); }}>
        <Label htmlFor="delegation-purpose">{c.purpose}</Label><Input id="delegation-purpose" required maxLength={4000} value={purpose} onChange={e => setPurpose(e.target.value)} />
        <Label htmlFor="delegation-wording">{c.originalWording}</Label><Textarea id="delegation-wording" maxLength={4000} value={wording} onChange={e => setWording(e.target.value)} />
        <Label htmlFor="delegation-connection">{c.connection}</Label><Select value={connection} onValueChange={setConnection}><SelectTrigger id="delegation-connection" className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{c.noConnection}</SelectItem>{connections.data?.items.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
        {connections.loading && <p>{c.loading}</p>}{connections.error && <p role="alert">{c.error}<Button type="button" onClick={connections.refresh}>{c.retry}</Button></p>}
        <Label htmlFor="delegation-cadence">{c.cadence}</Label><Input id="delegation-cadence" type="number" min={60} max={604800} step={1} value={cadence} onChange={e => setCadence(e.target.value)} />
        {([{ key: "allowedActions", values: allowed, set: setAllowed }, { key: "askFirstActions", values: ask, set: setAsk }] as const).map(group => <fieldset key={group.key} className="space-y-2"><legend className="font-medium">{c[group.key]}</legend>{STEWARD_ACTIONS.map(action => <div key={action} className="flex items-start gap-2"><Checkbox id={`${group.key}-${action}`} disabled={pilotDenied(action)} checked={group.values.includes(action)} onCheckedChange={checked => group.set(values => checked === true ? [...values, action] : values.filter(value => value !== action))} aria-describedby={pilotDenied(action) ? "pilot-denied" : undefined} /><Label htmlFor={`${group.key}-${action}`}>{c.actionLabels[action]}</Label></div>)}</fieldset>)}
        <p id="pilot-denied">{c.pilotDenied}</p><Button type="submit" disabled={mutation.busy || mutation.notice === "mutationError"}>{c.propose}</Button>
      </form>
    </section>
  </div>;
}
function DelegationFacts({ item }: { item: Delegation }) {
  const { messages } = useI18n(), c = messages.steward;
  const rows = [ [c.originalWording, item.originalWording], [c.cadence, item.cadenceSeconds], [c.allowedActions, item.allowedActions.map(action => c.actionLabels[action]).join(", ")], [c.askFirstActions, item.askFirstActions.map(action => c.actionLabels[action]).join(", ")], [c.notificationMode, c[item.notification.mode]], [c.lastCheck, item.lastCheckAt], [c.lastSuccess, item.lastSuccessAt], [c.lastFailure, item.lastFailureAt], [c.lastError, item.lastError], [c.expiresAt, item.expiresAt] ];
  return <dl className="space-y-2">{rows.map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap">{value ?? c.notProvided}{value === "" && c.notProvided}</dd></div>)}</dl>;
}
