"use client";

import { useEffect, useMemo, useState } from "react";
import {
  File,
  FileText,
  FormInput,
  Globe2,
} from "lucide-react";
import { Button } from "@shared/ui";
import { Checkbox } from "@shared/ui";




import { Input } from "@shared/ui";
import { Label } from "@shared/ui";




import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";
import { Textarea } from "@shared/ui";
import {
  submitGoalForm,
  type GoalAssetKind,
  type GoalAssetWorkbenchData,
} from "../workbench-api";
import type { GoalCopy } from "../model/goal-types";
export const ICON_BY_KIND: Record<GoalAssetKind, typeof File> = {
  document: FileText,
  form: FormInput,
  page: Globe2,
  file: File,
  structured_result: FileText,
};
export type AssetWorkbenchCopy = GoalCopy["assetWorkbench"];
export const KIND_TONE: Record<GoalAssetKind, string> = {
  document: "bg-info/[0.09] text-info",
  form: "bg-success/[0.09] text-success",
  page: "bg-primary/[0.09] text-primary",
  file: "bg-warning/[0.09] text-warning",
  structured_result: "bg-violet-500/[0.09] text-violet-700 dark:text-violet-300",
};

export function formatCopy(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
export function kindLabel(kind: GoalAssetKind, copy: AssetWorkbenchCopy) {
  return {
    structured_result: copy.structuredResults,
    document: copy.documentKind,
    form: copy.formKind,
    page: copy.pageKind,
    file: copy.fileKind,
  }[kind];
}
export function roleLabel(role: GoalAssetWorkbenchData["role"], copy: AssetWorkbenchCopy) {
  return {
    working_document: copy.roleWorkingDocument,
    reference: copy.roleReference,
    evidence: copy.roleEvidence,
    submission: copy.roleSubmission,
    template: copy.roleTemplate,
  }[role ?? "working_document"];
}

export function sourceLabel(source: string, copy: AssetWorkbenchCopy) {
  return (
    {
      manual: copy.manualSource,
      ai_task: copy.aiTaskSource,
      inbox: copy.inboxSource,
      restored: copy.restoredSource,
      imported: copy.importedSource,
    }[source] ?? source
  );
}

export function contentText(content: unknown) {
  if (typeof content === "string") return content;
  return JSON.stringify(content ?? {}, null, 2);
}
export function parseContent(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
type FormFieldDefinition = {
  id: string;
  label: string;
  type: "text" | "textarea" | "checkbox";
  required: boolean;
  description?: string;
};

function normalizeFormField(item: unknown): FormFieldDefinition | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const field = item as Record<string, unknown>;
  const { id, label, type, required, description } = field;
  if (typeof id !== "string" || !id.trim()) return null;
  if (typeof label !== "string" || !label.trim()) return null;
  if (type !== "textarea" && type !== "checkbox" && type !== "text") return null;
  return {
    id,
    label,
    type,
    required: required === true,
    ...(typeof description === "string" ? { description } : {}),
  };
}
function formDefinition(value: string): { fields: FormFieldDefinition[] } | null {
  const parsed = parseContent(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const fields = (parsed as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return null;
  const normalized = fields.map(normalizeFormField);
  return normalized.length > 0 && normalized.every((field) => field !== null)
    ? { fields: normalized as FormFieldDefinition[] }
    : null;
}

function hasRequiredFormAnswers(
  fields: FormFieldDefinition[],
  answers: Record<string, string | boolean>,
) {
  return fields.every((field) => {
    if (!field.required) return true;
    const answer = answers[field.id];
    return field.type === "checkbox"
      ? answer === true
      : typeof answer === "string" && answer.trim().length > 0;
  });
}

type FormEditorProps = {
  asset: GoalAssetWorkbenchData;
  currentVersionId?: string;
  value: string;
  formalValue: string;
  setValue: (value: string) => void;
  pending: boolean;
  copy: AssetWorkbenchCopy;
  act: (action: () => Promise<unknown>, success: string) => Promise<void>;
};
function FormFieldInput({
  asset,
  field,
  answers,
  setAnswers,
  copy,
}: {
  asset: GoalAssetWorkbenchData;
  field: FormFieldDefinition;
  answers: Record<string, string | boolean>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string | boolean>>>;
  copy: AssetWorkbenchCopy;
}) {
  const id = `form-${asset.id}-${field.id}`;
  const description = field.description ? <p className="text-sm text-muted-foreground">{field.description}</p> : null;
  const label = <Label htmlFor={id}>{field.label}{field.required ? ` · ${copy.requiredField}` : ""}</Label>;
  if (field.type === "checkbox") {
    return (
      <div className="flex items-start gap-3">
        <Checkbox id={id} checked={answers[field.id] === true} onCheckedChange={(checked) => setAnswers((current) => ({ ...current, [field.id]: checked === true }))} />
        <div>{label}{description}</div>
      </div>
    );
  }
  const answer = answers[field.id];
  const value = typeof answer === "string" ? answer : "";
  return (
    <div className="space-y-2">
      {label}{description}
      {field.type === "textarea" ? <Textarea id={id} required={field.required} value={value} onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))} /> : <Input id={id} required={field.required} value={value} onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))} />}
    </div>
  );
}

