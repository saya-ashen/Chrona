"use client";

import { useEffect, useMemo, useState } from "react";
import {
  File,
  FileSpreadsheet,
  FileText,
  FormInput,
  Globe2,
  Presentation,
} from "lucide-react";
import { Button } from "@shared/ui";
import { Checkbox } from "@shared/ui";




import { Input } from "@shared/ui";
import { Label } from "@shared/ui";




import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";
import { parseTablePreview } from "@features/task-workspace/ui/catalog/workspace-table-data";
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
  data_table: FileSpreadsheet,
  structured_result: FileText,
};
export type AssetWorkbenchCopy = GoalCopy["assetWorkbench"];
export const KIND_TONE: Record<GoalAssetKind, string> = {
  document: "bg-info/[0.09] text-info",
  form: "bg-success/[0.09] text-success",
  page: "bg-primary/[0.09] text-primary",
  file: "bg-warning/[0.09] text-warning",
  data_table: "bg-emerald-500/[0.09] text-emerald-700 dark:text-emerald-300",
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
    data_table: copy.dataTableKind,
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

export type AssetFreshness = "not_applicable" | "unknown" | "current" | "due_soon" | "overdue";

export function deriveAssetFreshness(asset: GoalAssetWorkbenchData, now = new Date()): AssetFreshness {
  const current = asset.versions[0];
  const review = asset.reviews.find((item) => item.versionId === current?.id);
  if (!review?.nextReviewAt) return review ? "current" : "not_applicable";
  const due = new Date(review.nextReviewAt).getTime();
  if (due <= now.getTime()) return "overdue";
  return due - now.getTime() <= 7 * 24 * 60 * 60 * 1000 ? "due_soon" : "current";
}

type AssetDisplayKind = "document" | "spreadsheet" | "form" | "page" | "file" | "structured_result";

const DISPLAY_KIND_BY_ASSET_KIND: Record<GoalAssetKind, AssetDisplayKind> = {
  document: "document",
  form: "form",
  page: "page",
  file: "file",
  data_table: "spreadsheet",
  structured_result: "structured_result",
};
const CSV_MIME_TYPES = new Set(["text/csv", "application/csv", "application/vnd.ms-excel"]);

export function assetDisplayKind(asset: GoalAssetWorkbenchData): AssetDisplayKind {
  const version = asset.versions[0];
  const mimeType = version?.mimeType?.toLowerCase() ?? "";
  const extension = version?.originalFilename?.toLowerCase().split(".").at(-1) ?? "";
  return extension === "csv" || CSV_MIME_TYPES.has(mimeType)
    ? "spreadsheet"
    : DISPLAY_KIND_BY_ASSET_KIND[asset.kind];
}

export function assetDisplayLabel(asset: GoalAssetWorkbenchData, copy: AssetWorkbenchCopy) {
  return assetDisplayKind(asset) === "spreadsheet" ? copy.dataTables : kindLabel(asset.kind, copy);
}

const DISPLAY_ICON: Record<AssetDisplayKind, typeof File> = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  form: FormInput,
  page: Globe2,
  file: File,
  structured_result: Presentation,
};

const DISPLAY_TONE: Record<AssetDisplayKind, string> = {
  document: "bg-sky-500/[0.10] text-sky-700 dark:text-sky-300",
  spreadsheet: "bg-emerald-500/[0.10] text-emerald-700 dark:text-emerald-300",
  form: "bg-success/[0.10] text-success",
  page: "bg-primary/[0.10] text-primary",
  file: "bg-warning/[0.10] text-warning",
  structured_result: "bg-violet-500/[0.10] text-violet-700 dark:text-violet-300",
};

function spreadsheetPreview(asset: GoalAssetWorkbenchData) {
  const version = asset.versions[0];
  if (typeof version?.content !== "string") return null;
  const parsed = parseTablePreview("csv", version.content);
  if (parsed.parseError || parsed.inferredColumns.length === 0) return null;
  return { columns: parsed.inferredColumns.slice(0, 4), rows: parsed.rows.slice(0, 4), totalRows: parsed.rows.length };
}

