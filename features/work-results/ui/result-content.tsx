import { useState } from "react";
import { WorkPageRenderer } from "@features/work-pages";
import { useI18n } from "@chrona/i18n";
import { workResults as wr } from "@chrona/contracts";
import { Badge, Button, Card, CardContent } from "@shared/ui";
import { downloadResultFile } from "../model/files";
import type { ResultScope } from "../model/client";

type Props = { view: wr.WorkResultView; scope: ResultScope; canDownload: boolean };
function ResultSource({ view }: Pick<Props, "view">) {
  const c = useI18n().messages.workResults, version = view.version;
  if (!version) return null;
  return <>
    <div className="flex flex-wrap gap-2"><Badge variant="outline">{c.version} {version.version}</Badge>{view.state?.current && <Badge>{c.latest}</Badge>}{view.state?.accepted && <Badge>{c.accepted}</Badge>}<Badge variant="secondary">{c[version.content.readiness.status]}</Badge></div>
    <p className="text-sm text-muted-foreground">{c.source}: {version.sourceKind === "human" ? c.human : c.external} · {version.sourceLabel ?? version.actorKey}<br />{c.published}: {version.publishedAt}</p>
  </>;
}
export function ResultContent({ view, scope, canDownload }: Props) {
  const { workResults: c, workPages } = useI18n().messages;
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const version = view.version;
  if (!version) return <p>{c.empty}</p>;
  const content = version.content;
  async function download(ref: string) {
    if (!version) return;
    setBusy(true); setError(false);
    try { await downloadResultFile(scope, version.id, ref); } catch { setError(true); } finally { setBusy(false); }
  }
  return <Card className="min-w-0" data-ui-surface-kind="product-authored">
    <CardContent className="space-y-4 break-words pt-6 [overflow-wrap:anywhere]">
      <ResultSource view={view} />
      <h2 className="text-xl font-semibold">{content.outcome.title}</h2><p className="whitespace-pre-wrap">{content.outcome.summary}</p>
      {view.pageUnavailable && <p role="alert">{workPages.pageFallback}</p>}
      {content.page && <WorkPageRenderer page={content.page} scope={scope} versionId={version.id} inputs={{ revision: null, headVersionId: version.id, entries: [], canRespond: false, total: 0, nextOffset: null, view: "current" }} readOnly />}
      <h3 className="font-semibold">{c.readiness}</h3><p>{c.reported}</p><p className="whitespace-pre-wrap">{content.readiness.summary}</p>
      {(["findings", "decisions", "caveats", "nextActions"] as const).map((section) => content[section].length ? <section key={section}>
        <h3 className="font-semibold">{c[section]}</h3><ul className="space-y-2">{content[section].map((item) => <li key={item.key}>{item.title && <h4 className="font-medium">{item.title}</h4>}<p className="whitespace-pre-wrap">{item.content}</p></li>)}</ul>
      </section> : null)}
      {content.evidence.length > 0 && <section><h3 className="font-semibold">{c.evidence}</h3><ul>{content.evidence.map((item) => <li key={item.key} className="mb-2 whitespace-pre-wrap">{item.summary}{item.artifactRef && <Button className="ml-2" variant="outline" size="sm" disabled={busy || !canDownload} onClick={() => void download(item.artifactRef!)}>{c.download}</Button>}</li>)}</ul></section>}
      {content.deliverables.length > 0 && <section><h3 className="font-semibold">{c.deliverables}</h3><ul>{content.deliverables.map((item) => <li key={item.key} className="mb-2 flex flex-wrap items-center gap-2"><span className="min-w-0">{item.title} · {item.artifactRef}</span><Button variant="outline" size="sm" disabled={busy || !canDownload || view.unavailableRequiredArtifacts?.includes(item.artifactRef)} onClick={() => void download(item.artifactRef)}>{c.download}</Button>{item.summary && <p className="w-full whitespace-pre-wrap">{item.summary}</p>}</li>)}</ul></section>}
      {!!view.unavailableRequiredArtifacts?.length && <p role="alert">{c.unavailable}</p>}
      {error && <p role="alert">{c.downloadFailed}</p>}
    </CardContent>
  </Card>;
}
