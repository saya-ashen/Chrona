import { useState } from "react";
import type { AffairDetail, Schedule } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import type { StewardClient } from "../model/client";
import { scheduleDescription } from "../model/workspace";
import { useStewardMutation } from "../hooks/use-steward-mutation";
import { AddSchedule } from "./affair-actions";
import { ApprovalItem } from "./approval-item";
import { MutationStatus } from "./resource-status";
import { Section, Surface } from "./layout";

type Props = { detail: AffairDetail; client: StewardClient; refresh: () => void };
export function WorkspaceAffairSidebar({ detail, client, refresh }: Props) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairFile;
  return <aside className="grid min-w-0 gap-6">
    <AffairStatusActions detail={detail} client={client} refresh={refresh} />
    <Section title={c.schedules}>
      {detail.affair.status === "active" && <AddSchedule client={client} affairId={detail.affair.id} refresh={refresh} />}
      {!detail.schedules.length && <p>{c.noSchedules}</p>}
      {detail.schedules.map(schedule => <ScheduleItem key={schedule.id} schedule={schedule} client={client} refresh={refresh} />)}
    </Section>
    {detail.approvals.some(approval => approval.status === "open") && <Section title={messages.steward.workspace.approvals}><Surface>{detail.approvals.filter(approval => approval.status === "open").map(approval => <ApprovalItem key={approval.id} approval={approval} client={client} refresh={refresh} />)}</Surface></Section>}
    <Section title={c.activity}>
      {!detail.activity.length && <p>{c.noActivity}</p>}
      <ol className="grid gap-4 border-l pl-3">{detail.activity.map(activity => <li key={activity.id}><time className="text-xs text-muted-foreground" dateTime={activity.at}>{new Date(activity.at).toLocaleString(locale)}</time><p>{activity.text}</p></li>)}</ol>
    </Section>
  </aside>;
}
function AffairStatusActions({ detail, client, refresh }: Props) {
  const c = useI18n().messages.steward.affairFile;
  const mutation = useStewardMutation(refresh);
  const [confirm, setConfirm] = useState(false);
  const affair = detail.affair;
  return <div className="grid gap-2"><p>{c[affair.status]}</p>
    {affair.status !== "done" && <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateAffair(affair.id, { status: affair.status === "paused" ? "active" : "paused" }))}>{affair.status === "paused" ? c.resume : c.pause}</Button>
      <Button variant="outline" disabled={mutation.pending} onClick={() => setConfirm(true)}>{c.end}</Button>
    </div>}
    {confirm && affair.status !== "done" && <div role="group" aria-label={c.confirmEnd} className="grid gap-2"><p>{c.confirmEnd}</p><Button disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateAffair(affair.id, { status: "done" }))}>{c.confirm}</Button><Button variant="outline" disabled={mutation.pending} onClick={() => setConfirm(false)}>{c.cancel}</Button></div>}
    <MutationStatus mutation={mutation} />
  </div>;
}
function ScheduleItem({ schedule, client, refresh }: { schedule: Schedule; client: StewardClient; refresh: () => void }) {
  const { messages, locale } = useI18n();
  const c = messages.steward.affairFile;
  const w = messages.steward.workspace;
  const mutation = useStewardMutation(refresh);
  return <Surface><div className="grid gap-2 p-3">
    <p>{w[schedule.mode]} · {scheduleDescription(schedule.rule, locale, w)}</p><p>{schedule.text}</p><p>{c[schedule.status]}</p>
    {schedule.nextAt && <p>{w.next}: <time dateTime={schedule.nextAt}>{new Date(schedule.nextAt).toLocaleString(locale)}</time></p>}
    {schedule.mode !== "module" && (schedule.status === "active" || schedule.status === "paused") && <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateSchedule(schedule.id, { status: schedule.status === "active" ? "paused" : "active" }))}>{schedule.status === "active" ? c.pause : c.resume}</Button>
      <Button variant="outline" disabled={mutation.pending} onClick={() => void mutation.run(() => client.updateSchedule(schedule.id, { status: "cancelled" }))}>{c.cancelSchedule}</Button>
    </div>}
    <MutationStatus mutation={mutation} />
  </div></Surface>;
}