function SpreadsheetThumbnail({ asset }: { asset: GoalAssetWorkbenchData }) {
  const preview = spreadsheetPreview(asset);
  if (!preview) return null;
  return <div className="h-36 overflow-hidden bg-white text-[9px] leading-4 text-slate-700 dark:bg-slate-950 dark:text-slate-200"><table className="w-full table-fixed border-collapse"><thead><tr>{preview.columns.map((column) => <th key={column} className="truncate border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-left font-semibold dark:border-emerald-900 dark:bg-emerald-950">{column}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index}>{preview.columns.map((column) => <td key={column} className="truncate border border-slate-200 px-1.5 py-1 dark:border-slate-800">{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table><p className="px-2 py-1 text-emerald-700 dark:text-emerald-300">{preview.totalRows} rows</p></div>;
}

function textPreview(asset: GoalAssetWorkbenchData) {
  const version = asset.versions[0];
  const content = typeof version?.content === "string" ? version.content : typeof version?.content === "object" && version.content ? String((version.content as Record<string, unknown>).summary ?? "") : "";
  return content.replace(/^#{1,6}\s+/gm, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

function DocumentThumbnail({ asset }: { asset: GoalAssetWorkbenchData }) {
  const preview = textPreview(asset);
  if (!preview) return null;
  const midpoint = Math.max(1, Math.floor(preview.length / 2));
  return <div aria-hidden="true" className="mx-auto h-36 w-[78%] overflow-hidden border-x border-t bg-white px-3 py-3 shadow-sm dark:bg-slate-950"><div className="mb-2 h-1.5 w-1/2 rounded bg-sky-500/70" /><p className="line-clamp-6 text-[9px] leading-4 text-slate-600 dark:text-slate-300"><span>{preview.slice(0, midpoint)}</span><span>{preview.slice(midpoint)}</span></p></div>;
}

function AssetThumbnail({ asset }: { asset: GoalAssetWorkbenchData }) {
  const displayKind = assetDisplayKind(asset);
  return <div className="mb-3 overflow-hidden rounded-lg border bg-muted/30">{displayKind === "spreadsheet" ? <SpreadsheetThumbnail asset={asset} /> : <DocumentThumbnail asset={asset} />}</div>;
}

// Asset summaries intentionally dispatch across persisted asset kinds and content shapes.
// eslint-disable-next-line complexity
export function assetSummary(asset: GoalAssetWorkbenchData, copy: AssetWorkbenchCopy) {
  if (asset.description?.trim()) return asset.description;
  const current = asset.versions[0];
  if (asset.kind === "data_table" && current?.content && typeof current.content === "object" && !Array.isArray(current.content)) {
    const content = current.content as { columns?: unknown[]; rows?: unknown[] };
    return formatCopy(copy.dataTableSummary, { rows: content.rows?.length ?? 0, columns: content.columns?.length ?? 0 });
  }
  if (assetDisplayKind(asset) === "spreadsheet") return current?.originalFilename ?? asset.sourceArtifact.title;
  if (asset.kind === "structured_result") return formatCopy(copy.resultFromTask, { task: asset.sourceArtifact.title });
  return copy.missingAssetDescription;
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
  const displayKind = assetDisplayKind(asset);
  const Icon = DISPLAY_ICON[displayKind];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group min-w-0 overflow-hidden rounded-xl border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <AssetThumbnail asset={asset} />
      <div className="flex items-start gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${DISPLAY_TONE[displayKind]}`}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-semibold leading-5">{asset.label}</p>
          <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">{assetSummary(asset, copy)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{roleLabel(asset.role, copy)}</span>
        <span aria-hidden>·</span>
        <span>{assetDisplayLabel(asset, copy)}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">v{asset.versions[0]?.version ?? 1}</span>
        <span aria-hidden>·</span>
        <span>{new Date(asset.versions[0]?.createdAt ?? asset.updatedAt).toLocaleDateString()}</span>
        {asset.drafts.length ? <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-warning">{copy.draftAvailable}</span> : null}
        {deriveAssetFreshness(asset) === "due_soon" ? <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-warning">{copy.reviewDueSoon}</span> : null}
        {deriveAssetFreshness(asset) === "overdue" ? <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-destructive">{copy.reviewOverdue}</span> : null}
      </div>
    </button>
  );
}
