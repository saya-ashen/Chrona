"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Check, ExternalLink, FileText, LinkIcon, Play, RotateCcw, Send, Sparkles, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExecutionActionInput, NodeResultEvidence, NodeResultOutput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { TaskExecutionDispatchResult } from "@/components/tasks/task-workspace-query";
import { buildWorkspaceCheckpointActionInput } from "@/components/tasks/workspace/model/task-workspace-actions";
import { DEFAULT_GRAPH_COPY } from "./constants";
import { interactionLabel } from "./logic";
import { jsonOutputText } from "./result-output-format";
import type { GraphCopy, PlanNodeAction, PlanNodeDataModel, PlanNodeField } from "./types";

type RunPanelMode = PlanNodeDataModel["interactionType"];

function getRunPanelTheme(mode: RunPanelMode) {
  switch (mode) {
    case "execute":
      return { badge: "border-primary/20 bg-primary-soft text-primary", card: "border-primary/20 bg-primary-soft/60" };
    case "confirm":
      return { badge: "border-primary/20 bg-primary-soft text-primary", card: "border-primary/20 bg-primary-soft/60" };
    case "choose":
      return { badge: "border-amber-300/30 bg-amber-500/10 text-amber-800 dark:text-amber-200", card: "border-amber-300/30 bg-amber-500/10" };
    case "input":
      return { badge: "bg-amber-500/14 text-amber-800 dark:text-amber-200", card: "border-amber-200/70 bg-amber-50/70 dark:border-amber-400/20 dark:bg-amber-500/10" };
    case "edit":
      return { badge: "border-primary/20 bg-primary-soft text-primary", card: "border-primary/20 bg-primary-soft/60" };
    case "approve":
      return { badge: "border-primary/20 bg-primary-soft text-primary", card: "border-primary/20 bg-primary-soft/60" };
    case "retry":
      return { badge: "border-destructive/30 bg-destructive/10 text-destructive", card: "border-destructive/25 bg-destructive/10" };
    case "wait":
      return { badge: "border-border bg-muted text-muted-foreground", card: "border-border bg-muted/45" };
    default:
      return { badge: "border-border bg-muted text-muted-foreground", card: "border-border bg-muted/45" };
  }
}

function getRunPanelHints(mode: RunPanelMode, graphCopy: GraphCopy) {
  switch (mode) {
    case "execute":
      return [graphCopy.runHintExecuteReview, graphCopy.runHintExecuteEntry];
    case "confirm":
      return [graphCopy.runHintConfirmReview, graphCopy.runHintConfirmPrereq];
    case "choose":
      return [graphCopy.runHintChoosePick, graphCopy.runHintChooseDownstream];
    case "input":
      return [graphCopy.runHintInputFill, graphCopy.runHintInputContext];
    case "edit":
      return [graphCopy.runHintEditRevise, graphCopy.runHintEditCheckpoint];
    case "approve":
      return [graphCopy.runHintApproveGate, graphCopy.runHintApproveIntent];
    case "retry":
      return [graphCopy.runHintRetryCause, graphCopy.runHintRetryUse];
    case "wait":
      return [graphCopy.runHintWaitManual, graphCopy.runHintWaitMonitor];
    default:
      return [graphCopy.runHintObserveContext, graphCopy.runHintObserveAdvance];
  }
}

function buildDefaultFieldValues(fields: PlanNodeField[]) {
  return Object.fromEntries(fields.map((field) => [field.key, field.value || ""]));
}

function defaultActionForNode(node: PlanNodeDataModel) {
  return node.availableActions?.find((action) => action.emphasis === "primary")?.id
    ?? node.availableActions?.[0]?.id
    ?? null;
}

function isNodeExecutionRunning(node: PlanNodeDataModel) {
  return node.active === true || node.status === "active" || node.status === "in_progress";
}

function ActionButton({ action, isActive, disabled, onClick }: { action: PlanNodeAction; isActive: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variant={isActive ? "default" : "outline"}
      size="sm"
      className="rounded-xl"
    >
      {action.label}
    </Button>
  );
}

