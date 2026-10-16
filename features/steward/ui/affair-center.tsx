import { useState } from "react";
import { Link } from "react-router-dom";
import type { AffairDetail, Schedule } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Badge, Button } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { affairCenter, scheduleLabel, workStatus } from "../model/affair-center";
import { affairTimeline, type TimelineEntry } from "../model/affair-timeline";
import { pageHref, scheduleDescription } from "../model/workspace";
import { pageName } from "../model/affair-file";
import { formatShortDateTime } from "../model/format";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { AddSchedule } from "./affair-actions";
import { MutationStatus } from "./resource-status";
import { Section, Surface } from "./layout";

type Props = { detail: AffairDetail; client: StewardClient; refresh: () => void };
export function AffairCenterHeader({ detail, client, refresh }: Props) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  const f = messages.steward.affairFile;
  const mutation = useStewardMutation(refresh);
  const [confirm, setConfirm] = useState(false);
  const { affair } = detail;
  const status = workStatus(affair.work, locale, c);
  const model = affairCenter(detail, c.followUp);
  return <header className="grid min-w-0 gap-3 break-words">
    <Link to={`/${locale}/affairs`}>← {messages.steward.affairs.title}</Link>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-2xl font-semibold">{affair.title}</h1><Badge variant="secondary">{messages.steward.affairs[affair.status]}</Badge></div>
      {affair.status !== "done" && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateAffair(affair.id, { status: affair.status === "paused" ? "active" : "paused" }))}>{affair.status === "paused" ? f.resume : f.pause}</Button><Button variant="outline" disabled={mutation.pending} onClick={() => setConfirm(true)}>{f.end}</Button></div>}
    </div>
    {status && <p role="status">{status}</p>}
    {affair.nextSchedule && <p>{c.next.replace("{label}", model.nextLabel).replace("{time}", formatShortDateTime(affair.nextSchedule.at, locale))}</p>}
    {confirm && affair.status !== "done" && <div role="group" aria-label={f.confirmEnd} className="flex flex-wrap items-center gap-2"><p>{f.confirmEnd}</p><Button disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateAffair(affair.id, { status: "done" }))}>{f.confirm}</Button><Button variant="outline" onClick={() => setConfirm(false)}>{f.cancel}</Button></div>}
    <MutationStatus mutation={mutation} />
  </header>;
}
export function AffairArrangements({ detail, client, refresh }: Props) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  const model = affairCenter(detail, c.followUp);
  return <Section title={c.schedules} aria-label={c.schedules}>
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
  return <Surface><div className="grid gap-2 break-words p-3">
    <p className="font-medium">{scheduleLabel(schedule, messages.steward.affairCenter.followUp)}</p>
    <p>{schedule.rule.kind === "at" ? <time dateTime={schedule.rule.at}>{formatShortDateTime(schedule.rule.at, locale)}</time> : <>{scheduleDescription(schedule.rule, locale, messages.steward.workspace)}{schedule.nextAt && <> · {messages.steward.affairCenter.nextAt} <time dateTime={schedule.nextAt}>{formatShortDateTime(schedule.nextAt, locale)}</time></>}</>}</p>
    {schedule.status === "paused" && <p>{c.paused}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateSchedule(schedule.id, { status: schedule.status === "active" ? "paused" : "active" }))}>{schedule.status === "active" ? c.pause : c.resume}</Button><Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateSchedule(schedule.id, { status: "cancelled" }))}>{messages.steward.affairCenter.cancelSchedule}</Button></div>
    <MutationStatus mutation={mutation} />
  </div></Surface>;
}
export function AffairTimeline({ detail }: { detail: AffairDetail }) {
  const { messages } = useI18n();
  const [count, setCount] = useState(20);
  const entries = affairTimeline(detail);
  return <Section title={messages.steward.affairCenter.timeline}><ol className="grid gap-4 border-l pl-3">{entries.slice(0, count).map(entry => <TimelineItem key={entry.id} entry={entry} affairId={detail.affair.id} />)}</ol>{entries.length > count && <Button variant="outline" onClick={() => setCount(count + 20)}>{messages.steward.affairCenter.more}</Button>}</Section>;
}
function TimelineItem({ entry, affairId }: { entry: TimelineEntry; affairId: string }) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  const [expanded, setExpanded] = useState(false);
  return <li className="min-w-0 break-words"><time className="text-xs text-muted-foreground" dateTime={entry.at}>{formatShortDateTime(entry.at, locale)}</time>
    {entry.kind === "message" ? <><p className={expanded ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}>{messages.steward.workspace[entry.actor!]}: {entry.text}</p>{(entry.text.length > 90 || entry.text.split("\n").length > 3) && <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? c.collapse : c.expand}</Button>}</>
      : entry.kind === "edit" ? <p>{entry.actor === "user" ? c.userEdited : c.chronaEdited}{!entry.paths.length && c.updatedPages}{entry.paths.slice(0, 3).map((path, index) => <span key={path}>{index > 0 && "、"}<Link className="underline" to={pageHref(locale, affairId, path)}>{pageName(path)}</Link></span>)}{entry.paths.length > 3 && c.morePages.replace("{count}", String(entry.paths.length - 3))}</p>
        : <p>{c[entry.kind]}{entry.text}</p>}
  </li>;
}
export function AffairTechnicalDetails({ detail }: { detail: AffairDetail }) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairCenter;
  return <details className="min-w-0 break-words"><summary>{c.technical}</summary><div className="grid gap-4 pt-3">
    {detail.runs.map(run => <dl key={run.id} className="grid gap-1"><dt>{c.label}</dt><dd>{run.label || "—"}</dd><dt>{c.trigger}</dt><dd>{run.trigger}</dd><dt>{c.status}</dt><dd>{run.status}</dd><dt>{c.start}</dt><dd>{run.startedAt ? new Date(run.startedAt).toLocaleString(locale) : "—"}</dd><dt>{c.end}</dt><dd>{run.endedAt ? new Date(run.endedAt).toLocaleString(locale) : "—"}</dd><dt>{c.toolCalls}</dt><dd>{run.toolCalls.length}</dd>{run.error && <><dt>{c.error}</dt><dd>{run.error}</dd></>}</dl>)}
    {detail.schedules.map(schedule => <div key={schedule.id}><h3>{scheduleLabel(schedule, c.followUp)}</h3><p>{c.instructions}</p><pre className="whitespace-pre-wrap break-all">{schedule.text}</pre>{schedule.command && <><p>{c.command}</p><pre className="whitespace-pre-wrap break-all">{schedule.command}</pre></>}</div>)}
  </div></details>;
}
