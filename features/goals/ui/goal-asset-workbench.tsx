"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  Download,
  File,
  FileText,
  FormInput,
  Globe2,
  History,
  Inbox,
  Loader2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useRevalidator, useSearchParams } from "react-router-dom";
import { Badge } from "@shared/ui";
import { Button } from "@shared/ui";
import { Checkbox } from "@shared/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shared/ui";
import { Input } from "@shared/ui";
import { Label } from "@shared/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/ui";
import { Separator } from "@shared/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@shared/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/ui";
import { Textarea } from "@shared/ui";
import {
  archiveGoalAsset,
  createGoalAssetJob,
  createGoalAssetModificationTask,
  renameGoalAsset,
  resolveGoalInboxCandidate,
  restoreGoalAssetVersion,
  saveGoalAssetDraft,
  submitGoalAssetDraft,
  submitGoalForm,
  type GoalAssetKind,
  type GoalAssetWorkbenchData,
  type GoalInboxCandidateData,
} from "../workbench-api";
import type { GoalCopy } from "../model/goal-types";

const ICON_BY_KIND: Record<GoalAssetKind, typeof File> = {
  document: FileText,
  form: FormInput,
  page: Globe2,
  file: File,
};
type AssetWorkbenchCopy = GoalCopy["assetWorkbench"];
const KIND_TONE: Record<GoalAssetKind, string> = {
  document: "bg-info/[0.09] text-info",
  form: "bg-success/[0.09] text-success",
  page: "bg-primary/[0.09] text-primary",
  file: "bg-warning/[0.09] text-warning",
};

function formatCopy(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
function kindLabel(kind: GoalAssetKind, copy: AssetWorkbenchCopy) {
  return {
    document: copy.documentKind,
    form: copy.formKind,
    page: copy.pageKind,
    file: copy.fileKind,
  }[kind];
}

function sourceLabel(source: string, copy: AssetWorkbenchCopy) {
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

function contentText(content: unknown) {
  if (typeof content === "string") return content;
  return JSON.stringify(content ?? {}, null, 2);
}
function parseContent(value: string) {
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

function formDefinition(
  value: string,
): { fields: FormFieldDefinition[] } | null {
  const parsed = parseContent(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const fields = (parsed as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return null;
  const normalized: FormFieldDefinition[] = [];
  for (const item of fields) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const field = item as Record<string, unknown>;
    if (
      typeof field.id !== "string" ||
      !field.id.trim() ||
      typeof field.label !== "string" ||
      !field.label.trim()
    )
      return null;
    const type =
      field.type === "textarea" || field.type === "checkbox"
        ? field.type
        : field.type === "text"
          ? "text"
          : null;
    if (!type) return null;
    normalized.push({
      id: field.id,
      label: field.label,
      type,
      required: field.required === true,
      ...(typeof field.description === "string"
        ? { description: field.description }
        : {}),
    });
  }
  return normalized.length > 0 ? { fields: normalized } : null;
}

function FormFillEditor({
  asset,
  currentVersionId,
  formalValue,
  pending,
  copy,
  act,
}: Pick<
  Parameters<typeof AssetContentEditor>[0],
  "asset" | "currentVersionId" | "formalValue" | "pending" | "copy" | "act"
>) {
  const definition = useMemo(() => formDefinition(formalValue), [formalValue]);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  useEffect(() => {
    setAnswers({});
  }, [asset.id, currentVersionId]);
  if (!definition)
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        {copy.invalidFormDefinition}
      </p>
    );
  const valid = definition.fields.every((field) => {
    if (!field.required) return true;
    const answer = answers[field.id];
    return field.type === "checkbox"
      ? answer === true
      : typeof answer === "string" && answer.trim().length > 0;
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (currentVersionId && valid)
          void act(
            () =>
              submitGoalForm(asset.goalId, asset.id, {
                workspaceId: asset.workspaceId,
                versionId: currentVersionId,
                content: answers,
              }),
            copy.formSubmissionStored,
          );
      }}
    >
      {definition.fields.map((field) => (
        <div key={field.id} className="space-y-2">
          {field.type === "checkbox" ? (
            <div className="flex items-start gap-3">
              <Checkbox
                id={`form-${asset.id}-${field.id}`}
                checked={answers[field.id] === true}
                onCheckedChange={(checked) =>
                  setAnswers((current) => ({
                    ...current,
                    [field.id]: checked === true,
                  }))
                }
              />
              <div>
                <Label htmlFor={`form-${asset.id}-${field.id}`}>
                  {field.label}
                  {field.required ? ` · ${copy.requiredField}` : ""}
                </Label>
                {field.description ? (
                  <p className="text-sm text-muted-foreground">
                    {field.description}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <Label htmlFor={`form-${asset.id}-${field.id}`}>
                {field.label}
                {field.required ? ` · ${copy.requiredField}` : ""}
              </Label>
              {field.description ? (
                <p className="text-sm text-muted-foreground">
                  {field.description}
                </p>
              ) : null}
              {field.type === "textarea" ? (
                <Textarea
                  id={`form-${asset.id}-${field.id}`}
                  required={field.required}
                  value={
                    typeof answers[field.id] === "string"
                      ? (answers[field.id] as string)
                      : ""
                  }
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [field.id]: event.target.value,
                    }))
                  }
                />
              ) : (
                <Input
                  id={`form-${asset.id}-${field.id}`}
                  required={field.required}
                  value={
                    typeof answers[field.id] === "string"
                      ? (answers[field.id] as string)
                      : ""
                  }
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [field.id]: event.target.value,
                    }))
                  }
                />
              )}
            </>
          )}
        </div>
      ))}
      <Button type="submit" disabled={!currentVersionId || pending || !valid}>
        {copy.submitForm}
      </Button>
    </form>
  );
}

