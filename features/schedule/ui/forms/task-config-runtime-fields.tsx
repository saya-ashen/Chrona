"use client";

import type { ChangeEvent } from "react";
import { Checkbox, Input, Textarea } from "@shared/ui";
import type { RuntimeInput, RuntimeTaskConfigField } from "@chrona/runtime-core";
import { readDisplayedFieldValue, renderFieldValue } from "./task-config-form-conversions";
import { TaskConfigField, TaskConfigSelect } from "./task-config-form-controls";

type RuntimeFieldListProps = {
  fields: RuntimeTaskConfigField[];
  runtimeInput: RuntimeInput;
  compact: boolean;
  onUpdate: (field: RuntimeTaskConfigField, value: unknown) => void;
};

export function RuntimeFieldList({ fields, runtimeInput, compact, onUpdate }: RuntimeFieldListProps) {
  return fields.map((field) => <RuntimeField key={field.path} field={field} value={readDisplayedFieldValue(field, runtimeInput)} compact={compact} onUpdate={onUpdate} />);
}

function RuntimeField({ field, value, compact, onUpdate }: {
  field: RuntimeTaskConfigField;
  value: unknown;
  compact: boolean;
  onUpdate: (field: RuntimeTaskConfigField, value: unknown) => void;
}) {
  const inputProps = { field, value, compact, onUpdate };
  return (
    <TaskConfigField label={field.label} hint={field.description} className="text-xs text-foreground">
      {field.kind === "textarea" ? <RuntimeTextarea {...inputProps} />
        : field.kind === "select" ? <RuntimeSelect {...inputProps} />
        : field.kind === "number" ? <RuntimeNumber {...inputProps} />
        : field.kind === "boolean" ? <RuntimeBoolean {...inputProps} />
        : field.kind === "json" ? <RuntimeJson {...inputProps} />
        : <RuntimeText {...inputProps} />}
    </TaskConfigField>
  );
}

type RuntimeInputProps = { field: RuntimeTaskConfigField; value: unknown; compact: boolean; onUpdate: (field: RuntimeTaskConfigField, value: unknown) => void };

function RuntimeTextarea({ field, value, compact, onUpdate }: RuntimeInputProps) {
  return <Textarea name={field.path} rows={compact ? 3 : 4} value={renderFieldValue(value)} onChange={(event) => onUpdate(field, event.target.value)} maxLength={field.constraints?.maxLength} />;
}

function RuntimeSelect({ field, value, onUpdate }: RuntimeInputProps) {
  return <TaskConfigSelect name={field.path} value={renderFieldValue(value)} options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))} onValueChange={(nextValue) => onUpdate(field, nextValue || undefined)} />;
}

function RuntimeNumber({ field, value, onUpdate }: RuntimeInputProps) {
  return <Input name={field.path} type="number" value={renderFieldValue(value)} onChange={(event: ChangeEvent<HTMLInputElement>) => onUpdate(field, event.target.value === "" ? undefined : event.target.value)} min={field.constraints?.min} max={field.constraints?.max} step={field.constraints?.step} />;
}

function RuntimeBoolean({ field, value, onUpdate }: RuntimeInputProps) {
  return <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-sm text-foreground"><Checkbox name={field.path} checked={Boolean(value)} onCheckedChange={(checked) => onUpdate(field, checked === true)} /><span>{field.label}</span></label>;
}

function RuntimeJson({ field, value, compact, onUpdate }: RuntimeInputProps) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
  return <Textarea name={field.path} rows={compact ? 4 : 5} value={text} onChange={(event) => onUpdate(field, event.target.value)} />;
}

function RuntimeText({ field, value, onUpdate }: RuntimeInputProps) {
  return <Input name={field.path} value={renderFieldValue(value)} onChange={(event) => onUpdate(field, event.target.value)} minLength={field.constraints?.minLength} maxLength={field.constraints?.maxLength} pattern={field.constraints?.pattern} />;
}
