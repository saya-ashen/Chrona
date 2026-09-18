import { useI18n } from "@chrona/i18n";
import { Button, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/ui";
import type { WorkContext } from "@chrona/contracts";
import type { WorkMutation } from "../hooks/use-work-records";
import { localDateInput } from "../model/state";

export function MeetingTimeFields({ window }: { window?: WorkContext["window"] }) {
  const c = useI18n().messages.workRecords;
  return <div className="space-y-2"><div className="grid gap-4 sm:grid-cols-2">
    <Field><FieldLabel htmlFor="work-start">{c.startsAt}</FieldLabel><Input id="work-start" name="startsAt" type="datetime-local" defaultValue={localDateInput(window?.startsAt)} required /></Field>
    <Field><FieldLabel htmlFor="work-end">{c.endsAt}</FieldLabel><Input id="work-end" name="endsAt" type="datetime-local" defaultValue={localDateInput(window?.endsAt)} required /></Field>
  </div><p className="text-xs text-muted-foreground">{c.localTimezone}: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p></div>;
}
export function WorkSourceFields() {
  const c = useI18n().messages.workRecords;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{c.sourceIntro}</p>
    <Field><FieldLabel htmlFor="work-source-kind">{c.sourceKind}</FieldLabel><Select name="sourceKind" defaultValue="email"><SelectTrigger id="work-source-kind"><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="email">{c.email}</SelectItem><SelectItem value="calendar">{c.calendarSource}</SelectItem><SelectItem value="reference">{c.reference}</SelectItem>
    </SelectContent></Select></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field><FieldLabel htmlFor="work-source-system">{c.sourceSystem}</FieldLabel><Input id="work-source-system" name="sourceSystem" required maxLength={128} /></Field>
      <Field><FieldLabel htmlFor="work-source-account">{c.sourceAccount}</FieldLabel><Input id="work-source-account" name="sourceAccount" required maxLength={128} /></Field>
    </div>
    <Field><FieldLabel htmlFor="work-source-id">{c.sourceExternalId}</FieldLabel><Input id="work-source-id" name="sourceExternalId" required maxLength={500} /></Field>
    <Field><FieldLabel htmlFor="work-source-label">{c.sourceLabel}</FieldLabel><Input id="work-source-label" name="sourceLabel" required maxLength={200} /></Field>
    <Field><FieldLabel htmlFor="work-source-url">{c.sourceUrl}</FieldLabel><Input id="work-source-url" name="sourceUrl" type="url" maxLength={2048} /></Field>
  </div>;
}
export function WorkMutationFeedback({ mutation, refresh }: { mutation: WorkMutation; refresh: () => void }) {
  const c = useI18n().messages.workRecords;
  if (!mutation.error) return mutation.busy ? <p role="status" className="text-sm">{c.saving}</p> : null;
  return <div className="space-y-3 rounded-lg border border-destructive/30 p-3"><p role="alert" className="text-sm">{c[mutation.error]}</p>
    {mutation.locked && <div className="flex flex-wrap gap-2">{mutation.error === "error" && <Button type="button" variant="outline" onClick={mutation.retry}>{c.retry}</Button>}
      <Button type="button" variant="outline" onClick={() => { mutation.discard(); refresh(); }}>{c.reconcileAction}</Button></div>}
  </div>;
}
