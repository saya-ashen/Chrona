import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { ProviderAnswer, ProviderInteraction, ProviderRunView } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, AlertTitle, Button, Input, Label, Textarea } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { providerAnswerReady, providerUsageText, providerWork, type ProviderDisplayMode, type ProviderRecordView } from "../model/provider-work";
import { useProviderWork } from "../hooks/use-provider-work";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { formatShortDateTime } from "../model/format";
import { pageHref } from "../model/workspace";
import { MutationStatus, ResourceStatus } from "./resource-status";

export function ProviderWork({ client, affairId, mode = "all", onChange }: { client: StewardClient; affairId?: string; mode?: ProviderDisplayMode; onChange?: () => void }) {
  const resource = useProviderWork(client, affairId);
  const messages = useI18n().messages.steward, c = messages.providerWork;
  const model = providerWork(resource.data?.items ?? [], mode);
  const refresh = () => { resource.refresh(); onChange?.(); };
  if (resource.loading && !resource.data) return mode === "questions" ? null : <span className="sr-only" role="status">{messages.foundation.loading}</span>;
  if (!resource.loading && !resource.error && !model.hasContent) return null;
  return <section aria-label={mode === "questions" ? c.needsInput : c.title} className="grid min-w-0 gap-3 text-[13px] [overflow-wrap:anywhere]">
    <ResourceStatus resource={resource} />
    {model.questions.map(({ run, question }) => <ProviderQuestion key={question.id} request={question} run={run} client={client} refresh={refresh} />)}
    {model.active.map(run => <ProviderProgress key={run.id} run={run} client={client} refresh={refresh} />)}
    {!!model.history.length && <details><summary className="cursor-pointer text-muted-foreground">{c.details}</summary><div className="grid gap-3 pt-2">{model.history.map(run => <ProviderRecord key={run.id} run={run} />)}</div></details>}
  </section>;
}
function ProviderQuestion({ request, run, client, refresh }: { request: ProviderInteraction; run: ProviderRunView; client: StewardClient; refresh: () => void }) {
  const { messages, locale } = useI18n(), c = messages.steward.providerWork;
  const { question } = request;
  const id = useId(), [text, setText] = useState(() => question.prefill ?? ""), [choice, setChoice] = useState<number | null>(null);
  const mutation = useStewardMutation(refresh);
  const answer = (value: ProviderAnswer) => { void mutation.run(() => client.answerProvider(request.id, value)); };
  return <Alert className="min-w-0 border-primary/40"><AlertTitle>{c.needsInput}</AlertTitle><AlertDescription className="grid min-w-0 gap-3">
    <div>{run.affairId && <Link className="text-primary underline" to={pageHref(locale, run.affairId)}>{run.affairTitle}</Link>}<p className="font-medium">{question.title}</p>{question.message && <p className="whitespace-pre-wrap">{question.message}</p>}</div>
    <p className="text-xs text-muted-foreground">{c.boundary}</p>
    <ProviderAnswerField question={question} id={id} text={text} onText={setText} choice={choice} onChoice={setChoice} pending={mutation.pending} />
    <div className="flex flex-wrap gap-2">{question.method === "confirm" ? <><Button disabled={mutation.pending} onClick={() => answer({ decision: "submit", value: true })}>{c.allow}</Button><Button variant="outline" disabled={mutation.pending} onClick={() => answer({ decision: "submit", value: false })}>{c.deny}</Button></> : <Button disabled={mutation.pending || !providerAnswerReady(question, choice, text)} onClick={() => answer({ decision: "submit", value: question.method === "select" ? choice! : text })}>{c.send}</Button>}<Button variant="ghost" disabled={mutation.pending} onClick={() => answer({ decision: "cancel" })}>{c.dismiss}</Button></div>
    <p className="text-xs text-muted-foreground">{c.expires.replace("{time}", formatShortDateTime(request.expiresAt, locale))}</p>
    {mutation.error?.status === 409 ? <p role="alert">{c.stale}<Button variant="ghost" onClick={refresh}>{messages.steward.foundation.retry}</Button></p> : <MutationStatus mutation={mutation} />}
  </AlertDescription></Alert>;
}
function ProviderAnswerField({ question, id, text, onText, choice, onChoice, pending }: { question: ProviderInteraction["question"]; id: string; text: string; onText(value: string): void; choice: number | null; onChoice(value: number): void; pending: boolean }) {
  const c = useI18n().messages.steward.providerWork;
  if (question.method === "select") return <div role="group" aria-label={question.title} className="flex flex-wrap gap-2">{question.options.map((option, index) => <Button key={index} type="button" variant={choice === index ? "secondary" : "outline"} aria-pressed={choice === index} disabled={pending} onClick={() => onChoice(index)}>{option}</Button>)}</div>;
  if (question.method === "confirm") return null;
  return <div className="grid gap-1.5"><Label htmlFor={id}>{c.answer}</Label>{question.method === "editor" ? <Textarea id={id} value={text} maxLength={8000} disabled={pending} onChange={event => onText(event.target.value)} /> : <Input id={id} value={text} maxLength={8000} disabled={pending} autoComplete="off" onChange={event => onText(event.target.value)} />}{question.method === "editor" && <p className="text-xs">{c.editHint}</p>}</div>;
}
function ProviderProgress({ run, client, refresh }: { run: ProviderRunView; client: StewardClient; refresh: () => void }) {
  const { messages, locale } = useI18n(), c = messages.steward.providerWork;
  const [confirm, setConfirm] = useState(false), mutation = useStewardMutation(refresh);
  return <div className="grid min-w-0 gap-2"><div className="flex flex-wrap items-center gap-2"><p role="status" className="mr-auto">{run.affairTitle && <>{run.affairTitle} · </>}{c.phases[run.progress?.phase ?? "thinking"]}</p><Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>{c.stop}</Button></div>
    {confirm && <Alert><AlertDescription className="grid gap-2"><p>{c.stopConfirm}</p><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={mutation.pending} onClick={() => void mutation.run(() => client.cancelProviderRun(run.id))}>{c.stop}</Button><Button variant="outline" disabled={mutation.pending} onClick={() => setConfirm(false)}>{messages.steward.affairFile.cancel}</Button></div><MutationStatus mutation={mutation} /></AlertDescription></Alert>}
    {!run.affairId && <p className="text-xs text-muted-foreground">{c.conversation.replace("{time}", formatShortDateTime(run.updatedAt, locale))}</p>}
  </div>;
}
function ProviderRecord({ run }: { run: ProviderRecordView }) {
  const { messages, locale } = useI18n(), c = messages.steward.providerWork;
  const usage = run.usage ? providerUsageText(run.usage, locale) : null;
  return <div className="grid min-w-0 gap-1 border-t pt-2 text-muted-foreground">
    {run.affairTitle && <p>{run.affairTitle}</p>}
    {run.resources && <p>{c.resources.replace("{version}", run.resources.version).replace("{extensions}", String(run.resources.extensions))} · {run.resources.skills.join(", ") || c.noSkills}</p>}
    {usage && <><p>{run.usage?.scope === "run" ? c.runUsage : c.sessionUsage}: {c.usage.replace("{tokens}", usage.tokens).replace("{cost}", usage.cost)}</p>{usage.context && <p>{c.context}: {usage.context}</p>}<p className="text-xs">{c.estimate}</p></>}
    {run.closedInteractions.map(item => <p key={item.id}>{item.question.title} · {c.states[item.status]}</p>)}
  </div>;
}