function RunField({ field, value, invalid, error, graphCopy, onChange }: { field: PlanNodeField; value: string; invalid?: boolean; error?: { message?: string }; graphCopy: GraphCopy; onChange: (value: string) => void }) {
  const fieldId = `run-panel-${field.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const commonLabel = (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground">{field.label}</span>
      {field.required ? <span className="rounded-full border border-primary/20 bg-primary-soft px-1.5 py-0.5 text-[10px] text-primary">{graphCopy.fieldRequired}</span> : null}
    </div>
  );

  if (field.control === "textarea") {
    return (
      <Field data-invalid={invalid} className="gap-2">
        <FieldLabel htmlFor={fieldId}>{commonLabel}</FieldLabel>
        <Textarea
          id={fieldId}
          aria-invalid={invalid}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-24 rounded-xl border-border/70 bg-background/80 text-sm"
          placeholder={`${graphCopy.runFieldPlaceholderPrefix} ${field.label.toLowerCase()}...`}
        />
        {invalid ? <FieldError errors={[error]} /> : null}
      </Field>
    );
  }

  if (field.control === "select" || field.control === "approval") {
    return (
      <Field data-invalid={invalid} className="gap-2">
        <FieldLabel htmlFor={fieldId}>{commonLabel}</FieldLabel>
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger id={fieldId} aria-invalid={invalid} className="w-full rounded-xl border-border/70 bg-background/80 text-sm">
            <SelectValue placeholder={graphCopy.runSelectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
          {(field.options ?? [graphCopy.runApprovalOptionApprove, graphCopy.runApprovalOptionReject, graphCopy.runApprovalOptionNeedsChanges]).map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {invalid ? <FieldError errors={[error]} /> : null}
      </Field>
    );
  }

  return (
    <Field data-invalid={invalid} className="gap-2">
      <FieldLabel htmlFor={fieldId}>{commonLabel}</FieldLabel>
      <Input
        id={fieldId}
        aria-invalid={invalid}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border-border/70 bg-background/80 text-sm"
        placeholder={`${graphCopy.runFieldPlaceholderPrefix} ${field.label.toLowerCase()}...`}
      />
      {invalid ? <FieldError errors={[error]} /> : null}
    </Field>
  );
}

function getActionVerb(action: PlanNodeAction | null, graphCopy: GraphCopy) {
  if (!action) return graphCopy.runActionSend;
  if (action.kind === "approve") return graphCopy.runActionApprove;
  if (action.kind === "confirm") return graphCopy.runActionConfirm;
  if (action.kind === "choose") return graphCopy.runActionChoose;
  if (action.kind === "edit") return graphCopy.runActionSubmit;
  if (action.kind === "resolve") return graphCopy.runActionResolve;
  if (action.kind === "retry") return graphCopy.runActionRetry;
  if (action.kind === "observe") return graphCopy.runActionObserve;
  if (action.kind === "trigger") return graphCopy.runActionStartPlan;
  if (action.kind === "open") return graphCopy.runActionOpen;
  return graphCopy.runActionSend;
}

function getRunPanelCopy(mode: RunPanelMode, graphCopy: GraphCopy) {
  switch (mode) {
    case "execute":
      return { eyebrow: graphCopy.runPanelExecuteEyebrow, title: graphCopy.runPanelExecuteTitle, description: graphCopy.runPanelExecuteDescription, submitLabel: graphCopy.runActionStartPlan, submitIcon: Play };
    case "confirm":
      return { eyebrow: graphCopy.runPanelConfirmEyebrow, title: graphCopy.runPanelConfirmTitle, description: graphCopy.runPanelConfirmDescription, submitLabel: graphCopy.runActionConfirm, submitIcon: Check };
    case "choose":
      return { eyebrow: graphCopy.runPanelChooseEyebrow, title: graphCopy.runPanelChooseTitle, description: graphCopy.runPanelChooseDescription, submitLabel: graphCopy.runActionChoose, submitIcon: Check };
    case "input":
      return { eyebrow: graphCopy.runPanelInputEyebrow, title: graphCopy.runPanelInputTitle, description: graphCopy.runPanelInputDescription, submitLabel: graphCopy.runActionSubmit, submitIcon: Send };
    case "edit":
      return { eyebrow: graphCopy.runPanelEditEyebrow, title: graphCopy.runPanelEditTitle, description: graphCopy.runPanelEditDescription, submitLabel: graphCopy.runActionSubmit, submitIcon: Send };
    case "approve":
      return { eyebrow: graphCopy.runPanelApproveEyebrow, title: graphCopy.runPanelApproveTitle, description: graphCopy.runPanelApproveDescription, submitLabel: graphCopy.runActionApprove, submitIcon: Check };
    case "wait":
      return { eyebrow: graphCopy.runPanelWaitEyebrow, title: graphCopy.runPanelWaitTitle, description: graphCopy.runPanelWaitDescription, submitLabel: graphCopy.runActionObserve, submitIcon: Sparkles };
    case "retry":
      return { eyebrow: graphCopy.runPanelRetryEyebrow, title: graphCopy.runPanelRetryTitle, description: graphCopy.runPanelRetryDescription, submitLabel: graphCopy.runActionRetry, submitIcon: RotateCcw };
    default:
      return { eyebrow: graphCopy.runPanelObserveEyebrow, title: graphCopy.runPanelObserveTitle, description: graphCopy.runPanelObserveDescription, submitLabel: graphCopy.runActionStartPlan, submitIcon: Play };
  }
}

function resolvePrimarySubmitLabel(node: PlanNodeDataModel, mode: RunPanelMode, fallbackLabel: string, graphCopy: GraphCopy) {
  if (mode === "execute") return node.executionMode === "manual" ? graphCopy.runActionMarkDone : graphCopy.runActionStartPlan;
  if (mode === "observe" && (node.status === "active" || node.active)) return graphCopy.runActionStartPlan;
  return fallbackLabel;
}

export function extractRunResult(node: PlanNodeDataModel) {
  const candidates = [node.completionSummary].filter((value): value is string => Boolean(value && value.trim()));

  return candidates[0] ?? null;
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function MarkdownContent({ content, disableInternalScroll = false }: { content: string; disableInternalScroll?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-sky-700 underline underline-offset-2 dark:text-sky-300">{children}</a>,
        code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground">{children}</code>,
        h1: ({ children }) => <h3 className="text-base font-semibold text-foreground">{children}</h3>,
        h2: ({ children }) => <h4 className="text-sm font-semibold text-foreground">{children}</h4>,
        h3: ({ children }) => <h5 className="text-sm font-semibold text-foreground">{children}</h5>,
        li: ({ children }) => <li className="pl-1 marker:text-muted-foreground">{children}</li>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-foreground">{children}</ol>,
        p: ({ children }) => <p className="text-sm leading-6 text-foreground">{children}</p>,
        pre: ({ children }) => (
          <pre className={cn(
            "my-2 whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-50",
            !disableInternalScroll && "max-h-72 overflow-auto",
          )}>{children}</pre>
        ),
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        table: ({ children }) => (
          <div className={cn("my-2 rounded-xl border border-border/60", !disableInternalScroll && "overflow-auto")}>
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        td: ({ children }) => <td className="border-t border-border/60 px-2 py-1.5 align-top text-foreground">{children}</td>,
        th: ({ children }) => <th className="bg-muted/60 px-2 py-1.5 text-left font-semibold text-foreground">{children}</th>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">{children}</ul>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function outputTitle(output: NodeResultOutput, fallback: string) {
  if ("title" in output && output.title) return output.title;
  return fallback;
}

export function ResultOutputCard({ output, graphCopy = DEFAULT_GRAPH_COPY, disableInternalScroll = false }: { output: NodeResultOutput; graphCopy?: GraphCopy; disableInternalScroll?: boolean }) {
  switch (output.kind) {
    case "text":
      return (
        <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2">
          <p className="text-xs font-semibold text-muted-foreground">{outputTitle(output, output.kind)}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{output.content}</p>
        </div>
      );
    case "markdown":
      return (
        <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2">
          <p className="text-xs font-semibold text-muted-foreground">{outputTitle(output, "markdown")}</p>
          <div className="mt-2">
            <MarkdownContent content={output.content} disableInternalScroll={disableInternalScroll} />
          </div>
        </div>
      );
    case "json":
      {
        const text = jsonOutputText(output.value);
        if (text) {
          return (
            <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2">
              <p className="text-xs font-semibold text-muted-foreground">{output.title ?? graphCopy.runResultTitle}</p>
              <div className="mt-2">
                <MarkdownContent content={text} disableInternalScroll={disableInternalScroll} />
              </div>
            </div>
          );
        }
      }
      return (
        <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2 text-foreground">
          <p className="text-xs font-semibold text-muted-foreground">{output.title ?? graphCopy.runOutputJsonTitle}</p>
          <pre className={cn(
            "mt-2 whitespace-pre-wrap break-words text-xs leading-5",
            !disableInternalScroll && "max-h-64 overflow-auto",
          )}>{formatJson(output.value)}</pre>
        </div>
      );
    case "file":
      return (
        <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{output.title ?? graphCopy.runOutputFileTitle}</p>
              <code className="mt-1 block break-all rounded-lg bg-background/80 px-2 py-1 text-xs text-foreground">{output.path}</code>
              {output.description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{output.description}</p> : null}
              {output.language ? <p className="mt-1 text-[11px] font-medium text-muted-foreground">{output.language}</p> : null}
            </div>
          </div>
        </div>
      );
    case "artifact":
      return (
        <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2">
          <p className="text-sm font-semibold text-foreground">{output.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{graphCopy.runOutputArtifactPrefix}: {output.artifactId}</p>
          {output.description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{output.description}</p> : null}
        </div>
      );
    case "command":
      return (
        <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2 text-foreground">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-muted-foreground" />
            <p className="text-sm font-semibold">{output.title ?? graphCopy.runOutputCommandTitle}</p>
            {typeof output.exitCode === "number" ? <span className="ml-auto text-xs text-muted-foreground">{graphCopy.runOutputExitPrefix} {output.exitCode}</span> : null}
          </div>
          <pre className={cn(
            "mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-foreground",
            !disableInternalScroll && "overflow-auto",
          )}>{output.command}</pre>
          {output.stdout ? <pre className={cn(
            "mt-2 whitespace-pre-wrap break-words border-t border-border pt-2 text-xs text-foreground",
            !disableInternalScroll && "max-h-40 overflow-auto",
          )}>{output.stdout}</pre> : null}
          {output.stderr ? <pre className={cn(
            "mt-2 whitespace-pre-wrap break-words border-t border-border pt-2 text-xs text-destructive",
            !disableInternalScroll && "max-h-40 overflow-auto",
          )}>{output.stderr}</pre> : null}
        </div>
      );
    case "link":
      return (
        <a className="flex items-start gap-2 rounded-xl border border-border/60 bg-background/75 px-3 py-2 hover:bg-muted/40" href={output.href} target="_blank" rel="noreferrer">
          <LinkIcon className="mt-0.5 size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">{output.title}</span>
            <span className="mt-1 block break-all text-xs text-muted-foreground">{output.href}</span>
            {output.description ? <span className="mt-2 block text-xs leading-5 text-muted-foreground">{output.description}</span> : null}
          </span>
          <ExternalLink className="size-3 text-muted-foreground" />
        </a>
      );
  }
}

export function evidenceLines(evidence: NodeResultEvidence | null | undefined) {
  if (!evidence) return [];
  return [
    evidence.runtimeName ? `runtime=${evidence.runtimeName}` : null,
    evidence.runtimeRunRef ? `runtimeRunRef=${evidence.runtimeRunRef}` : null,
    evidence.runId ? `runId=${evidence.runId}` : null,
    evidence.sessionId ? `session=${evidence.sessionId}` : null,
    evidence.conversationEntryIds?.length ? `conversationEntries=${evidence.conversationEntryIds.join(", ")}` : null,
    evidence.artifactIds?.length ? `artifacts=${evidence.artifactIds.join(", ")}` : null,
  ].filter((value): value is string => Boolean(value));
}

function formatErrorDetails(details: unknown): string | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const record = details as Record<string, unknown>;
  const parts = [
    typeof record.errorSummary === "string" ? record.errorSummary : null,
    typeof record.runtimeName === "string" ? `runtime=${record.runtimeName}` : null,
    typeof record.runtimeRunRef === "string" ? `runtimeRunRef=${record.runtimeRunRef}` : null,
    typeof record.runId === "string" ? `runId=${record.runId}` : null,
    typeof record.runtimeSessionKey === "string" ? `session=${record.runtimeSessionKey}` : null,
  ].filter((value): value is string => Boolean(value && value.trim()));

  return parts.length > 0 ? parts.join("\n") : null;
}

export function extractRunError(node: PlanNodeDataModel): string | null {
  const error = typeof node.metadata?.error === "string" ? node.metadata.error : null;
  const details = formatErrorDetails(node.metadata?.errorDetails);

  if (error && details) return `${error}\n${details}`;
  return error ?? details;
}

function summarizeFieldValues(fields: PlanNodeField[], values: Record<string, string>) {
  return fields
    .map((field) => `${field.label}: ${values[field.key]?.trim() || "-"}`)
    .join(" · ");
}

export function TaskPlanGraphInspectorRunPanel({
  node,
  graphCopy,
  onSubmitCheckpointAction,
  onDispatchExecutionAction,
}: {
  node: PlanNodeDataModel;
  graphCopy: GraphCopy;
  onSubmitCheckpointAction?: (action: SubmitCheckpointActionInput) => Promise<TaskExecutionDispatchResult>;
  onDispatchExecutionAction?: (action: ExecutionActionInput) => Promise<{ message: string }>;
}) {
  const [selectedActionId, setSelectedActionId] = useState<string | null>(() => defaultActionForNode(node));
  const form = useForm<Record<string, string>>({
    defaultValues: buildDefaultFieldValues(node.interactiveFields ?? []),
    mode: "onChange",
  });
  const fieldValues = (useWatch({ control: form.control }) as Record<string, string> | undefined) ?? buildDefaultFieldValues(node.interactiveFields ?? []);
  const [runLog, setRunLog] = useState<Array<{ id: string; title: string; detail: string }>>([]);
  const [isDispatching, setIsDispatching] = useState(false);
  const previousNodeIdRef = useRef(node.id);

  useEffect(() => {
    setSelectedActionId(defaultActionForNode(node));
    form.reset(buildDefaultFieldValues(node.interactiveFields ?? []));
    if (previousNodeIdRef.current !== node.id) {
      previousNodeIdRef.current = node.id;
      setRunLog([]);
    }
  }, [form, node]);

  const selectedAction = useMemo(() => node.availableActions?.find((action) => action.id === selectedActionId) ?? null, [node.availableActions, selectedActionId]);
  const runResult = useMemo(() => extractRunResult(node), [node]);
  const runError = useMemo(() => extractRunError(node), [node]);
  const resultOutputs = node.resultOutputs ?? [];
  const resultEvidence = useMemo(() => evidenceLines(node.resultEvidence), [node.resultEvidence]);
  const runPanelMode = useMemo(() => node.interactionType, [node]);
  const resolvedRunPanelMode = runPanelMode ?? "observe";
  const runPanelCopy = useMemo(() => getRunPanelCopy(resolvedRunPanelMode, graphCopy), [graphCopy, resolvedRunPanelMode]);
  const runPanelTheme = useMemo(() => getRunPanelTheme(resolvedRunPanelMode), [resolvedRunPanelMode]);
  const runPanelHints = useMemo(() => getRunPanelHints(resolvedRunPanelMode, graphCopy), [graphCopy, resolvedRunPanelMode]);
  const availableActions = node.availableActions ?? [];
  const hasExecutionAction = availableActions.some((action) => action.executionAction);
  const isExecutionRunning = isNodeExecutionRunning(node);
  const showRunControls = hasExecutionAction || node.status === "ready" || isExecutionRunning || node.status === "waiting" || node.status === "blocked";
  const SubmitIcon = runPanelCopy.submitIcon;
  const primarySubmitLabel = resolvePrimarySubmitLabel(node, resolvedRunPanelMode, runPanelCopy.submitLabel, graphCopy);
  const interactiveFields = node.interactiveFields ?? [];
  const canSubmitRunAction = interactiveFields.every((field) => !field.required || Boolean(fieldValues[field.key]?.trim()));

  async function dispatchExecutionActionFromPanel(action: PlanNodeAction, label: string) {
    if (!action.executionAction) return false;
    if (!onDispatchExecutionAction) {
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: graphCopy.runActionBackendMissing }, ...current].slice(0, 4));
      return true;
    }

    setIsDispatching(true);
    try {
      const result = await onDispatchExecutionAction(action.executionAction);
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: result.message }, ...current].slice(0, 4));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : graphCopy.runActionDispatchFailed;
      setRunLog((current) => [{ id: `${Date.now()}`, title: message.includes("still running") ? `${label} ${graphCopy.runActionStillRunningSuffix}` : `${label} ${graphCopy.runActionFailedSuffix}`, detail: message }, ...current].slice(0, 4));
    } finally {
      setIsDispatching(false);
    }
    return true;
  }

  function handleActionButtonClick(action: PlanNodeAction) {
    if (action.kind === "trigger" && action.executionAction && interactiveFields.length === 0) {
      void dispatchExecutionActionFromPanel(action, primarySubmitLabel);
      return;
    }
    setSelectedActionId(action.id);
  }

  async function handleRunAction(values: Record<string, string>) {
    const payload = summarizeFieldValues(interactiveFields, values);
    const label = selectedAction?.kind === "trigger"
      ? primarySubmitLabel
      : selectedAction?.label ?? node.nextAction ?? graphCopy.runActionDefaultLabel;

    if (selectedAction && await dispatchExecutionActionFromPanel(selectedAction, label)) return;

    if (!onSubmitCheckpointAction) {
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: payload || graphCopy.runActionBackendMissing }, ...current].slice(0, 4));
      return;
    }

    setIsDispatching(true);
    try {
      const result = await onSubmitCheckpointAction(buildWorkspaceCheckpointActionInput({ node, selectedAction, fields: interactiveFields, values }));
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: result.message }, ...current].slice(0, 4));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : graphCopy.runActionDispatchFailed;
      setRunLog((current) => [{ id: `${Date.now()}`, title: message.includes("still running") ? `${label} ${graphCopy.runActionStillRunningSuffix}` : `${label} ${graphCopy.runActionFailedSuffix}`, detail: message }, ...current].slice(0, 4));
    } finally {
      setIsDispatching(false);
    }
  }

  async function handleMarkDone() {
    const label = graphCopy.runActionMarkDone;
    const summary = summarizeFieldValues(interactiveFields, fieldValues) || runResult || `${graphCopy.runActionManualCompleteFallbackPrefix}: ${node.title}`;

    if (!onSubmitCheckpointAction || !node.checkpoint) {
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: graphCopy.runActionBackendMissing }, ...current].slice(0, 4));
      return;
    }

    setIsDispatching(true);
    try {
      const result = await onSubmitCheckpointAction({
        checkpointId: node.checkpoint.id,
        action: "mark_node_completed",
        payload: { summary, output: summary },
      });
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: result.message }, ...current].slice(0, 4));
    } catch (cause) {
      setRunLog((current) => [{ id: `${Date.now()}`, title: `${label} ${graphCopy.runActionFailedSuffix}`, detail: cause instanceof Error ? cause.message : graphCopy.runActionMarkDoneFailed }, ...current].slice(0, 4));
    } finally {
      setIsDispatching(false);
    }
  }

  return (
    <>
      {showRunControls ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">{runPanelCopy.eyebrow}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{runPanelCopy.title}</p>
            </div>
            <span className={cn("rounded-full px-2 py-1 text-[10px] font-medium", runPanelTheme.badge)}>{interactionLabel(resolvedRunPanelMode)}</span>
          </div>

          <div className={cn("rounded-2xl border p-3", runPanelTheme.card)}>
            <p className="text-sm text-muted-foreground">{runPanelCopy.description}</p>

            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              {runPanelHints.map((hint) => (
                <li key={hint} className="flex gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current/60" />
                  <span>{hint}</span>
                </li>
              ))}
            </ul>

            {node.nextAction ? <p className="mt-3 text-xs text-muted-foreground">{graphCopy.runNextUiStep}: {node.nextAction}</p> : null}

            {availableActions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {availableActions.map((action) => (
                  <ActionButton key={action.id} action={action} isActive={selectedActionId === action.id} disabled={isDispatching || (isExecutionRunning && Boolean(action.executionAction))} onClick={() => handleActionButtonClick(action)} />
                ))}
              </div>
            ) : null}

            <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => void form.handleSubmit(handleRunAction)(event)}>
              {interactiveFields.length > 0 ? (
                <FieldGroup className="gap-3">
                  {interactiveFields.map((field) => (
                    <Controller
                      key={field.key}
                      name={field.key}
                      control={form.control}
                  rules={{ required: field.required ? graphCopy.fieldRequired : false }}
                      render={({ field: controllerField, fieldState }) => (
                        <RunField
                          field={field}
                          value={controllerField.value ?? ""}
                          invalid={fieldState.invalid}
                          error={fieldState.error}
                          graphCopy={graphCopy}
                          onChange={controllerField.onChange}
                        />
                      )}
                    />
                  ))}
                </FieldGroup>
              ) : null}

            {interactiveFields.length === 0 && ["confirm", "approve", "execute", "observe", "wait", "retry"].includes(resolvedRunPanelMode) ? (
              <div className="mt-3 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                {resolvedRunPanelMode === "wait"
                  ? graphCopy.runNoFormWait
                  : resolvedRunPanelMode === "execute"
                    ? node.executionMode === "manual"
                      ? graphCopy.runNoFormManualExecute
                      : graphCopy.runNoFormExecute
                    : resolvedRunPanelMode === "retry"
                      ? graphCopy.runNoFormRetry
                      : graphCopy.runNoFormDefault}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={isDispatching || isExecutionRunning || (!selectedAction && interactiveFields.length === 0 ? !["observe", "execute", "wait"].includes(resolvedRunPanelMode) : !canSubmitRunAction)}
                variant="default" size="sm" className="rounded-xl"
              >
                {isDispatching
                  ? <Sparkles className="size-4 animate-spin" />
                  : selectedAction?.kind === "approve"
                  ? <Check className="size-4" />
                  : selectedAction?.kind === "confirm" || selectedAction?.kind === "choose"
                    ? <Check className="size-4" />
                    : selectedAction?.kind === "retry"
                      ? <RotateCcw className="size-4" />
                      : selectedAction?.kind === "trigger"
                        ? <Sparkles className="size-4" />
                        : <SubmitIcon className="size-4" />}
                {isDispatching ? graphCopy.runActionSending : selectedAction?.kind === "trigger" ? primarySubmitLabel : selectedAction ? getActionVerb(selectedAction, graphCopy) : primarySubmitLabel}
              </Button>

              {(node.status === "active" || node.active) && node.checkpoint ? (
                <Button
                  type="button"
                  disabled={isDispatching}
                  variant="outline" size="sm" className="rounded-xl"
                  onClick={handleMarkDone}
                >
                  <Check className="size-4" />
                  {graphCopy.runActionMarkDone}
                </Button>
              ) : null}

              <span className="text-xs text-muted-foreground">{graphCopy.runActionBackendNotice}</span>
            </div>
            </form>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground">{graphCopy.runResultTitle}</p>
        <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-3">
          {runError ? (
            <pre className="whitespace-pre-wrap text-xs leading-5 text-red-700">{runError}</pre>
          ) : resultOutputs.length > 0 ? (
            <>
              {runResult ? <p className="text-sm leading-6 text-muted-foreground">{runResult}</p> : null}
              <div className="space-y-2">
                {resultOutputs.map((output, index) => (
                  <ResultOutputCard key={`${output.kind}:${index}`} output={output} graphCopy={graphCopy} />
                ))}
              </div>
            </>
          ) : runResult ? (
            <p className="text-sm leading-6 text-foreground">{runResult}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{graphCopy.runResultEmpty}</p>
          )}
          {resultEvidence.length > 0 ? (
            <details className="rounded-xl border border-dashed border-border/60 bg-muted/[0.16] px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">{graphCopy.runEvidenceTitle}</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{resultEvidence.join("\n")}</pre>
            </details>
          ) : null}
        </div>

        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/[0.14] p-3">
            <p className="text-xs font-semibold text-muted-foreground">{graphCopy.runFeedTitle}</p>
          {runLog.length > 0 ? (
            <div className="mt-3 space-y-2">
              {runLog.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border/60 bg-background/75 px-3 py-2">
                  <p className="text-sm font-medium text-foreground">{entry.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {showRunControls
                ? graphCopy.runFeedEmptyWithControls
                : graphCopy.runFeedEmptyWithoutControls}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
