import { useId, useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button, Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@shared/ui";
import type { PageInputsView } from "@chrona/contracts";
import { validatePageAnswers, visiblePageFields, type PageAnswers, type PageField, type PageForm } from "@chrona/ui-protocol";
import type { PageScope } from "../model/client";
import { usePageCommand, useUnsavedPage } from "../hooks/use-page-command";
import { PageSaveState } from "./page-save-state";

type FieldProps = { field: PageField; value: PageAnswers[string] | undefined; set: (v: PageAnswers[string]) => void; disabled: boolean; invalid?: string };
function MultiChoice({ field, value, set, disabled, id }: FieldProps & { id: string }) {
  const selected = Array.isArray(value) ? value : [];
  return <div role="group" aria-labelledby={`${id}-label`} className="space-y-2">{field.options?.map((o, i) => <div className="flex items-center gap-2" key={o.value}><Checkbox id={`${id}-${i}`} disabled={disabled} checked={selected.includes(o.value)} onCheckedChange={(checked) => set(checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))} /><Label htmlFor={`${id}-${i}`}>{o.label}</Label></div>)}</div>;
}
function ScalarInput({ field, value, set, disabled, invalid, id }: FieldProps & { id: string }) {
  const type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return <Input id={id} disabled={disabled} aria-invalid={Boolean(invalid)} aria-describedby={`${id}-help`} type={type} maxLength={8000} min={field.min} max={field.max} step="any" value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(e) => set(type === "number" && e.target.value !== "" ? e.target.valueAsNumber : e.target.value)} />;
}
function FormField({ field, value, set, disabled, invalid }: FieldProps) {
  const c = useI18n().messages.workPages, id = useId();
  const shared = { id, disabled, "aria-invalid": Boolean(invalid), "aria-describedby": `${id}-help` };
  return <div className={`min-w-0 space-y-2 ${["textarea", "multiselect"].includes(field.type) ? "col-span-full" : ""}`}>
    <Label id={`${id}-label`} htmlFor={id}>{field.label}{field.required ? " *" : ""}</Label>
    {field.type === "textarea" ? <Textarea {...shared} maxLength={8000} value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value)} />
      : field.type === "select" ? <Select disabled={disabled} value={typeof value === "string" ? value : ""} onValueChange={set}><SelectTrigger {...shared}><SelectValue placeholder={c.choose} /></SelectTrigger><SelectContent>{field.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
      : field.type === "checkbox" ? <Checkbox {...shared} checked={value === true} onCheckedChange={(v) => set(v === true)} />
      : field.type === "multiselect" ? <MultiChoice field={field} value={value} set={set} disabled={disabled} id={id} />
      : <ScalarInput field={field} value={value} set={set} disabled={disabled} invalid={invalid} id={id} />}
    <div id={`${id}-help`} className="text-xs text-muted-foreground">{field.help}{invalid && <p role="alert" className="text-destructive">{invalid === "required" ? c.required : c.invalid}</p>}</div>
  </div>;
}
function initialAnswers(inputs: PageInputsView, formKey: string, versionId: string) {
  return inputs.entries.find((e) => e.formKey === formKey && e.versionId === versionId)?.content.answers ?? {};
}
export function PageFormEditor({ form, formKey, scope, versionId, inputs, readOnly = false, onSaved }: { form: PageForm; formKey: string; scope: PageScope; versionId: string; inputs: PageInputsView; readOnly?: boolean; onSaved: () => void }) {
  const c = useI18n().messages.workPages;
  const initial = initialAnswers(inputs, formKey, versionId);
  const [answers, setAnswers] = useState<PageAnswers>(initial), [errors, setErrors] = useState<Record<string, string>>({}), [dirty, setDirty] = useState(false);
  const command = usePageCommand(scope, inputs.revision, () => { setDirty(false); onSaved(); });
  useUnsavedPage(dirty);
  const immutable = readOnly || !inputs.canRespond || inputs.headVersionId !== versionId;
  const disabled = immutable || command.busy || !!command.pending;
  function submit() {
    const checked = validatePageAnswers(form, answers); setErrors(checked.errors);
    if (!Object.keys(checked.errors).length) void command.commit({ type: "respond", versionId, formKey, answers: checked.answers });
  }
  return <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="@container/page-form space-y-5 rounded-xl border border-border/70 bg-muted/20 p-4 sm:p-6" data-ui-surface-kind="ai-authored">
    <div><p className="mb-1 text-xs text-muted-foreground">{c.formSource}</p><h2 className="text-lg font-semibold">{form.title}</h2>{form.description && <p className="mt-2 max-w-[75ch] text-sm text-muted-foreground">{form.description}</p>}</div>
    <div className="grid grid-cols-1 gap-x-6 gap-y-5 @min-[40rem]/page-form:grid-cols-2">
      {visiblePageFields(form, answers).map((field) => <FormField key={field.key} field={field} value={answers[field.key]} invalid={errors[field.key]} disabled={disabled} set={(value) => { setAnswers((prev) => ({ ...prev, [field.key]: value })); setDirty(true); command.changed(); }} />)}
    </div>
    <div className="space-y-3" data-ui-surface-kind="product-authored">
      <p className="text-xs text-muted-foreground">{immutable ? c.readOnly : c.savingHint}</p>
      <Button type="submit" disabled={disabled}>{command.busy ? c.saving : c.save}</Button>
      {dirty && <span className="ml-3 text-xs text-muted-foreground">{c.unsaved}</span>}
      <PageSaveState command={command} versionId={versionId} />
    </div>
  </form>;
}
