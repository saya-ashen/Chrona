import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { workUpdateSchema, type WorkSummary } from "@chrona/contracts";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldLabel, FieldSet, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@shared/ui";
import { useWorkMutation } from "../hooks/use-work-records";
import { dimensions, signalValues } from "../model/state";
import { updateAction, type WorkDialog } from "../model/forms";
export type { WorkDialog } from "../model/forms";
import { MeetingTimeFields, WorkMutationFeedback, WorkSourceFields } from "./work-form-fields";
function ReportFields({ record }: { record: WorkSummary }) {
  const c = useI18n().messages.workRecords, [dimension, setDimension] = useState("note");
  const values = dimension === "note" ? [] : signalValues[dimension as keyof typeof signalValues];
  return <>
    <Field><FieldLabel htmlFor="work-summary">{c.summary}</FieldLabel><Textarea id="work-summary" name="summary" autoFocus rows={4} required maxLength={2000} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="work-signal">{c.signal}</FieldLabel><Select name="dimension" value={dimension} onValueChange={setDimension}><SelectTrigger id="work-signal"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="note">{c.noteOnly}</SelectItem>{dimensions.map(d => <SelectItem key={d} value={d}>{d === "meeting" ? c.meetingState : c[d]}</SelectItem>)}</SelectContent></Select></Field>
      {values.length > 0 && <Field><FieldLabel htmlFor="work-value">{c.value}</FieldLabel><Select key={dimension} name="signalValue" defaultValue="unknown"><SelectTrigger id="work-value"><SelectValue /></SelectTrigger><SelectContent>{values.map(v => <SelectItem key={v} value={v}>{c.states[v]}</SelectItem>)}</SelectContent></Select></Field>}
    </div>
    <Field><FieldLabel htmlFor="work-receipt">{c.receiptRef}</FieldLabel><Input id="work-receipt" name="receiptRef" maxLength={500} /></Field>
    <Field><FieldLabel htmlFor="work-next-action">{c.nextAction}</FieldLabel><Textarea id="work-next-action" name="nextAction" defaultValue={record.nextAction} maxLength={1000} rows={2} /></Field>
    <Field orientation="horizontal"><Checkbox id="work-clear" name="clearAttention" /><FieldLabel htmlFor="work-clear">{c.clearAttention}</FieldLabel></Field>
  </>;
}
function ChangeFields({ record }: { record: WorkSummary }) {
  const c = useI18n().messages.workRecords, [kind, setKind] = useState("reschedule");
  return <>
    <Field><FieldLabel htmlFor="work-change-kind">{c.change}</FieldLabel><Select name="changeType" value={kind} onValueChange={setKind}><SelectTrigger id="work-change-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reschedule">{c.reschedule}</SelectItem><SelectItem value="cancel">{c.cancelMeeting}</SelectItem></SelectContent></Select></Field>
    {kind === "reschedule" && <MeetingTimeFields window={record.context.window} />}
    <Field><FieldLabel htmlFor="work-change-reason">{c.changeReason}</FieldLabel><Textarea id="work-change-reason" name="reason" required rows={3} maxLength={500} /></Field>
  </>;
}
export function WorkUpdateDialog({ record, mode, onClose, refresh }: { record: WorkSummary; mode: WorkDialog; onClose: () => void; refresh: () => void }) {
  const c = useI18n().messages.workRecords;
  const [revision] = useState(record.revision);
  const mutation = useWorkMutation(() => { onClose(); refresh(); });
  const key = typeof mode === "string" ? mode : "resolve";
  const title = { report: c.report, source: c.addSource, change: c.change, resolve: c.resolveTitle }[key];
  const intro = { report: c.reportIntro, source: c.sourceIntro, change: c.changeIntro, resolve: c.resolveHint }[key];
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { const input = workUpdateSchema.parse({ requestId: crypto.randomUUID(), taskId: record.taskId, expectedRevision: revision, action: updateAction(mode, new FormData(event.currentTarget)) }); mutation.run("update", input); }
    catch { mutation.invalid(); }
  }
  return <Dialog open onOpenChange={value => { if (!value && !mutation.locked) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{intro}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5"><FieldSet disabled={mutation.locked} className="gap-4">
      {mode === "report" ? <ReportFields record={record} /> : mode === "source" ? <WorkSourceFields /> : mode === "change" ? <ChangeFields record={record} /> : <>
        <p className="break-words text-sm">{mode.entry.summary}</p>
        <Field><FieldLabel htmlFor="work-resolve-reason">{c.resolveReason}</FieldLabel><Textarea id="work-resolve-reason" name="reason" autoFocus required rows={3} maxLength={2000} /></Field>
      </>}
    </FieldSet><WorkMutationFeedback mutation={mutation} refresh={() => { onClose(); refresh(); }} />
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={mutation.locked} onClick={onClose}>{c.close}</Button><Button type="submit" disabled={mutation.locked}>{typeof mode === "object" ? mode.decision === "apply" ? c.apply : c.dismiss : mode === "change" ? c.propose : c.save}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
