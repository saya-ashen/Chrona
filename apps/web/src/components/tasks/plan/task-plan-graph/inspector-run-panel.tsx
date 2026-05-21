"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Check, ExternalLink, FileText, LinkIcon, Play, RotateCcw, Send, Sparkles, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { NodeResultEvidence, NodeResultOutput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { TaskExecutionDispatchResult } from "@/components/tasks/task-workspace-query";
import { buildWorkspaceCheckpointActionInput } from "@/components/tasks/workspace/model/task-workspace-actions";
import { interactionLabel } from "./logic";
import type { PlanNodeAction, PlanNodeDataModel, PlanNodeField } from "./types";

type RunPanelMode = PlanNodeDataModel["interactionType"];

function getRunPanelTheme(mode: RunPanelMode) {
  switch (mode) {
    case "execute":
      return { badge: "bg-violet-500/12 text-violet-700 dark:text-violet-200", card: "border-violet-200/70 bg-violet-50/70 dark:border-violet-400/20 dark:bg-violet-500/10" };
    case "confirm":
      return { badge: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-200", card: "border-indigo-200/70 bg-indigo-50/70 dark:border-indigo-400/20 dark:bg-indigo-500/10" };
    case "choose":
      return { badge: "bg-amber-500/14 text-amber-800 dark:text-amber-200", card: "border-amber-200/70 bg-amber-50/70 dark:border-amber-400/20 dark:bg-amber-500/10" };
    case "input":
      return { badge: "bg-amber-500/14 text-amber-800 dark:text-amber-200", card: "border-amber-200/70 bg-amber-50/70 dark:border-amber-400/20 dark:bg-amber-500/10" };
    case "edit":
      return { badge: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-200", card: "border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-400/20 dark:bg-emerald-500/10" };
    case "approve":
      return { badge: "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-200", card: "border-fuchsia-200/70 bg-fuchsia-50/70 dark:border-fuchsia-400/20 dark:bg-fuchsia-500/10" };
    case "retry":
      return { badge: "bg-rose-500/12 text-rose-700 dark:text-rose-200", card: "border-rose-200/70 bg-rose-50/70 dark:border-rose-400/20 dark:bg-rose-500/10" };
    case "wait":
      return { badge: "bg-slate-500/12 text-slate-700 dark:text-slate-200", card: "border-slate-200/70 bg-slate-50/70 dark:border-slate-400/20 dark:bg-slate-500/10" };
    default:
      return { badge: "bg-sky-500/12 text-sky-700 dark:text-sky-200", card: "border-sky-200/70 bg-sky-50/70 dark:border-sky-400/20 dark:bg-sky-500/10" };
  }
}

function getRunPanelHints(mode: RunPanelMode) {
  switch (mode) {
    case "execute":
      return ["Review dependencies and objective.", "Execution starts from the plan entry node, not from an arbitrary selected node."];
    case "confirm":
      return ["Read the checkpoint summary carefully.", "Confirm only when the prerequisite condition is truly satisfied."];
    case "choose":
      return ["Pick one branch or decision path.", "The selected option determines downstream execution."];
    case "input":
      return ["Fill in the required fields.", "Submitted input becomes the runtime context for the next step."];
    case "edit":
      return ["Revise the requested content before continuing.", "Treat this as a correction checkpoint, not a new task step."];
    case "approve":
      return ["This is a sign-off gate for a sensitive operation.", "Approval here should represent explicit intent, not just observation."];
    case "retry":
      return ["Capture why the node needs another attempt.", "Use retry only after the blocking cause is understood."];
    case "wait":
      return ["No manual action is needed yet.", "Monitor the wait condition and related downstream context."];
    default:
      return ["Use this panel to inspect the live node context.", "Advance the run only when the current state is clear."];
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

function ActionButton({ action, isActive, onClick }: { action: PlanNodeAction; isActive: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant={isActive ? "default" : "outline"}
      size="sm"
      className="rounded-xl"
    >
      {action.label}
    </Button>
  );
}

function RunField({ field, value, invalid, error, onChange }: { field: PlanNodeField; value: string; invalid?: boolean; error?: { message?: string }; onChange: (value: string) => void }) {
  const fieldId = `run-panel-${field.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const commonLabel = (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground">{field.label}</span>
      {field.required ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">required</span> : null}
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
          placeholder={`Enter ${field.label.toLowerCase()}...`}
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
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
          {(field.options ?? ["Approve", "Reject", "Needs changes"]).map((option) => (
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
        placeholder={`Enter ${field.label.toLowerCase()}...`}
      />
      {invalid ? <FieldError errors={[error]} /> : null}
    </Field>
  );
}

function getActionVerb(action: PlanNodeAction | null) {
  if (!action) return "Send";
  if (action.kind === "approve") return "Approve";
  if (action.kind === "confirm") return "Confirm";
  if (action.kind === "choose") return "Choose";
  if (action.kind === "edit") return "Submit";
  if (action.kind === "resolve") return "Resolve";
  if (action.kind === "retry") return "Retry";
  if (action.kind === "observe") return "Observe";
  if (action.kind === "trigger") return "Start plan";
  if (action.kind === "open") return "Open";
  return "Send";
}

function getRunPanelCopy(mode: RunPanelMode) {
  switch (mode) {
    case "execute":
      return { eyebrow: "Execution panel", title: "Ready to execute", description: "Execution starts from the plan entry node. This action starts or continues the plan.", submitLabel: "Start plan", submitIcon: Play };
    case "confirm":
      return { eyebrow: "Confirmation panel", title: "Waiting for confirmation", description: "This node needs a clear confirmation before the run can proceed.", submitLabel: "Confirm", submitIcon: Check };
    case "choose":
      return { eyebrow: "Decision panel", title: "Waiting for a choice", description: "Select the branch or decision needed to continue this plan.", submitLabel: "Submit choice", submitIcon: Check };
    case "input":
      return { eyebrow: "Input panel", title: "Waiting for user input", description: "This node is paused until the required input is submitted.", submitLabel: "Submit input", submitIcon: Send };
    case "edit":
      return { eyebrow: "Edit panel", title: "Waiting for edits", description: "This node expects a structured revision before execution can continue.", submitLabel: "Submit edits", submitIcon: Send };
    case "approve":
      return { eyebrow: "Approval panel", title: "Waiting for approval", description: "This node needs an explicit approval decision before execution can continue.", submitLabel: "Send approval", submitIcon: Check };
    case "wait":
      return { eyebrow: "Wait panel", title: "Waiting on an external event", description: "This node is paused by design until its wait condition is satisfied.", submitLabel: "Observe wait", submitIcon: Sparkles };
    case "retry":
      return { eyebrow: "Retry panel", title: "Node needs recovery", description: "This node is blocked. Capture the retry rationale and restart from here.", submitLabel: "Retry node", submitIcon: RotateCcw };
    default:
      return { eyebrow: "Observe panel", title: "Current run focus", description: "Use this surface to monitor the active node and advance the run when ready.", submitLabel: "Continue run", submitIcon: Play };
  }
}

function resolvePrimarySubmitLabel(node: PlanNodeDataModel, mode: RunPanelMode, fallbackLabel: string) {
  if (mode === "execute") return node.executionMode === "manual" ? "Mark done" : "Start plan";
  if (mode === "observe" && (node.status === "active" || node.active)) return "Continue run";
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

export function ResultOutputCard({ output, disableInternalScroll = false }: { output: NodeResultOutput; disableInternalScroll?: boolean }) {
  switch (output.kind) {
    case "text":
      return (
        <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{outputTitle(output, output.kind)}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{output.content}</p>
        </div>
      );
    case "markdown":
      return (
        <div className="rounded-xl border border-border/60 bg-background/75 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{outputTitle(output, "markdown")}</p>
          <div className="mt-2">
            <MarkdownContent content={output.content} disableInternalScroll={disableInternalScroll} />
          </div>
        </div>
      );
    case "json":
      return (
        <div className="rounded-xl border border-border/60 bg-slate-950 px-3 py-2 text-slate-50">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">{output.title ?? "JSON"}</p>
          <pre className={cn(
            "mt-2 whitespace-pre-wrap break-words text-xs leading-5",
            !disableInternalScroll && "max-h-64 overflow-auto",
          )}>{formatJson(output.value)}</pre>
        </div>
      );
    case "file":
      return (
        <div className="rounded-xl border border-sky-200/70 bg-sky-50/70 px-3 py-2 dark:border-sky-400/20 dark:bg-sky-500/10">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 size-4 text-sky-700 dark:text-sky-200" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{output.title ?? "File output"}</p>
              <code className="mt-1 block break-all rounded-lg bg-background/80 px-2 py-1 text-xs text-foreground">{output.path}</code>
              {output.description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{output.description}</p> : null}
              {output.language ? <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{output.language}</p> : null}
            </div>
          </div>
        </div>
      );
    case "artifact":
      return (
        <div className="rounded-xl border border-purple-200/70 bg-purple-50/70 px-3 py-2 dark:border-purple-400/20 dark:bg-purple-500/10">
          <p className="text-sm font-semibold text-foreground">{output.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">Artifact: {output.artifactId}</p>
          {output.description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{output.description}</p> : null}
        </div>
      );
    case "command":
      return (
        <div className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-50">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 text-zinc-300" />
            <p className="text-sm font-semibold">{output.title ?? "Command"}</p>
            {typeof output.exitCode === "number" ? <span className="ml-auto text-xs text-zinc-400">exit {output.exitCode}</span> : null}
          </div>
          <pre className={cn(
            "mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-100",
            !disableInternalScroll && "overflow-auto",
          )}>{output.command}</pre>
          {output.stdout ? <pre className={cn(
            "mt-2 whitespace-pre-wrap break-words border-t border-zinc-800 pt-2 text-xs text-emerald-200",
            !disableInternalScroll && "max-h-40 overflow-auto",
          )}>{output.stdout}</pre> : null}
          {output.stderr ? <pre className={cn(
            "mt-2 whitespace-pre-wrap break-words border-t border-zinc-800 pt-2 text-xs text-rose-200",
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
  onSubmitCheckpointAction,
}: {
  node: PlanNodeDataModel;
  onSubmitCheckpointAction?: (action: SubmitCheckpointActionInput) => Promise<TaskExecutionDispatchResult>;
}) {
  const [selectedActionId, setSelectedActionId] = useState<string | null>(() => defaultActionForNode(node));
  const form = useForm<Record<string, string>>({
    defaultValues: buildDefaultFieldValues(node.interactiveFields ?? []),
    mode: "onChange",
  });
  const fieldValues = (useWatch({ control: form.control }) as Record<string, string> | undefined) ?? buildDefaultFieldValues(node.interactiveFields ?? []);
  const [runLog, setRunLog] = useState<Array<{ id: string; title: string; detail: string }>>([]);
  const [isDispatching, setIsDispatching] = useState(false);

  useEffect(() => {
    setSelectedActionId(defaultActionForNode(node));
    form.reset(buildDefaultFieldValues(node.interactiveFields ?? []));
    setRunLog([]);
  }, [form, node]);

  const selectedAction = useMemo(() => node.availableActions?.find((action) => action.id === selectedActionId) ?? null, [node.availableActions, selectedActionId]);
  const runResult = useMemo(() => extractRunResult(node), [node]);
  const runError = useMemo(() => extractRunError(node), [node]);
  const resultOutputs = node.resultOutputs ?? [];
  const resultEvidence = useMemo(() => evidenceLines(node.resultEvidence), [node.resultEvidence]);
  const runPanelMode = useMemo(() => node.interactionType, [node]);
  const resolvedRunPanelMode = runPanelMode ?? "observe";
  const runPanelCopy = useMemo(() => getRunPanelCopy(resolvedRunPanelMode), [resolvedRunPanelMode]);
  const runPanelTheme = useMemo(() => getRunPanelTheme(resolvedRunPanelMode), [resolvedRunPanelMode]);
  const runPanelHints = useMemo(() => getRunPanelHints(resolvedRunPanelMode), [resolvedRunPanelMode]);
  const showRunControls = node.status === "ready" || node.status === "active" || node.status === "waiting" || node.status === "blocked";
  const SubmitIcon = runPanelCopy.submitIcon;
  const primarySubmitLabel = resolvePrimarySubmitLabel(node, resolvedRunPanelMode, runPanelCopy.submitLabel);
  const interactiveFields = node.interactiveFields ?? [];
  const availableActions = node.availableActions ?? [];
  const canSubmitRunAction = interactiveFields.every((field) => !field.required || Boolean(fieldValues[field.key]?.trim()));

  async function handleRunAction(values: Record<string, string>) {
    const payload = summarizeFieldValues(interactiveFields, values);
    const label = selectedAction?.kind === "trigger"
      ? primarySubmitLabel
      : selectedAction?.label ?? node.nextAction ?? "Run action";

    if (!onSubmitCheckpointAction) {
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: payload || "No backend handler is connected for this surface." }, ...current].slice(0, 4));
      return;
    }

    setIsDispatching(true);
    try {
      const result = await onSubmitCheckpointAction(buildWorkspaceCheckpointActionInput({ node, selectedAction, fields: interactiveFields, values }));
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: result.message }, ...current].slice(0, 4));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to dispatch execution action";
      setRunLog((current) => [{ id: `${Date.now()}`, title: message.includes("still running") ? `${label} still running` : `${label} failed`, detail: message }, ...current].slice(0, 4));
    } finally {
      setIsDispatching(false);
    }
  }

  async function handleMarkDone() {
    const label = "Mark done";
    const summary = summarizeFieldValues(interactiveFields, fieldValues) || runResult || `Manual node ${node.title} completed`;

    if (!onSubmitCheckpointAction || !node.checkpoint) {
      setRunLog((current) => [{ id: `${Date.now()}`, title: label, detail: "No backend handler is connected for this surface." }, ...current].slice(0, 4));
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
      setRunLog((current) => [{ id: `${Date.now()}`, title: `${label} failed`, detail: cause instanceof Error ? cause.message : "Failed to mark node done" }, ...current].slice(0, 4));
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
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{runPanelCopy.eyebrow}</p>
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

            {node.nextAction ? <p className="mt-3 text-xs text-muted-foreground">Next UI step: {node.nextAction}</p> : null}

            {availableActions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {availableActions.map((action) => (
                  <ActionButton key={action.id} action={action} isActive={selectedActionId === action.id} onClick={() => setSelectedActionId(action.id)} />
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
                      rules={{ required: field.required ? "Required" : false }}
                      render={({ field: controllerField, fieldState }) => (
                        <RunField
                          field={field}
                          value={controllerField.value ?? ""}
                          invalid={fieldState.invalid}
                          error={fieldState.error}
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
                  ? "This node is waiting on an external event, so there is no manual form to fill here."
                  : resolvedRunPanelMode === "execute"
                    ? node.executionMode === "manual"
                      ? "Complete the manual work outside Chrona, then mark this node done here."
                      : "Execution starts from the plan entry node. This action starts or continues the plan."
                    : resolvedRunPanelMode === "retry"
                      ? "This node is blocked. Use retry once the failure cause is understood."
                      : "This node does not require free-form input. The action here is a direct decision or execution step."}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={isDispatching || (!selectedAction && interactiveFields.length === 0 ? !["observe", "execute", "wait"].includes(resolvedRunPanelMode) : !canSubmitRunAction)}
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
                {isDispatching ? "Sending..." : selectedAction?.kind === "trigger" ? primarySubmitLabel : selectedAction ? getActionVerb(selectedAction) : primarySubmitLabel}
              </Button>

              {(node.status === "active" || node.active) && node.checkpoint ? (
                <Button
                  type="button"
                  disabled={isDispatching}
                  variant="outline" size="sm" className="rounded-xl"
                  onClick={handleMarkDone}
                >
                  <Check className="size-4" />
                  Mark done
                </Button>
              ) : null}

              <span className="text-xs text-muted-foreground">Actions are sent to the task execution backend.</span>
            </div>
            </form>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Run result</p>
        <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-3">
          {runError ? (
            <pre className="whitespace-pre-wrap text-xs leading-5 text-red-700">{runError}</pre>
          ) : resultOutputs.length > 0 ? (
            <>
              {runResult ? <p className="text-sm leading-6 text-muted-foreground">{runResult}</p> : null}
              <div className="space-y-2">
                {resultOutputs.map((output, index) => (
                  <ResultOutputCard key={`${output.kind}:${index}`} output={output} />
                ))}
              </div>
            </>
          ) : runResult ? (
            <p className="text-sm leading-6 text-foreground">{runResult}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No run result yet for this node.</p>
          )}
          {resultEvidence.length > 0 ? (
            <details className="rounded-xl border border-dashed border-border/60 bg-muted/[0.16] px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Evidence</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{resultEvidence.join("\n")}</pre>
            </details>
          ) : null}
        </div>

        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/[0.14] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Run feed</p>
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
                ? "Select a node action, fill required fields, then send it to the execution backend."
                : "Run controls appear only for the current node. Results for this node still show here."}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
