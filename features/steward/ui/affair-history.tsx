import { useCallback, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { useStewardResource } from "../hooks/use-steward";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { MutationStatus, ResourceStatus } from "./resource-status";

function RevisionDiff({ client, affairId, sha, refresh }: { client: StewardClient; affairId: string; sha: string; refresh: () => void }) {
  const c = useI18n().messages.steward.history;
  const diff = useStewardResource(useCallback((signal?: AbortSignal) => client.diff(affairId, sha, signal), [client, affairId, sha]));
  const [confirm, setConfirm] = useState(false);
  const mutation = useStewardMutation(() => { setConfirm(false); refresh(); });
  return <div className="grid min-w-0 gap-3">
    <ResourceStatus resource={diff} />
    {diff.data && <pre aria-label={c.diff} tabIndex={0} className="max-w-full overflow-x-auto rounded border p-3 font-mono text-xs"><code>{diff.data.diff.split("\n").map((line, index) => <span key={index} className={`block w-max min-w-full ${line.startsWith("+") ? "bg-accent text-accent-foreground" : line.startsWith("-") ? "bg-destructive/10 text-destructive" : ""}`}>{line || " "}</span>)}</code></pre>}
    <MutationStatus mutation={mutation} />
    {confirm ? <div className="flex flex-wrap items-center gap-2"><p>{c.confirm}</p><Button disabled={mutation.pending} onClick={() => void mutation.run(() => client.revert(affairId, sha))}>{c.revert}</Button><Button variant="outline" disabled={mutation.pending} onClick={() => setConfirm(false)}>{c.cancel}</Button></div> : <Button className="justify-self-start" variant="outline" onClick={() => setConfirm(true)}>{c.revert}</Button>}
  </div>;
}
export function AffairHistory({ client, affairId, refresh }: { client: StewardClient; affairId: string; refresh: () => void }) {
  const { messages, locale } = useI18n(), c = messages.steward.history;
  const history = useStewardResource(useCallback((signal?: AbortSignal) => client.revisions(affairId, undefined, signal), [client, affairId]));
  const [selected, setSelected] = useState<string | null>(null);
  return <section aria-label={c.title} className="grid min-w-0 gap-3">
    <h2 className="font-semibold">{c.title}</h2><ResourceStatus resource={history} />
    {history.data && !history.data.items.length && <p>{c.empty}</p>}
    <ul className="grid min-w-0 gap-4">{history.data?.items.map(revision => <li key={revision.sha} className="grid min-w-0 gap-2 border-b pb-3">
      <Button variant="ghost" className="h-auto justify-start whitespace-normal text-left" aria-expanded={selected === revision.sha} onClick={() => setSelected(selected === revision.sha ? null : revision.sha)}>{revision.message} · {messages.steward.workspace[revision.author]} · {new Date(revision.at).toLocaleString(locale)}</Button>
      <p className="break-all text-sm text-muted-foreground">{revision.paths.join(", ")}</p>
      {selected === revision.sha && <RevisionDiff key={revision.sha} client={client} affairId={affairId} sha={revision.sha} refresh={() => { history.refresh(); refresh(); }} />}
    </li>)}</ul>
  </section>;
}
