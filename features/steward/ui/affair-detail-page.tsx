import { useCallback, type ReactNode } from "react";
import { useI18n } from "@chrona/i18n";
import type { Affair, InboundEvent } from "@chrona/contracts";
import { Badge, Button, Card, CardContent, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@shared/ui";
import { LocalizedLink } from "./localized-link";
import { useAttentionDecision, useStewardClient, useStewardResource } from "../hooks/use-steward";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { affairStatusOptions, deriveAffair, isNotFound } from "../model/affairs";
import { evidenceHref } from "../model/today";
import { AttentionCard } from "./today-page";
import { ToolGenerator } from "./tool-generator";
import { ToolRow } from "./tool-row";
import { canFinishFollowUp } from "../model/controls";
import { StewardMutationNotice } from "./steward-mutation-notice";

export function AffairDetailPage({ workspaceId, affairId }: { workspaceId: string; affairId: string }) {
  const { messages } = useI18n(), c = messages.steward;
  const client = useStewardClient(workspaceId);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { return { detail: await client.affair(affairId, signal) }; }
    catch (error) { if (isNotFound(error)) return { detail: null }; throw error; }
  }, [client, affairId]);
  const resource = useStewardResource(load), mutation = useStewardMutation(resource.refresh);
  const attentionMutation = useAttentionDecision(client, resource.refresh);
  const detail = resource.data?.detail, view = detail ? deriveAffair(detail) : null;
  const blocked = mutation.busy || mutation.notice === "mutationError";
  return <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6 p-4 [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <LocalizedLink className="underline" href="/affairs">{c.affairs}</LocalizedLink>
    {resource.loading && <p role="status">{c.loading}</p>}
    {resource.error && <p role="alert">{c.error} <Button onClick={resource.refresh}>{c.retry}</Button></p>}
    {resource.data?.detail === null && <h1>{c.affairNotFound}</h1>}
    <StewardMutationNotice mutation={mutation} refresh={resource.refresh} />
    <AffairDecisionError mutation={attentionMutation} refresh={resource.refresh} />
    {detail && view && <>
      <header className="space-y-3"><h1 className="text-2xl font-semibold">{detail.affair.title}</h1><Badge variant="outline">{c.statuses[detail.affair.status]}</Badge>
        <Label htmlFor="affair-status">{c.status}</Label>
        <Select value={detail.affair.status} disabled={blocked} onValueChange={value => {
          const option = affairStatusOptions(c.statuses).find(option => option.value === value);
          if (option) void mutation.run(() => client.updateAffair(affairId, { status: option.value }));
        }}>
          <SelectTrigger id="affair-status" className="w-full min-w-0"><SelectValue /></SelectTrigger>
          <SelectContent>{affairStatusOptions(c.statuses).map(option =>
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </header>
      <AffairContext affair={detail.affair} />
      <AffairSection title={c.needsYou} empty={view.attention.length === 0}>{view.attention.map(item => <AttentionCard key={item.id} item={item} mutation={attentionMutation} />)}</AffairSection>
      {view.showSuggestions && <AffairSection title={c.possiblyRelated}>
        <p>{c.unconfirmedMessages}</p>
        {view.suggestedEvents.map(event => <EventCard key={event.id} event={event}>
          <div className="flex flex-wrap gap-2">
            <Button disabled={blocked} onClick={() => void mutation.run(() =>
              client.linkEvent(event.id, { decision: "confirm", affairId }))}>{c.confirmLink}</Button>
            <Button variant="outline" disabled={blocked} onClick={() => void mutation.run(() =>
              client.linkEvent(event.id, { decision: "reject", affairId }))}>{c.rejectLink}</Button>
          </div>
        </EventCard>)}
      </AffairSection>}
      <AffairSection title={c.messages} empty={view.events.length === 0}>{view.events.map(event => <EventCard key={event.id} event={event} />)}</AffairSection>
      <AffairSection title={c.delegations} empty={detail.delegations.length === 0}>{detail.delegations.map(item => <div key={item.id}><LocalizedLink className="underline" href="/delegations">{item.purpose}</LocalizedLink> <Badge variant="outline">{c.statuses[item.status]}</Badge></div>)}</AffairSection>
      <AffairSection title={c.followUps} empty={detail.followUps.length === 0}>
        {detail.followUps.map(item => <div key={item.id}>
          <p>{item.note}</p><p>{c.dueAt}: <time dateTime={item.dueAt}>{item.dueAt}</time></p>
          <Badge variant="outline">{c.followUpStatuses[item.status]}</Badge>
          {canFinishFollowUp(item.status) && <div className="flex flex-wrap gap-2">
            <Button disabled={blocked} onClick={() => void mutation.run(() =>
              client.completeFollowUp(item.id))}>{c.done}</Button>
            <Button variant="outline" disabled={blocked} onClick={() => void mutation.run(() =>
              client.cancelFollowUp(item.id))}>{c.controls.cancel}</Button>
          </div>}
        </div>)}
      </AffairSection>
      <AffairSection title={c.tools}><ToolGenerator affairId={affairId} client={client} refresh={resource.refresh} />{detail.tools.length === 0 && <p>{c.empty}</p>}{detail.tools.map(tool => <ToolRow key={tool.id} tool={tool} events={view.events} client={client} refresh={resource.refresh} />)}</AffairSection>
    </>}
  </div>;
}
function AffairContext({ affair }: { affair: Affair }) {
  const { messages } = useI18n(), c = messages.steward;
  return <dl className="space-y-3">
    <div><dt className="font-semibold">{c.goal}</dt><dd className="whitespace-pre-wrap">{affair.goal || c.notProvided}</dd></div>
    <div><dt className="font-semibold">{c.summary}</dt><dd className="whitespace-pre-wrap">{affair.summary || c.notProvided}</dd></div>
  </dl>;
}

function AffairDecisionError({ mutation, refresh }: {
  mutation: ReturnType<typeof useAttentionDecision>;
  refresh: () => void;
}) {
  const { messages } = useI18n(), c = messages.steward;
  return mutation.error && <p role="alert">{c.decisionError} <Button onClick={() => {
    mutation.clearError(); refresh();
  }}>{c.retry}</Button></p>;
}

function AffairSection({ title, empty = false, children }: { title: string; empty?: boolean; children: ReactNode }) {
  const { messages } = useI18n();
  return <section aria-label={title} className="space-y-3"><h2 className="text-xl font-semibold">{title}</h2>{empty ? <p>{messages.steward.empty}</p> : children}</section>;
}
function EventCard({ event, children }: { event: InboundEvent; children?: ReactNode }) {
  const { messages } = useI18n(), c = messages.steward;
  const href = evidenceHref(event.url ?? undefined);
  return <Card className="min-w-0"><CardContent className="space-y-2 pt-4"><h3 className="font-semibold">{event.title}</h3><p>{c.author}: {event.author || c.notProvided}</p><p className="whitespace-pre-wrap">{event.body.slice(0, 1000)}</p><time dateTime={event.occurredAt}>{event.occurredAt}</time>{href && <p><a className="underline" href={href} target="_blank" rel="noopener noreferrer">{c.sourceLink}</a></p>}{children}</CardContent></Card>;
}
