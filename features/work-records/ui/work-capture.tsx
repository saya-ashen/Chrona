import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@chrona/i18n";
import { workCaptureSchema, type WorkContext } from "@chrona/contracts";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldLabel, FieldSet, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@shared/ui";
import { useWorkMutation } from "../hooks/use-work-records";
import { windowFromForm } from "../model/state";
import { sourceFromForm } from "../model/forms";
import { MeetingTimeFields, WorkMutationFeedback, WorkSourceFields } from "./work-form-fields";
export type ExistingWorkTask = { taskId: string; title: string; window?: WorkContext["window"] };
export function WorkCapture({ open, onClose, existingTask, onCaptured }: { open: boolean; onClose: () => void; existingTask?: ExistingWorkTask; onCaptured?: () => void }) {
  const { messages, locale } = useI18n(), c = messages.workRecords, navigate = useNavigate();
  const [kind, setKind] = useState(existingTask && !existingTask.window ? "general" : "meeting"), [withSource, setWithSource] = useState(false);
  const mutation = useWorkMutation(result => { onClose(); onCaptured?.(); void navigate(`/${locale}/tasks/${encodeURIComponent(result.receipt.taskId)}`); });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const input = workCaptureSchema.parse({ requestId: crypto.randomUUID(), taskId: existingTask?.taskId, title: form.get("title"), nextAction: form.get("nextAction"),
        context: { kind, agenda: form.get("agenda"), ...(kind === "meeting" ? { window: windowFromForm(form), organizer: form.get("organizer"), participants: String(form.get("participants") ?? "").split("\n").map(s => s.trim()).filter(Boolean), ...(form.get("joinUrl") ? { joinUrl: form.get("joinUrl") } : {}) } : {}) },
        sources: withSource ? [sourceFromForm(form)] : [] });
      mutation.run("capture", input);
    } catch { mutation.invalid(); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value && !mutation.locked) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{c.createTitle}</DialogTitle><DialogDescription>{existingTask ? c.adoptIntro : c.createIntro}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5">
      <FieldSet disabled={mutation.locked} className="gap-4">
        <Field><FieldLabel htmlFor="work-kind">{c.kind}</FieldLabel><Select value={kind} onValueChange={setKind}><SelectTrigger id="work-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="meeting">{c.meeting}</SelectItem><SelectItem value="general">{c.general}</SelectItem></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="work-title">{c.name}</FieldLabel><Input autoFocus id="work-title" name="title" defaultValue={existingTask?.title} readOnly={!!existingTask} required maxLength={500} /></Field>
        {kind === "meeting" && <><MeetingTimeFields window={existingTask?.window} />
          <Field><FieldLabel htmlFor="work-organizer">{c.organizer}</FieldLabel><Input id="work-organizer" name="organizer" maxLength={200} /></Field>
          <Field><FieldLabel htmlFor="work-participants">{c.participants}</FieldLabel><Textarea id="work-participants" name="participants" rows={2} maxLength={6000} /></Field>
          <Field><FieldLabel htmlFor="work-join">{c.joinUrl}</FieldLabel><Input id="work-join" name="joinUrl" type="url" maxLength={2048} /></Field></>}
        <Field><FieldLabel htmlFor="work-agenda">{c.agenda}</FieldLabel><Textarea id="work-agenda" name="agenda" rows={3} maxLength={4000} /></Field>
        <Field><FieldLabel htmlFor="work-next">{c.nextAction}</FieldLabel><Textarea id="work-next" name="nextAction" rows={2} maxLength={1000} placeholder={c.nextPlaceholder} /></Field>
        <Field orientation="horizontal"><Checkbox id="work-with-source" checked={withSource} onCheckedChange={v => setWithSource(v === true)} /><FieldLabel htmlFor="work-with-source">{c.linkSource}</FieldLabel></Field>
        {withSource && <WorkSourceFields />}
      </FieldSet>
      <WorkMutationFeedback mutation={mutation} refresh={() => { onClose(); onCaptured?.(); }} />
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={mutation.locked} onClick={onClose}>{c.close}</Button><Button type="submit" disabled={mutation.locked}>{c.create}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
