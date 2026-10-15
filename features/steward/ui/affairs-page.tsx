import { PageColumn, Section, Surface } from "./layout";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Badge } from "@shared/ui";
import { useAffairs } from "../hooks/use-affairs";
import { affairState, groupAffairs, stateLabel } from "../model/affairs";
import { relativeTime } from "../model/today";
import { formatCadence } from "../model/format";
import { ResourceStatus } from "./resource-status";

export function AffairsPage() {
  const resource = useAffairs(),
    { messages, locale } = useI18n(),
    copy = messages.steward.affairs;
  const now = new Date().toISOString();
  return (
    <PageColumn>
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <ResourceStatus resource={resource} />
      {resource.data?.items.length === 0 && <p>{copy.empty}</p>}
      {resource.data &&
        groupAffairs(resource.data.items).map((group) => {
          const rows = group.items.map((a) => (
            <article key={a.id} className="grid min-w-0 gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className="font-medium underline"
                  to={`/${locale}/affairs/${encodeURIComponent(a.id)}`}
                >
                  {a.title}
                </Link>
                <Badge
                  variant="secondary"
                  className={
                    affairState(a) === "waiting"
                      ? "bg-warning/10 text-warning"
                      : affairState(a) === "running"
                        ? "bg-primary/10 text-primary"
                        : affairState(a) === "failed"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-muted-foreground"
                  }
                >
                  {stateLabel(a, copy, locale)}
                </Badge>
                <time className="text-sm text-muted-foreground" dateTime={a.lastActivityAt}>
                  {relativeTime(a.lastActivityAt, now, locale)}
                </time>
              </div>
              <p className="line-clamp-2">{a.summary}</p>
              {a.nextStep && (
                <p className="text-sm text-muted-foreground">
                  {copy.next}: {a.nextStep}
                </p>
              )}
              {a.care && (
                <p className="text-sm">
                  {formatCadence(a.care.cadenceSeconds, copy.cadence, locale)}
                  {a.care.nextCheckAt && (
                    <>
                      {" "}
                      · {copy.nextCheck}:{" "}
                      <time dateTime={a.care.nextCheckAt}>
                        {relativeTime(a.care.nextCheckAt, now, locale)}
                      </time>
                    </>
                  )}
                </p>
              )}
            </article>
          ));
          return group.key === "done" ? (
            <details key={group.key}>
              <summary>
                {copy.done} · {group.items.length}
              </summary>
              <Surface className="mt-3">{rows}</Surface>
            </details>
          ) : group.items.length > 0 ? (
            <Section key={group.key} title={copy[group.key]} count={group.items.length} aria-label={copy[group.key]}>
              <Surface>{rows}</Surface>
            </Section>
          ) : null;
        })}
    </PageColumn>
  );
}
