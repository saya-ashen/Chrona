import { Surface } from "./layout";
import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import type { AffairDetail } from "@chrona/contracts";
import { Button, MarkdownContent } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { safeSourceUrl } from "../model/affairs";
import { EntryForm } from "./entry-form";

export function ResultContent({
  result,
  versions,
  client,
  refresh,
}: {
  result: NonNullable<AffairDetail["latestResult"]>;
  versions: AffairDetail["resultVersions"];
  client: StewardClient;
  refresh: () => void;
}) {
  const { messages, locale } = useI18n(),
    copy = messages.steward.affairs;
  return (
    <Surface><article className="min-w-0 divide-y [&>section]:p-5">
      <header className="flex flex-wrap items-center gap-3 p-5">
      <h2 className="mr-auto text-lg font-semibold">{result.title}</h2>
      <nav aria-label={copy.version} className="flex flex-wrap gap-3">
        {versions.map((v) => (
          <Button key={v.version} size="sm" variant={v.version === result.version ? "secondary" : "ghost"} asChild><Link
            aria-current={v.version === result.version ? "page" : undefined}
            to={`/${locale}/affairs/${encodeURIComponent(result.affairId)}/results/${v.version}`}
          >
            {copy.version} {v.version}
          </Link></Button>
        ))}
      </nav>
      <time className="w-full text-xs text-muted-foreground" dateTime={result.createdAt}>{new Date(result.createdAt).toLocaleString(locale)}</time>
      </header>
      <div className="grid min-w-0 gap-4 p-5">
        <p className="text-muted-foreground">{result.summary}</p>
        <div className="prose prose-sm min-w-0 max-w-none dark:prose-invert"><MarkdownContent>{result.body}</MarkdownContent></div>
      </div>
      {result.sources.length > 0 && <section>
        <h3 className="font-semibold">{copy.sources}</h3>
        <ul className="grid gap-2">
          {result.sources.map((s, i) => (
            <li key={i}>
              <a
                className="underline"
                href={safeSourceUrl(s.url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.title}
              </a>{" "}
              · {s.verified ? copy.verified : copy.unverified}
              {s.note && <p>{s.note}</p>}
            </li>
          ))}
        </ul>
      </section>}
      {result.limitations && (
        <section>
          <h3 className="font-semibold">{copy.limitations}</h3>
          <p>{result.limitations}</p>
        </section>
      )}
      {result.nextSteps.length > 0 && (
        <section>
          <h3>{copy.next}</h3>
          <ul>
            {result.nextSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="p-5"><EntryForm
        key={result.affairId}
        client={client}
        affairId={result.affairId}
        kind="feedback"
        refresh={refresh}
      /></div>
    </article></Surface>
  );
}
