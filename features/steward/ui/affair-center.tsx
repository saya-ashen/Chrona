import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AffairDetail, Schedule } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Alert, AlertDescription, Badge, Button } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { affairCenter, affairWorkFeedback, scheduleLabel, workStatus } from "../model/affair-center";
import { affairTimeline, timelineTime, type TimelineEntry } from "../model/affair-timeline";
import { pageHref, scheduleDescription } from "../model/workspace";
import { pageName } from "../model/affair-file";
import { formatShortDateTime } from "../model/format";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { AddSchedule } from "./affair-actions";
import { MutationStatus } from "./resource-status";
import { Section } from "./layout";
import { plainSummary, affairPill, affairPillClass } from "../model/affair-overview";
import { Composer } from "./composer";

type Props = { detail: AffairDetail; client: StewardClient; refresh: () => void };
export function AffairCenterHeader({ detail, client, refresh }: Props) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  const f = messages.steward.affairFile;
  const mutation = useStewardMutation(refresh);
  const [confirm, setConfirm] = useState(false);
  const { affair } = detail;
  const pill = affairPill(affair, c, messages.steward.affairs);
  return <header className="grid min-w-0 gap-1.5 break-words">
    <div className="flex flex-wrap items-center gap-2.5">
      <Link className="text-xs text-muted-foreground" to={`/${locale}/affairs`}>← {messages.steward.affairs.title}</Link>
      <Badge variant="secondary" className={`mr-auto rounded-full border-0 px-2 py-px text-xs ${affairPillClass(affair)}`}>{pill}</Badge>
      {affair.status !== "done" && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateAffair(affair.id, { status: affair.status === "paused" ? "active" : "paused" }))}>{affair.status === "paused" ? f.resume : f.pause}</Button><Button variant="outline" disabled={mutation.pending} onClick={() => setConfirm(true)}>{f.end}</Button></div>}
    </div>
    <h1 className="text-2xl font-semibold">{affair.title}</h1>
    <AffairRuntimeStatus detail={detail} client={client} refresh={refresh} disabled={mutation.pending} />
    {confirm && affair.status !== "done" && <div role="group" aria-label={f.confirmEnd} className="flex flex-wrap items-center gap-2"><p>{f.confirmEnd}</p><Button disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateAffair(affair.id, { status: "done" }))}>{f.confirm}</Button><Button variant="outline" onClick={() => setConfirm(false)}>{f.cancel}</Button></div>}
    <MutationStatus mutation={mutation} />
  </header>;
}
function AffairRuntimeStatus({ detail, client, refresh, disabled }: Props & { disabled: boolean }) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  const mutation = useStewardMutation(refresh);
  const status = workStatus(detail.affair.work, locale, c);
  const { issue, recovering, canResume } = affairWorkFeedback(detail);
  const next = detail.affair.nextSchedule;
  const issueCopy = { failed: c.workFailed, timed_out: c.workTimedOut, provider_unavailable: c.workUnavailable, cancelled: c.workCancelled };
  if (!status && !issue && !next) return null;
  return <div className="grid min-w-0 gap-2 text-[13px]">
    {status && <p role="status" aria-live="polite">{status}</p>}
    {next && <p>{c.next.replace("{label}", next.label ?? c.followUp).replace("{time}", formatShortDateTime(next.at, locale))}</p>}
    {recovering && <p className="text-muted-foreground">{c.workRecovering}</p>}
    {issue && canResume && <Alert variant={issue === "cancelled" ? "default" : "destructive"}><AlertDescription className="grid gap-2"><p>{issueCopy[issue]}</p><Button className="w-fit" variant="outline" size="sm" disabled={disabled || mutation.pending} onClick={() => void mutation.run(() => client.chat({ affairId: detail.affair.id, text: c.resumeWorkMessage }))}>{c.resumeWork}</Button></AlertDescription></Alert>}
    <MutationStatus mutation={mutation} />
  </div>;
}
export function AffairNow({ detail }: { detail: AffairDetail }) {
  const c = useI18n().messages.steward.affairCenter;
  return <Section title={c.now} className="rounded-[10px] border bg-card p-3.5 gap-2">
    <p className="max-w-[65ch] text-[15px]">{plainSummary(detail.affair.summary)}</p>
  </Section>;
}
export function AffairArrangements({ detail, client, refresh }: Props) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  const model = affairCenter(detail, c.followUp);
  return <Section title={c.schedules} aria-label={c.schedules} className="rounded-[10px] border bg-card p-3.5 text-[13px]">
    {!model.active.length && <p>{c.noSchedules}</p>}
    {model.active.map(schedule => <Arrangement key={schedule.id} schedule={schedule} client={client} refresh={refresh} />)}
    {!!model.completed.length && <details><summary>{c.completed.replace("{count}", String(model.completed.length))}</summary><ul className="grid gap-2">{model.completed.map(schedule => <li key={schedule.id}>{scheduleLabel(schedule, c.followUp)} · <time>{new Date(schedule.lastAt || schedule.nextAt || schedule.createdAt).toLocaleString(locale)}</time></li>)}</ul></details>}
    {detail.affair.status === "active" && <AddSchedule client={client} affairId={detail.affair.id} refresh={refresh} />}
  </Section>;
}
function Arrangement({ schedule, client, refresh }: { schedule: Schedule; client: StewardClient; refresh: () => void }) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairFile;
  const mutation = useStewardMutation(refresh);
  return <div className="grid gap-1.5 break-words border-b pb-3 last:border-0">
    <p className="font-medium">{scheduleLabel(schedule, messages.steward.affairCenter.followUp)}</p>
    <p>{schedule.rule.kind === "at" ? <time dateTime={schedule.rule.at}>{formatShortDateTime(schedule.rule.at, locale)}</time> : <>{scheduleDescription(schedule.rule, locale, messages.steward.workspace)}{schedule.nextAt && <> · {messages.steward.affairCenter.nextAt} <time dateTime={schedule.nextAt}>{formatShortDateTime(schedule.nextAt, locale)}</time></>}</>}</p>
    {schedule.status === "paused" && <p>{c.paused}</p>}
    <div className="-ml-2 flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateSchedule(schedule.id, { status: schedule.status === "active" ? "paused" : "active" }))}>{schedule.status === "active" ? c.pause : c.resume}</Button><Button variant="ghost" size="sm" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateSchedule(schedule.id, { status: "cancelled" }))}>{messages.steward.affairCenter.cancelSchedule}</Button></div>
    <MutationStatus mutation={mutation} />
  </div>;
}
export function AffairTimeline({ detail, client, refresh }: Props) {
  const { messages, locale } = useI18n();
  const [count, setCount] = useState(8);
  const entries = affairTimeline(detail);
  return <Section title={messages.steward.affairCenter.timeline} className="rounded-[10px] border bg-card p-3.5"><ol className="grid">{entries.slice(0, count).map(entry => <TimelineItem key={entry.id} entry={entry} affairId={detail.affair.id} />)}</ol>{entries.length > count && <Button variant="outline" onClick={() => setCount(count + 20)}>{messages.steward.affairCenter.more}</Button>}{detail.affair.status !== "done" && <Composer client={client} lang={locale} refresh={refresh} affairId={detail.affair.id} />}</Section>;
}
function PageLinks({ prefix, paths, affairId }: { prefix: string; paths: string[]; affairId: string }) {
  const { messages, locale } = useI18n();
  return <p className="text-muted-foreground">{prefix}{paths.slice(0, 3).map((path, index) => <span key={path}>{index > 0 && "、"}<Link className="underline" to={pageHref(locale, affairId, path)}>{pageName(path)}</Link></span>)}{paths.length > 3 && messages.steward.affairCenter.morePages.replace("{count}", String(paths.length - 3))}</p>;
}
function TimelineItem({ entry, affairId }: { entry: TimelineEntry; affairId: string }) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  const [expanded, setExpanded] = useState(false);
  return <li className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-2.5 break-words border-t border-dashed py-2 text-[13px] first:border-0"><time className="pt-0.5 text-xs tabular-nums text-muted-foreground" dateTime={entry.at}>{timelineTime(entry.at, locale)}</time><div>
    {entry.kind === "message" ? <><p className={`text-xs ${entry.actor === "user" ? "text-primary" : "text-muted-foreground"}`}>{entry.actor === "user" ? messages.steward.foundation.you : c.replyKind}</p><p className={expanded ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}>{entry.text}</p>{(entry.text.length > 90 || entry.text.split("\n").length > 3) && <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? c.collapse : c.expand}</Button>}{!!entry.paths.length && <PageLinks prefix={c.alsoUpdated} paths={entry.paths} affairId={affairId} />}</>
      : entry.kind === "edit" ? <TimelineEdit entry={entry} affairId={affairId} />
        : <p>{c[entry.kind]}{entry.text}</p>}
  </div></li>;
}
function TimelineEdit({ entry, affairId }: { entry: TimelineEntry; affairId: string }) {
  const { messages } = useI18n();
  const c = messages.steward.affairCenter;
  const prefix = entry.actor === "user" ? c.userEdited : c.chronaEdited;
  return entry.paths.length ? <PageLinks prefix={prefix} paths={entry.paths} affairId={affairId} /> : <p>{prefix}{c.updatedPages}</p>;
}
export function AffairTechnicalDetails({ detail, children }: { detail: AffairDetail; children?: ReactNode }) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  return <details className="min-w-0 break-words"><summary className="cursor-pointer text-[13px] text-muted-foreground">{c.technicalCount.replace("{runs}", String(detail.runs.length)).replace("{tools}", String(detail.runs.reduce((sum, run) => sum + run.toolCalls.length, 0)))}</summary><div className="grid gap-4 pt-3">
    {detail.runs.map(run => <dl key={run.id} className="grid gap-1"><dt>{c.label}</dt><dd>{run.label || "—"}</dd><dt>{c.trigger}</dt><dd>{run.trigger}</dd><dt>{c.status}</dt><dd>{run.status}</dd><dt>{c.start}</dt><dd>{run.startedAt ? new Date(run.startedAt).toLocaleString(locale) : "—"}</dd><dt>{c.end}</dt><dd>{run.endedAt ? new Date(run.endedAt).toLocaleString(locale) : "—"}</dd><dt>{c.toolCalls}</dt><dd>{run.toolCalls.length}</dd>{run.error && <><dt>{c.error}</dt><dd>{run.error}</dd></>}</dl>)}
    {detail.schedules.map(schedule => <div key={schedule.id}><h3>{scheduleLabel(schedule, c.followUp)}</h3><p>{c.instructions}</p><pre className="whitespace-pre-wrap break-all">{schedule.text}</pre>{schedule.command && <><p>{c.command}</p><pre className="whitespace-pre-wrap break-all">{schedule.command}</pre></>}</div>)}
    {children}
  </div></details>;
}