function FormFillEditor({
  asset,
  currentVersionId,
  formalValue,
  pending,
  copy,
  act,
}: Pick<FormEditorProps, "asset" | "currentVersionId" | "formalValue" | "pending" | "copy" | "act">) {
  const definition = useMemo(() => formDefinition(formalValue), [formalValue]);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  useEffect(() => { setAnswers({}); }, [asset.id, currentVersionId]);
  if (!definition) {
    return <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{copy.invalidFormDefinition}</p>;
  }
  const valid = hasRequiredFormAnswers(definition.fields, answers);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!currentVersionId || !valid) return;
        void act(
          () => submitGoalForm(asset.goalId, asset.id, { workspaceId: asset.workspaceId, versionId: currentVersionId, content: answers }),
          copy.formSubmissionStored,
        );
      }}
    >
      {definition.fields.map((field) => <FormFieldInput key={field.id} asset={asset} field={field} answers={answers} setAnswers={setAnswers} copy={copy} />)}
      <Button type="submit" disabled={!currentVersionId || pending || !valid}>{copy.submitForm}</Button>
    </form>
  );
}

export function FormEditor(props: FormEditorProps) {
  return (
    <Tabs defaultValue="fill">
      <TabsList>
        <TabsTrigger value="fill">{props.copy.fillMode}</TabsTrigger>
        <TabsTrigger value="design">{props.copy.designMode}</TabsTrigger>
      </TabsList>
      <TabsContent value="fill" className="pt-4">
        <FormFillEditor {...props} />
      </TabsContent>
      <TabsContent value="design" className="pt-4">
        <Textarea
          aria-label={props.copy.formSchema}
          value={props.value}
          onChange={(event) => props.setValue(event.target.value)}
          className="min-h-64 font-mono text-xs"
        />
      </TabsContent>
    </Tabs>
  );
}

export function AssetTile({
  asset,
  copy,
  onOpen,
}: {
  asset: GoalAssetWorkbenchData;
  copy: AssetWorkbenchCopy;
  onOpen: () => void;
}) {
  const Icon = ICON_BY_KIND[asset.kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group min-w-0 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/25 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${KIND_TONE[asset.kind]}`}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-semibold leading-5">{asset.label}</p>
          <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">
            {asset.description || copy.activeVersionImpact}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">
          {roleLabel(asset.role, copy)}
        </span>
        <span aria-hidden>·</span>
        <span>{kindLabel(asset.kind, copy)}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">v{asset.versions[0]?.version ?? 1}</span>
      </div>
    </button>
  );
}