function FormEditor(
  props: Pick<
    Parameters<typeof AssetContentEditor>[0],
    | "asset"
    | "currentVersionId"
    | "value"
    | "formalValue"
    | "setValue"
    | "pending"
    | "copy"
    | "act"
  >,
) {
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

function AssetTile({
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
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
            {asset.sourceArtifact.title}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs font-medium text-muted-foreground">
          {kindLabel(asset.kind, copy)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          v{asset.versions[0]?.version ?? 1}
        </span>
      </div>
    </button>
  );
}

function inboxReasonLabel(reason: string, copy: AssetWorkbenchCopy) {
  return reason === "No confident existing asset identity match"
    ? copy.noConfidentAssetMatch
    : reason;
}

function inboxChangeSummaryLabel(
  summary: string,
  candidateLabel: string,
  copy: AssetWorkbenchCopy,
) {
  return summary ===
    `Candidate derived from accepted result “${candidateLabel}”`
    ? formatCopy(copy.candidateFromAcceptedResult, { result: candidateLabel })
    : summary;
}

function InboxCandidate({
  goalId,
  candidate,
  workspaceId,
  assets,
  copy,
  onResolved,
}: {
  goalId: string;
  candidate: GoalInboxCandidateData;
  workspaceId: string;
  assets: GoalAssetWorkbenchData[];
  copy: AssetWorkbenchCopy;
  onResolved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetAssetId, setTargetAssetId] = useState(
    candidate.proposedTargetAssetId ?? "new",
  );
  const selectedTarget = assets.find((asset) => asset.id === targetAssetId);
  async function resolve(action: "create_asset" | "append_version" | "reject") {
    setPending(true);
    setError(null);
    try {
      if (action === "create_asset")
        await resolveGoalInboxCandidate(goalId, candidate.id, {
          workspaceId,
          action,
          label: candidate.label,
        });
      else if (
        action === "append_version" &&
        targetAssetId !== "new" &&
        selectedTarget?.versions[0]
      )
        await resolveGoalInboxCandidate(goalId, candidate.id, {
          workspaceId,
          action,
          targetAssetId,
          baseVersionId: selectedTarget.versions[0].id,
          changeSummary: candidate.changeSummary,
        });
      else if (action === "reject")
        await resolveGoalInboxCandidate(goalId, candidate.id, {
          workspaceId,
          action,
        });
      onResolved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : copy.candidateUpdateFailed,
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{kindLabel(candidate.kind, copy)}</Badge>
          <Badge variant="outline">
            {Math.round(candidate.confidence * 100)}% {copy.match}
          </Badge>
        </div>
        <CardTitle className="text-base">{candidate.label}</CardTitle>
        <CardDescription>
          {inboxReasonLabel(candidate.reason, copy)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{copy.sourceTask}</dt>
            <dd className="font-medium">{candidate.sourceTask.title}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{copy.changeSummary}</dt>
            <dd>
              {inboxChangeSummaryLabel(
                candidate.changeSummary,
                candidate.label,
                copy,
              )}
            </dd>
          </div>
        </dl>
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
          {contentText(candidate.content)}
        </pre>
        <div className="space-y-2">
          <Label htmlFor={`candidate-target-${candidate.id}`}>
            {copy.assetDestination}
          </Label>
          <Select value={targetAssetId} onValueChange={setTargetAssetId}>
            <SelectTrigger id={`candidate-target-${candidate.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">{copy.createNewAsset}</SelectItem>
              {assets
                .filter(
                  (asset) => !asset.archivedAt && asset.kind === candidate.kind,
                )
                .map((asset) => (
                  <SelectItem key={asset.id} value={asset.id}>
                    {formatCopy(copy.appendToAsset, { asset: asset.label })}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              void resolve(
                targetAssetId === "new" ? "create_asset" : "append_version",
              )
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {targetAssetId === "new" ? copy.createAsset : copy.appendVersion}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void resolve("reject")}
          >
            {copy.rejectCandidate}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AssetContentEditor({
  asset,
  currentVersionId,
  value,
  formalValue,
  setValue,
  pending,
  copy,
  act,
}: {
  asset: GoalAssetWorkbenchData;
  currentVersionId?: string;
  value: string;
  formalValue: string;
  setValue: (value: string) => void;
  pending: boolean;
  copy: AssetWorkbenchCopy;
  act: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  if (asset.kind === "page") {
    const content = parseContent(value);
    const source =
      typeof content === "string"
        ? content
        : `<pre>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre>`;
    return (
      <div className="space-y-3">
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          {copy.pageSafetyWarning}
        </div>
        <div className="h-full min-h-[30rem] overflow-hidden rounded-lg border bg-white">
          <iframe
            title={asset.label}
            sandbox="allow-scripts allow-forms allow-modals"
            srcDoc={source}
            className="h-full min-h-[30rem] w-full"
          />
        </div>
      </div>
    );
  }
  if (asset.kind === "file")
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 text-center">
        <File className="size-14 text-muted-foreground" />
        <p className="mt-4 font-medium">{asset.sourceArtifact.title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {copy.genericFileDescription}
        </p>
      </div>
    );
  if (asset.kind === "form")
    return (
      <FormEditor
        asset={asset}
        currentVersionId={currentVersionId}
        value={value}
        formalValue={formalValue}
        setValue={setValue}
        pending={pending}
        copy={copy}
        act={act}
      />
    );
  return (
    <Textarea
      aria-label={copy.documentContent}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className="min-h-[30rem] resize-y font-mono text-sm leading-6"
    />
  );
}

function AssetEditor({
  goalId,
  workspaceId,
  asset,
  copy,
  onRefresh,
}: {
  goalId: string;
  workspaceId: string;
  asset: GoalAssetWorkbenchData;
  copy: AssetWorkbenchCopy;
  onRefresh: () => void;
}) {
  const current = asset.versions[0];
  const draft = asset.drafts[0];
  const [value, setValue] = useState(
    contentText(
      draft?.content ??
        current?.content ??
        asset.sourceArtifact.contentPreview ??
        "",
    ),
  );
  const [label, setLabel] = useState(asset.label);
  const [instruction, setInstruction] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const initialValue = useRef(value);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    const nextValue = contentText(
      draft?.content ??
        current?.content ??
        asset.sourceArtifact.contentPreview ??
        "",
    );
    clearTimeout(autosaveTimer.current);
    setValue(nextValue);
    setLabel(asset.label);
    setInstruction("");
    setMessage(null);
    initialValue.current = nextValue;
  }, [asset.id]);
  useEffect(() => {
    if (
      !current ||
      (asset.kind !== "document" && asset.kind !== "form") ||
      value === initialValue.current ||
      pending
    )
      return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void act(
        () =>
          saveGoalAssetDraft(goalId, asset.id, {
            workspaceId,
            baseVersionId: current.id,
            authorType: "user",
            content: parseContent(value) as
              string | Record<string, unknown> | unknown[],
          }),
        copy.draftAutosaved,
      );
      initialValue.current = value;
    }, 800);
    return () => clearTimeout(autosaveTimer.current);
  }, [asset.id, asset.kind, current, goalId, pending, value, workspaceId]);
  async function act(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : copy.actionFailed);
    } finally {
      setPending(false);
    }
  }
  async function ensureDraft() {
    if (!current) return null;
    const created = await saveGoalAssetDraft(goalId, asset.id, {
      workspaceId,
      baseVersionId: current.id,
      authorType: "user",
      content: parseContent(value) as
        string | Record<string, unknown> | unknown[],
    });
    initialValue.current = value;
    return created.id;
  }
  async function save() {
    if (!current) return;
    clearTimeout(autosaveTimer.current);
    await act(async () => {
      await ensureDraft();
    }, copy.draftSaved);
  }
  async function publish() {
    if (!current) return;
    clearTimeout(autosaveTimer.current);
    setPending(true);
    setMessage(null);
    try {
      const draftId = await ensureDraft();
      if (!draftId) return;
      await submitGoalAssetDraft(goalId, asset.id, {
        workspaceId,
        draftId,
        changeSummary: copy.manualEditSummary,
      });
      setMessage(copy.newFormalVersionCreated);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : copy.actionFailed);
    } finally {
      setPending(false);
    }
  }
  function downloadSource() {
    if (!current) return;
    const anchor = document.createElement("a");
    anchor.href = `/api/goals/${encodeURIComponent(goalId)}/assets/${encodeURIComponent(asset.id)}/download?versionId=${encodeURIComponent(current.id)}&mode=source`;
    anchor.download =
      current.originalFilename ?? `${asset.label}-v${current.version}`;
    anchor.rel = "noopener";
    anchor.click();
  }

  function downloadSubmission(
    asset: GoalAssetWorkbenchData,
    submission: GoalAssetWorkbenchData["submissions"][number],
  ) {
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(
      new Blob([JSON.stringify(submission.content, null, 2)], {
        type: "application/json",
      }),
    );
    anchor.download = `${asset.label}-submission-${submission.id}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[14rem_minmax(0,1fr)_17rem]">
      <aside className="border-b bg-muted/20 p-4 xl:border-b-0 xl:border-r">
        <Label htmlFor="asset-title">{copy.titleLabel}</Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="asset-title"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void act(
                () => renameGoalAsset(goalId, asset.id, label),
                copy.renamed,
              )
            }
          >
            {copy.save}
          </Button>
        </div>
        <Separator className="my-4" />
        <p className="text-sm font-medium">{copy.asset}</p>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{copy.type}</dt>
            <dd>{kindLabel(asset.kind, copy)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{copy.source}</dt>
            <dd className="break-words">{asset.sourceArtifact.title}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{copy.formalVersion}</dt>
            <dd>v{current?.version ?? 1}</dd>
          </div>
        </dl>
      </aside>
      <main className="min-h-[26rem] p-4 sm:p-6 xl:p-8">
        <AssetContentEditor
          asset={asset}
          currentVersionId={current?.id}
          value={value}
          formalValue={contentText(
            current?.content ?? asset.sourceArtifact.contentPreview ?? "",
          )}
          setValue={setValue}
          pending={pending}
          copy={copy}
          act={act}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={pending || asset.kind === "file" || asset.kind === "page"}
            onClick={() => void save()}
          >
            {copy.saveDraft}
          </Button>
          <Button
            variant="outline"
            disabled={pending || asset.kind === "file" || asset.kind === "page"}
            onClick={() => void publish()}
          >
            {copy.publishVersion}
          </Button>
          <Button variant="outline" onClick={downloadSource}>
            <Download className="size-4" />
            {copy.downloadSource}
          </Button>
          <Button
            variant="outline"
            disabled={!current || pending}
            onClick={() =>
              current &&
              void act(
                () =>
                  createGoalAssetJob(goalId, asset.id, {
                    workspaceId,
                    versionId: current.id,
                    kind: "export",
                    format: asset.kind === "document" ? "md" : "json",
                  }),
                copy.exportReady,
              )
            }
          >
            <Download className="size-4" />
            {copy.export}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void act(
                () =>
                  archiveGoalAsset(
                    goalId,
                    asset.id,
                    workspaceId,
                    asset.archivedAt ? "restore" : "archive",
                  ),
                asset.archivedAt ? copy.assetRestored : copy.assetArchived,
              )
            }
          >
            <Archive className="size-4" />
            {asset.archivedAt ? copy.restore : copy.archived}
          </Button>
        </div>
        {message ? (
          <div
            role="status"
            className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm"
          >
            {message}
          </div>
        ) : null}
      </main>
      <aside className="border-t bg-muted/10 p-4 xl:border-l xl:border-t-0">
        <Tabs defaultValue="versions">
          <TabsList
            className={`grid w-full ${asset.kind === "form" ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <TabsTrigger value="versions">{copy.versions}</TabsTrigger>
            {asset.kind === "form" ? (
              <TabsTrigger value="submissions">{copy.submissions}</TabsTrigger>
            ) : null}
            <TabsTrigger value="ai">{copy.ai}</TabsTrigger>
          </TabsList>
          <TabsContent value="versions" className="space-y-3 pt-3">
            {asset.versions.map((version) => (
              <div key={version.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">v{version.version}</span>
                  <Badge variant="outline">
                    {sourceLabel(version.source, copy)}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {version.changeSummary ?? copy.formalVersionFallback}
                </p>
                {version.id !== current?.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    disabled={pending}
                    onClick={() =>
                      void act(
                        () =>
                          restoreGoalAssetVersion(
                            goalId,
                            asset.id,
                            version.id,
                            workspaceId,
                            `Restore v${version.version}`,
                          ),
                        formatCopy(copy.recoveredVersion, {
                          version: version.version,
                        }),
                      )
                    }
                  >
                    <History className="size-4" />
                    {copy.recover}
                  </Button>
                ) : null}
              </div>
            ))}
          </TabsContent>
          {asset.kind === "form" ? (
            <TabsContent value="submissions" className="space-y-3 pt-3">
              {asset.submissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {copy.noSubmissions}
                </p>
              ) : (
                asset.submissions.map((submission) => (
                  <div key={submission.id} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      {new Date(submission.createdAt).toLocaleString()}
                    </p>
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(submission.content, null, 2)}
                    </pre>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => downloadSubmission(asset, submission)}
                    >
                      <Download className="size-4" />
                      {copy.downloadSubmission}
                    </Button>
                  </div>
                ))
              )}
            </TabsContent>
          ) : null}
          <TabsContent value="ai" className="space-y-3 pt-3">
            <Label htmlFor="asset-ai-instruction">
              {copy.modificationRequest}
            </Label>
            <Textarea
              id="asset-ai-instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={copy.modificationPlaceholder}
            />
            <Button
              className="w-full"
              disabled={!instruction.trim() || !current || pending}
              onClick={() =>
                current &&
                void act(
                  () =>
                    createGoalAssetModificationTask(goalId, asset.id, {
                      workspaceId,
                      versionId: current.id,
                      instruction,
                      expectedOutcome: formatCopy(
                        copy.expectedModifiedOutcome,
                        { asset: asset.label },
                      ),
                    }),
                  copy.versionBoundTaskCreated,
                )
              }
            >
              <Sparkles className="size-4" />
              {copy.createAiTask}
            </Button>
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}

export function GoalAssetWorkbench({
  goalId,
  workspaceId,
  copy,
  initialAssets,
  initialRecent,
  initialCandidates,
}: {
  goalId: string;
  workspaceId: string;
  copy: GoalCopy["assetWorkbench"];
  initialAssets: GoalAssetWorkbenchData[];
  initialRecent: GoalAssetWorkbenchData[];
  initialCandidates: GoalInboxCandidateData[];
}) {
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(
    () => searchParams.get("assetQuery") ?? "",
  );
  const [state, setState] = useState(
    () => searchParams.get("assetState") ?? "all",
  );
  const sourceTasks = useMemo(
    () =>
      Array.from(
        new Map(
          initialAssets.map((asset) => [
            asset.sourceArtifact.taskId,
            {
              id: asset.sourceArtifact.taskId,
              label: asset.sourceArtifact.title,
            },
          ]),
        ).values(),
      ),
    [initialAssets],
  );
  const [sourceTaskId, setSourceTaskId] = useState(
    () => searchParams.get("assetSourceTask") ?? "all",
  );
  const [kind, setKind] = useState<"all" | GoalAssetKind>(
    () => (searchParams.get("assetKind") as GoalAssetKind | null) ?? "all",
  );
  const [sort, setSort] = useState(
    () => searchParams.get("assetSort") ?? "updated_desc",
  );
  const assetView =
    searchParams.get("assetView") === "inbox" ? "inbox" : "library";
  useEffect(() => {
    setQuery(searchParams.get("assetQuery") ?? "");
    const nextState = searchParams.get("assetState") ?? "all";
    setState(nextState);
    setSourceTaskId(searchParams.get("assetSourceTask") ?? "all");
    setKind((searchParams.get("assetKind") as GoalAssetKind | null) ?? "all");
    setSort(searchParams.get("assetSort") ?? "updated_desc");
  }, [searchParams]);
  const selectedAssetId = searchParams.get("asset");
  const selected =
    initialAssets.find((asset) => asset.id === selectedAssetId) ?? null;
  function updateWorkbenchParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }
  const refresh = () => revalidator.revalidate();
  const assets = useMemo(
    () =>
      initialAssets
        .filter((asset) => {
          const matchesState =
            state === "archived"
              ? Boolean(asset.archivedAt)
              : !asset.archivedAt &&
                (state === "all" ||
                  (state === "draft" && asset.drafts.length > 0) ||
                  (state === "running" &&
                    asset.jobs.some(
                      (job) =>
                        job.status === "Queued" || job.status === "Processing",
                    )) ||
                  (state === "failed" &&
                    asset.jobs.some((job) => job.status === "Failed")));
          return (
            matchesState &&
            (!query ||
              asset.label.toLowerCase().includes(query.toLowerCase())) &&
            (kind === "all" || asset.kind === kind) &&
            (sourceTaskId === "all" ||
              asset.sourceArtifact.taskId === sourceTaskId)
          );
        })
        .sort((left, right) =>
          sort === "name_asc"
            ? left.label.localeCompare(right.label)
            : sort === "updated_asc"
              ? left.updatedAt.localeCompare(right.updatedAt)
              : right.updatedAt.localeCompare(left.updatedAt),
        ),
    [initialAssets, query, kind, sourceTaskId, state, sort],
  );
  return (
    <section aria-labelledby="goal-asset-workbench" className="space-y-5">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2
            id="goal-asset-workbench"
            className="text-2xl font-semibold tracking-tight"
          >
            {copy.title}
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {initialAssets.length} {copy.assetCount}
        </p>
      </div>
      <Tabs
        value={assetView}
        onValueChange={(value) =>
          updateWorkbenchParams({
            assetView: value === "library" ? null : value,
          })
        }
      >
        <TabsList className="bg-muted/60">
          <TabsTrigger value="library">
            <FileText className="size-4" />
            {copy.library}
          </TabsTrigger>
          <TabsTrigger
            value="inbox"
            className={
              initialCandidates.length
                ? "text-warning data-[state=active]:text-warning"
                : ""
            }
          >
            <Inbox className="size-4" />
            {copy.inbox}
            <Badge
              variant={initialCandidates.length ? "destructive" : "secondary"}
            >
              {initialCandidates.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="library" className="space-y-6 pt-4">
          <div className="space-y-3 border-b pb-5">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label={copy.searchAssets}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    updateWorkbenchParams({
                      assetQuery: event.target.value || null,
                    });
                  }}
                  placeholder={copy.searchAssets}
                  className="pl-9"
                />
              </div>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value as typeof kind);
                  updateWorkbenchParams({
                    assetKind: value === "all" ? null : value,
                  });
                }}
              >
                <SelectTrigger aria-label={copy.allTypes}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{copy.allTypes}</SelectItem>
                  <SelectItem value="document">{copy.documents}</SelectItem>
                  <SelectItem value="form">{copy.forms}</SelectItem>
                  <SelectItem value="page">{copy.pages}</SelectItem>
                  <SelectItem value="file">{copy.files}</SelectItem>
                </SelectContent>
              </Select>
              <details className="group">
                <summary className="flex h-9 cursor-pointer list-none items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <SlidersHorizontal className="size-4" />
                  {copy.filters}
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-3 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-3">
                  <Select
                    value={sourceTaskId}
                    onValueChange={(value) => {
                      setSourceTaskId(value);
                      updateWorkbenchParams({
                        assetSourceTask: value === "all" ? null : value,
                      });
                    }}
                  >
                    <SelectTrigger aria-label={copy.allSources}>
                      <SelectValue placeholder={copy.allSources} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.allSources}</SelectItem>
                      {sourceTasks.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={state}
                    onValueChange={(value) => {
                      setState(value);
                      updateWorkbenchParams({
                        assetState: value === "all" ? null : value,
                      });
                    }}
                  >
                    <SelectTrigger aria-label={copy.allStatuses}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.allStatuses}</SelectItem>
                      <SelectItem value="draft">{copy.draft}</SelectItem>
                      <SelectItem value="running">{copy.processing}</SelectItem>
                      <SelectItem value="failed">{copy.failed}</SelectItem>
                      <SelectItem value="archived">{copy.archived}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={sort}
                    onValueChange={(value) => {
                      setSort(value);
                      updateWorkbenchParams({
                        assetSort: value === "updated_desc" ? null : value,
                      });
                    }}
                  >
                    <SelectTrigger aria-label={copy.recentlyUpdated}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="updated_desc">
                        {copy.recentlyUpdated}
                      </SelectItem>
                      <SelectItem value="updated_asc">
                        {copy.oldestUpdated}
                      </SelectItem>
                      <SelectItem value="name_asc">{copy.name}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </details>
            </div>
            {kind !== "all" ||
            sourceTaskId !== "all" ||
            state !== "all" ||
            sort !== "updated_desc" ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{copy.activeFilters}</span>
                {kind !== "all" ? (
                  <Badge variant="outline">{kindLabel(kind, copy)}</Badge>
                ) : null}
                {sourceTaskId !== "all" ? (
                  <Badge variant="outline">
                    {
                      sourceTasks.find((source) => source.id === sourceTaskId)
                        ?.label
                    }
                  </Badge>
                ) : null}
                {state !== "all" ? (
                  <Badge variant="outline">
                    {state === "archived" ? copy.archived : state}
                  </Badge>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() =>
                    updateWorkbenchParams({
                      assetKind: null,
                      assetSourceTask: null,
                      assetState: null,
                      assetSort: null,
                    })
                  }
                >
                  {copy.clearFilters}
                </Button>
              </div>
            ) : null}
          </div>
          {initialRecent.filter((asset) => !asset.archivedAt).length > 0 ? (
            <section>
              <h3 className="mb-3 text-sm font-semibold">{copy.recent}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {initialRecent
                  .filter((asset) => !asset.archivedAt)
                  .map((asset) => (
                    <AssetTile
                      key={asset.id}
                      asset={asset}
                      copy={copy}
                      onOpen={() => updateWorkbenchParams({ asset: asset.id })}
                    />
                  ))}
              </div>
            </section>
          ) : null}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{copy.allAssets}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                {assets.length}
              </span>
            </div>
            {assets.length === 0 ? (
              <div className="rounded-xl border border-dashed px-5 py-10 text-center">
                <Upload className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 font-medium">{copy.noAssets}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy.noAssetsDescription}
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {assets.map((asset) => (
                  <AssetTile
                    key={asset.id}
                    asset={asset}
                    copy={copy}
                    onOpen={() => updateWorkbenchParams({ asset: asset.id })}
                  />
                ))}
              </div>
            )}
          </section>
        </TabsContent>
        <TabsContent value="inbox" className="space-y-4 pt-4">
          {initialCandidates.length === 0 ? (
            <div className="rounded-xl border border-dashed px-5 py-10 text-center">
              <Inbox className="mx-auto size-8 text-success" />
              <p className="mt-3 font-medium">{copy.inboxClear}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.inboxClearDescription}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {initialCandidates.map((candidate) => (
                <InboxCandidate
                  key={candidate.id}
                  goalId={goalId}
                  candidate={candidate}
                  workspaceId={workspaceId}
                  assets={initialAssets}
                  copy={copy}
                  onResolved={refresh}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) updateWorkbenchParams({ asset: null });
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="flex w-full! max-w-none! flex-col gap-0 p-0 sm:w-[min(92vw,76rem)]!"
        >
          <SheetHeader className="border-b px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SheetTitle>{selected?.label}</SheetTitle>
                <SheetDescription>
                  {selected
                    ? formatCopy(copy.provenanceDescription, {
                        kind: kindLabel(selected.kind, copy),
                      })
                    : ""}
                </SheetDescription>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={copy.closeAssetWorkspace}
                onClick={() => updateWorkbenchParams({ asset: null })}
              >
                <X className="size-4" />
              </Button>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            {selected ? (
              <AssetEditor
                goalId={goalId}
                workspaceId={workspaceId}
                asset={selected}
                copy={copy}
                onRefresh={refresh}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
