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
    <div className="mx-auto grid w-full min-w-0 max-w-6xl gap-5 p-4 [overflow-wrap:anywhere]">
      <ResourceStatus resource={resource} />
      {resource.data && (
        <AffairDetail key={resource.affairId} resource={resource} detail={resource.data} />
      )}
    </div>
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
      <div className="grid min-w-0 items-start gap-8 min-[860px]:grid-cols-[minmax(0,1fr)_280px]">
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
            <>
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
            </>
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
          <p>
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
          <section className="grid gap-2">
            <h2 className="font-semibold">{copy.now}</h2>
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
          </section>
          {detail.asks.length > 0 && (
            <section aria-label={copy.waiting}>
              {detail.asks.map((ask) => (
                <AskItem
                  key={ask.id}
                  ask={ask}
                  client={resource.client}
                  refresh={resource.refresh}
                />
              ))}
            </section>
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
          <section className="grid gap-4">
            <h2 className="font-semibold">{copy.timeline}</h2>
            <ol className="grid gap-4">
              {detail.entries.map((entry) => (
                <li key={entry.id}>
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
          </section>
          <details>
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
