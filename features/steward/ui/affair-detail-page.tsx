import { PageColumn, Section, Surface } from "./layout";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Badge, Button } from "@shared/ui";
import { useAffair, useAffairControls } from "../hooks/use-affairs";
import { stateLabel, timelineLabel } from "../model/affairs";
import { AskItem } from "./ask-item";
import { ResourceStatus, MutationStatus } from "./resource-status";
import { ResultContent } from "./result-content";
import { EntryForm } from "./entry-form";
import { AffairSidebar } from "./affair-sidebar";

export function AffairDetailPage() {
  const resource = useAffair();
  return (
    <PageColumn>
      <ResourceStatus resource={resource} />
      {resource.data && (
        <AffairDetail key={resource.affairId} resource={resource} detail={resource.data} />
      )}
    </PageColumn>
  );
}
function AffairDetail({
  resource,
  detail,
}: {
  resource: ReturnType<typeof useAffair>;
  detail: NonNullable<ReturnType<typeof useAffair>["data"]>;
}) {
  const controls = useAffairControls(resource.client, detail.affair, resource.refresh);
  return (
    <>
      <AffairHeader detail={detail} controls={controls} />
      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <AffairMain resource={resource} detail={detail} controls={controls} />
        <AffairSidebar detail={detail} client={resource.client} refresh={resource.refresh} />
      </div>
    </>
  );
}

type AffairSectionProps = {
  detail: NonNullable<ReturnType<typeof useAffair>["data"]>;
  controls: ReturnType<typeof useAffairControls>;
};

function AffairHeader({ detail, controls }: AffairSectionProps) {
  const { messages, locale } = useI18n(), copy = messages.steward.affairs, a = detail.affair;
  return (
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/${locale}/affairs`}>← {copy.title}</Link>
          <Badge variant="secondary">{stateLabel(a, copy, locale, detail.asks)}</Badge>
          {a.status !== "done" && (
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                disabled={controls.pending}
                onClick={() => void controls.togglePause()}
              >
                {a.status === "paused" ? copy.resume : copy.pause}
              </Button>
              <Button
                variant="outline"
                disabled={controls.pending}
                onClick={() => controls.setConfirmEnd(true)}
              >
                {copy.end}
              </Button>
            </div>
          )}
        </div>
        {controls.confirmEnd && (
          <div role="group" aria-label={copy.confirmEnd} className="grid gap-2">
            <p>{copy.confirmEnd}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={controls.pending}
                onClick={() => void controls.update({ status: "done" })}
              >
                {copy.confirm}
              </Button>
              <Button
                variant="outline"
                disabled={controls.pending}
                onClick={() => controls.setConfirmEnd(false)}
              >
                {copy.cancel}
              </Button>
            </div>
          </div>
        )}
        <MutationStatus mutation={controls} />
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        {a.goal?.trim() && (
          <p className="max-w-prose text-muted-foreground">
            {copy.goal}: {a.goal}
          </p>
        )}
      </header>
  );
}

function AffairMain({ detail, controls, resource }: AffairSectionProps & { resource: ReturnType<typeof useAffair> }) {
  const { messages, locale } = useI18n(), copy = messages.steward.affairs, a = detail.affair;
  return (
        <main className="grid min-w-0 gap-7">
          <Section title={copy.now}>
            <Surface><div className="grid gap-3 p-5">
            <p>{a.summary}</p>
            <p>
              {copy.next}: {a.nextStep || copy.none}
            </p>
            {a.agentState === "failed" && (
              <div role="alert">
                <p>
                  {copy.failed}: {a.lastError}
                </p>
                <Button
                  disabled={controls.pending}
                  onClick={() => void controls.update({ status: "active" })}
                >
                  {messages.steward.foundation.retry}
                </Button>
              </div>
            )}
            </div></Surface>
          </Section>
          {detail.asks.length > 0 && (
            <Section title={copy.waiting} aria-label={copy.waiting}><Surface>
              {detail.asks.map((ask) => (
                <AskItem
                  key={ask.id}
                  ask={ask}
                  client={resource.client}
                  refresh={resource.refresh}
                />
              ))}
            </Surface></Section>
          )}
          {detail.latestResult ? (
            <ResultContent
              result={detail.latestResult}
              versions={detail.resultVersions}
              client={resource.client}
              refresh={resource.refresh}
            />
          ) : (
            <p>{copy.noResult}</p>
          )}
          <Section title={copy.timeline}>
            <ol className="ml-2 grid gap-6 border-l border-border pl-5">
              {detail.entries.map((entry) => (
                <li key={entry.id} className="relative grid gap-1 before:absolute before:-left-[25px] before:top-2 before:size-2 before:rounded-full before:bg-muted-foreground">
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={entry.at}>{new Date(entry.at).toLocaleString(locale)}</time> ·{" "}
                    {timelineLabel(entry, copy)}
                  </p>
                  <p className="whitespace-pre-wrap">{entry.text}</p>
                </li>
              ))}
            </ol>
            <EntryForm
              client={resource.client}
              affairId={a.id}
              kind="supplement"
              refresh={resource.refresh}
            />
          </Section>
          <details className="text-sm text-muted-foreground">
            <summary>
              {copy.technical} · {copy.toolCalls}: {detail.toolCalls}
            </summary>
            <ul>
              {detail.runs.map((run) => (
                <li key={run.id}>
                  #{run.number} · {run.status} · {copy.toolCalls}: {run.toolCalls.length}{" "}
                  {run.error}
                </li>
              ))}
            </ul>
            <h3>{copy.events}</h3>
            <ul>
              {detail.events.map((event) => (
                <li key={event.id}>
                  {event.title} · {event.status}
                  <p>{event.body}</p>
                </li>
              ))}
            </ul>
          </details>
        </main>
  );
}
