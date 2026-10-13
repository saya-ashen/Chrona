import { useI18n } from "@chrona/i18n";
import type { AttentionItem } from "@chrona/contracts/steward";
import { Badge, Button, Card, CardHeader, CardTitle, CardContent } from "@shared/ui";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useAttentionDecision, useStewardClient, useStewardResource } from "../hooks/use-steward";
import { attentionDecisions, deriveToday, evidenceHref } from "../model/today";

export function TodayPage({ workspaceId }: { workspaceId: string }) {
  const { messages } = useI18n(), copy = messages.steward;
  const client = useStewardClient(workspaceId);
  const resource = useStewardResource(client.today);
  const mutation = useAttentionDecision(client, resource.refresh);
  const view = resource.data ? deriveToday(resource.data) : null;
  return <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6 p-4 [overflow-wrap:anywhere]" data-ui-surface-kind="product-authored">
    <h1 className="text-2xl font-semibold">{copy.today}</h1>
    {resource.loading && <p role="status">{copy.loading}</p>}
    {resource.error && <Alert variant="destructive"><AlertTitle>{copy.error}</AlertTitle><AlertDescription><Button onClick={resource.refresh}>{copy.retry}</Button></AlertDescription></Alert>}
    {mutation.error && <Alert variant="destructive"><AlertTitle>{copy.decisionError}</AlertTitle><AlertDescription><Button onClick={() => { mutation.clearError(); resource.refresh(); }}>{copy.retry}</Button></AlertDescription></Alert>}
    {view && <>
      {view.empty && <p role="status">{view.allClear ? copy.allClear : copy.noAttention}</p>}
      {view.issues.length > 0 && <Alert><AlertTitle>{copy.health}</AlertTitle><AlertDescription><ul className="space-y-1">{view.issues.map(issue => <li key={issue.kind}>{copy[issue.kind]}{issue.count !== null && `: ${issue.count}`}{issue.since && <p>{copy.oldestPending}: <time dateTime={issue.since}>{issue.since}</time></p>}</li>)}</ul></AlertDescription></Alert>}
      {view.sections.filter(section => section.items.length > 0).map(section => <section key={section.key} aria-labelledby={`steward-${section.key}`} className="space-y-3">
        <h2 id={`steward-${section.key}`} className="text-xl font-semibold">{copy[section.key]}</h2>
        {section.items.map(item => <AttentionCard key={item.id} item={item} mutation={mutation} />)}
      </section>)}
    </>}
  </div>;
}
function AttentionCard({ item, mutation }: { item: AttentionItem; mutation: ReturnType<typeof useAttentionDecision> }) {
  const { messages } = useI18n(), copy = messages.steward;
  return <Card className="min-w-0">
    <CardHeader><CardTitle><h3>{item.title}</h3></CardTitle><div>{copy.status}: <Badge variant="outline">{copy.statuses[item.status]}</Badge></div></CardHeader>
    <CardContent className="space-y-4">
      <dl className="space-y-3">
        <div><dt className="font-medium">{copy.what}</dt><dd className="whitespace-pre-wrap">{item.whatHappened}</dd></div>
        <div><dt className="font-medium">{copy.why}</dt><dd className="whitespace-pre-wrap">{item.whyItMatters || copy.notProvided}</dd></div>
        <div><dt className="font-medium">{copy.next}</dt><dd className="whitespace-pre-wrap">{item.nextStep || copy.notProvided}</dd></div>
      </dl>
      <div><h3 className="font-medium">{copy.evidence}</h3>{item.evidence.length === 0 ? <p>{copy.noEvidence}</p> : <ul className="space-y-2">{item.evidence.map((evidence, index) => <li key={index}>
        {evidenceHref(evidence.url) ? <a className="underline" href={evidenceHref(evidence.url)} target="_blank" rel="noopener noreferrer">{evidence.label}</a> : <span>{evidence.label}</span>}
        {evidence.excerpt && <blockquote className="whitespace-pre-wrap">{evidence.excerpt}</blockquote>}
      </li>)}</ul>}</div>
      <div className="flex flex-wrap gap-2">{attentionDecisions(item).map(decision => <Button key={decision} variant={decision === "approve" || decision === "done" ? "default" : "outline"} disabled={mutation.busy || mutation.error} onClick={() => void mutation.decide(item.id, decision)}>{copy[decision]}</Button>)}</div>
    </CardContent>
  </Card>;
}
