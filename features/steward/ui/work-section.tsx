import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import type { Work } from "@chrona/contracts";
import { Badge, Button, Card, CardContent, Label, Textarea } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { StewardMutationNotice } from "./steward-mutation-notice";
import { LocalizedLink } from "./localized-link";

export function WorkTextForm({ label, maxLength = 1000, submit, refresh }: { label: string; maxLength?: number; submit: (text: string) => Promise<unknown>; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.steward;
  const [text, setText] = useState(""), mutation = useStewardMutation(refresh);
  return <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (text.trim()) void mutation.run(() => submit(text.trim())).then(saved => { if (saved) setText(""); }); }}>
    <Label>{label}<Textarea aria-label={label} required maxLength={maxLength} value={text} onChange={event => setText(event.target.value)} /></Label>
    <Button type="submit" disabled={!text.trim() || mutation.busy || mutation.notice === "mutationError"}>{c.work.send}</Button>
    <StewardMutationNotice mutation={mutation} refresh={refresh} />
  </form>;
}
export function WorkSection({ works, client, refresh }: { works: Work[]; client: StewardClient; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.steward;
  return <section aria-label={c.work.title} className="space-y-3"><h2 className="text-xl font-semibold">{c.work.title}</h2>{!works.length && <p>{c.empty}</p>}{works.map(work => <WorkCard key={work.id} work={work} client={client} refresh={refresh} />)}</section>;
}
function WorkCard({ work: w, client, refresh }: { work: Work; client: StewardClient; refresh: () => void }) {
  const { messages } = useI18n(), c = messages.steward, mutation = useStewardMutation(refresh);
  return <Card className="min-w-0"><CardContent className="space-y-3 pt-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
    <Badge variant="outline">{c.work.statuses[w.status]}</Badge><h3>{c.work.request}</h3><p>{w.request}</p>
    {w.status === "waiting_input" && w.question && <div>{w.question.questions.map((q, i) => <div key={i}><p>{q.question}</p><p>{c.why}: {q.why}</p></div>)}<WorkTextForm label={c.work.answer} submit={text => client.respondWork(w.id, { kind: "answer", text })} refresh={refresh} /></div>}
    {w.status === "waiting_authorization" && w.authorization && <dl><dt>{c.work.missing}</dt><dd>{c.work.missingKinds[w.authorization.missing]}: {w.authorization.capability}</dd><dt>{c.why}</dt><dd>{w.authorization.why}</dd><dt>{c.work.howToGrant}</dt><dd>{w.authorization.howToGrant}</dd></dl>}
    {!!w.progress.length && <div><h3>{c.work.progress}</h3>{w.progress.slice(-3).map((p, i) => <div key={i}><time>{p.at}</time><p>{p.summary}</p>{p.findings.map((f, j) => <p key={j}>{f}</p>)}{p.nextSteps.map((s, j) => <p key={j}>{c.next}: {s}</p>)}</div>)}</div>}
    {w.handling && <p>{c.handlingMode}: {c.handlingModes[w.handling.mode]} — {w.handling.rationale}</p>}
    {w.resultHref && <LocalizedLink className="underline" href={w.resultHref}>{c.work.result}</LocalizedLink>}
    {w.status === "result_ready" && <Button disabled={mutation.busy || mutation.notice === "mutationError"} onClick={() => void mutation.run(() => client.acceptWork(w.id))}>{c.work.accept}</Button>}
    <StewardMutationNotice mutation={mutation} refresh={refresh} />
    {(w.status === "result_ready" || w.status === "accepted") && <WorkTextForm label={c.work.feedback} submit={text => client.respondWork(w.id, { kind: "feedback", text })} refresh={refresh} />}
    <div><h3>{c.attempts}</h3>{w.attempts.map(a => <p key={a.id}>#{a.number} · {a.status} · {c.work.toolCalls}: {a.toolCalls.length}{a.error && ` · ${c.lastError}: ${a.error}`}</p>)}</div>
    {w.nextRunAt && <p>{c.work.nextRun}: <time dateTime={w.nextRunAt}>{w.nextRunAt}</time></p>}
    {w.lastError && <p>{c.lastError}: {w.lastError}</p>}
  </CardContent></Card>;
}
