import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Button, Skeleton } from "@shared/ui";
import { AskItem } from "./ask-item";
import { useStewardSession } from "../hooks/use-steward-session";
import { headline, summary, healthProblems, relativeTime, visibleSections } from "../model/today";

function TodayHeader({ view }: { view: NonNullable<ReturnType<typeof useStewardSession>["today"]["data"]> }) {
  const { messages, locale } = useI18n();
  const copy = messages.steward.foundation;
  return (
    <header className="space-y-1">
      <time className="text-sm text-muted-foreground" dateTime={view.generatedAt}>
        {new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" }).format(new Date(view.generatedAt))}
      </time>
      <h1 className="text-2xl font-semibold">{headline(view.counts, copy)}</h1>
      <p className="text-muted-foreground">{summary(view.counts, copy.summary)}</p>
    </header>
  );
}

function TodayHealth({ view }: { view: NonNullable<ReturnType<typeof useStewardSession>["today"]["data"]> }) {
  const { messages } = useI18n();
  const copy = messages.steward.foundation;
  return healthProblems(view).length > 0 && (
    <p role="alert" className="text-sm text-muted-foreground">
      {healthProblems(view).map((key) => copy[key]).join(" · ")}
    </p>
  );
}

function TodayLoading() {
  const { messages } = useI18n();
  return (
    <div role="status" aria-label={messages.steward.foundation.loading}>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function TodayPage() {
  const { messages, locale } = useI18n();
  const copy = messages.steward.foundation;
  const { today: resource } = useStewardSession();
  const view = resource.data;
  const affairHref = (id: string) => `/${locale}/affairs/${encodeURIComponent(id)}`;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl gap-7 p-4 [overflow-wrap:anywhere]">
      {resource.loading && !view && <TodayLoading />}
      {resource.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {copy[resource.error.messageKey]}
            <Button onClick={resource.refresh}>{copy.retry}</Button>
          </AlertDescription>
        </Alert>
      )}
      {view && (
        <>
          <TodayHeader view={view} />
          <div className="grid items-start gap-7 min-[860px]:grid-cols-2">
            {visibleSections(view).map((section) => (
              <section
                key={section}
                aria-labelledby={`today-${section}`}
                className={
                  section === "decisions" ? "grid gap-3 min-[860px]:col-span-2" : "grid gap-3"
                }
              >
                <h2 id={`today-${section}`} className="text-sm font-semibold text-muted-foreground">
                  {copy[section]}
                </h2>
                <div
                  className={
                    section === "decisions"
                      ? "divide-y rounded-lg border border-l-4 border-l-warning bg-background"
                      : "divide-y rounded-lg border bg-background"
                  }
                >
                  {(section === "decisions" || section === "suggestions") &&
                    view[section].map((ask) => (
                      <AskItem
                        key={ask.id}
                        ask={ask}
                        client={resource.client}
                        refresh={resource.refresh}
                      />
                    ))}
                  {section === "changes" &&
                    view.changes.map((item) => (
                      <article key={item.id} className="grid gap-2 p-4">
                        <p>{item.text}</p>
                        <Link to={affairHref(item.affairId)}>{item.affairTitle}</Link>
                        <time dateTime={item.at} className="text-xs text-muted-foreground">
                          {relativeTime(item.at, view.generatedAt, locale)}
                        </time>
                      </article>
                    ))}
                  {section === "results" &&
                    view.results.map((item) => (
                      <article key={item.id} className="grid gap-2 p-4">
                        <h3>
                          {item.title} · v{item.version}
                        </h3>
                        <p className="text-sm text-muted-foreground">{item.summary}</p>
                        <Link
                          className="text-xs text-muted-foreground hover:underline"
                          to={affairHref(item.affairId)}
                        >
                          {item.affairTitle}
                        </Link>
                        <Button variant="outline" className="w-fit" asChild>
                          <Link to={`${affairHref(item.affairId)}/results/${item.version}`}>
                            {copy.read}
                          </Link>
                        </Button>
                      </article>
                    ))}
                  {section === "upcoming" &&
                    view.upcoming.map((item, index) => (
                      <article key={`${item.affairId}-${index}`} className="grid gap-2 p-4">
                        <p>{item.note}</p>
                        <Link to={affairHref(item.affairId)}>{item.affairTitle}</Link>
                        <time dateTime={item.at} className="text-xs text-muted-foreground">
                          {relativeTime(item.at, view.generatedAt, locale)}
                        </time>
                      </article>
                    ))}
                </div>
              </section>
            ))}
          </div>
          <TodayHealth view={view} />
        </>
      )}
    </div>
  );
}
