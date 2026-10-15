import { Link } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import type { AffairDetail } from "@chrona/contracts";
import { MarkdownContent } from "@shared/ui";
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
    <article className="grid min-w-0 gap-4">
      <h2 className="text-xl font-semibold">{result.title}</h2>
      <nav aria-label={copy.version} className="flex flex-wrap gap-3">
        {versions.map((v) => (
          <Link
            key={v.version}
            aria-current={v.version === result.version ? "page" : undefined}
            className="underline"
            to={`/${locale}/affairs/${encodeURIComponent(result.affairId)}/results/${v.version}`}
          >
            {copy.version} {v.version}
          </Link>
        ))}
      </nav>
      <p>{result.summary}</p>
      <MarkdownContent>{result.body}</MarkdownContent>
      <section>
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
      </section>
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
      <EntryForm
        key={result.affairId}
        client={client}
        affairId={result.affairId}
        kind="feedback"
        refresh={refresh}
      />
    </article>
  );
}
