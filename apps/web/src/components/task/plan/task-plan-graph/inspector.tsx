"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Play, RotateCcw, Send, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { inputClassName, selectClassName, textareaClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { interactionLabel, nodeKindLabel } from "./logic";
import type { GraphCopy, PlanNodeAction, PlanNodeDataModel, PlanNodeField } from "./types";

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
      return ["Review dependencies and objective.", "Start this node when you are ready to proceed."];
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

function buildDependencyLabelMap(node: PlanNodeDataModel) {
  const metadataDependencies = node.metadata.dependencies;
  if (!Array.isArray(metadataDependencies)) {
    return new Map<string, string>();
  }

  const labels = new Map<string, string>();
  for (const dependency of metadataDependencies) {
    if (!dependency || typeof dependency !== "object") continue;
    const record = dependency as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    if (!id) continue;

    const titleCandidates = [record.title, record.name, record.label, record.nodeTitle, record.description];
    const title = titleCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (title) labels.set(id, title);
  }

  return labels;
}

function resolveDependencyNames(node: PlanNodeDataModel, nodes: PlanNodeDataModel[]) {
  const dependencyLabels = buildDependencyLabelMap(node);
  const nodeTitleById = new Map(nodes.map((item) => [item.id, item.title]));
  return node.dependencies
    .map((dependencyId) => dependencyLabels.get(dependencyId) ?? nodeTitleById.get(dependencyId) ?? null)
    .filter((value): value is string => Boolean(value));
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

function ActionChip({ action }: { action: PlanNodeAction }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-1 text-[10px] font-medium",
        action.emphasis === "primary"
          ? "bg-primary/12 text-primary"
          : action.emphasis === "warning"
            ? "bg-amber-100 text-amber-800"
            : "bg-foreground/6 text-muted-foreground",
      )}
    >
      {action.label}
    </span>
  );
}

function FieldCard({ field }: { field: PlanNodeField }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{field.label}</p>
        {field.required ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">required</span> : null}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">control: {field.control ?? "text"}</p>
      {field.options?.length ? <p className="mt-1 text-[11px] text-muted-foreground">options: {field.options.join(", ")}</p> : null}
    </div>
  );
}

function DependencyChip({ title }: { title: string }) {
  return (
    <span className="inline-flex min-h-8 items-center rounded-2xl border border-violet-200/70 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-900 shadow-sm dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100">
      {title}
    </span>
  );
}

function buildDefaultFieldValues(fields: PlanNodeField[]) {
  return Object.fromEntries(fields.map((field) => [field.key, field.value || ""]));
}

function defaultActionForNode(node: PlanNodeDataModel | null) {
  return node?.availableActions.find((action) => action.emphasis === "primary")?.id
    ?? node?.availableActions[0]?.id
    ?? null;
}

function ActionButton({
  action,
  isActive,
  onClick,
}: {
  action: PlanNodeAction;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={buttonVariants({
        variant: isActive ? "default" : "outline",
        size: "sm",
        className: "rounded-xl",
      })}
    >
      {action.label}
    </button>
  );
}

function RunField({
  field,
  value,
  onChange,
}: {
  field: PlanNodeField;
  value: string;
  onChange: (value: string) => void;
}) {
  const commonLabel = (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground">{field.label}</span>
      {field.required ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">required</span> : null}
    </div>
  );

  if (field.control === "textarea") {
    return (
      <label className="space-y-2">
        {commonLabel}
        <textarea
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(textareaClassName, "min-h-24 rounded-xl border-border/70 bg-background/80 text-sm")}
          placeholder={`Enter ${field.label.toLowerCase()}...`}
        />
      </label>
    );
  }

  if (field.control === "select" || field.control === "approval") {
    return (
      <label className="space-y-2">
        {commonLabel}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(selectClassName, "rounded-xl border-border/70 bg-background/80 text-sm")}
        >
          <option value="">Select...</option>
          {(field.options ?? ["Approve", "Reject", "Needs changes"]).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="space-y-2">
      {commonLabel}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClassName, "rounded-xl border-border/70 bg-background/80 text-sm")}
        placeholder={`Enter ${field.label.toLowerCase()}...`}
      />
    </label>
  );
}

function getActionVerb(action: PlanNodeAction | null) {
  if (!action) return "Send";
  if (action.kind === "approve") return "Approve";
   if (action.kind === "confirm") return "Confirm";
   if (action.kind === "choose") return "Choose";
   if (action.kind === "edit") return "Submit";
   if (action.kind === "retry") return "Retry";
   if (action.kind === "observe") return "Observe";
  if (action.kind === "trigger") return "Run";
  if (action.kind === "open") return "Open";
  return "Send";
}

function resolveRunPanelMode(node: PlanNodeDataModel): RunPanelMode {
  return node.interactionType;
}

function getRunPanelCopy(mode: RunPanelMode) {
  switch (mode) {
    case "execute":
      return {
        eyebrow: "Execution panel",
        title: "Ready to execute",
        description: "This node is ready. Start it directly from here.",
        submitLabel: "Start node",
        submitIcon: Play,
      };
    case "confirm":
      return {
        eyebrow: "Confirmation panel",
        title: "Waiting for confirmation",
        description: "This node needs a clear confirmation before the run can proceed.",
        submitLabel: "Confirm",
        submitIcon: Check,
      };
    case "choose":
      return {
        eyebrow: "Decision panel",
        title: "Waiting for a choice",
        description: "Select the branch or decision needed to continue this plan.",
        submitLabel: "Submit choice",
        submitIcon: Check,
      };
    case "input":
      return {
        eyebrow: "Input panel",
        title: "Waiting for user input",
        description: "This node is paused until the required input is submitted.",
        submitLabel: "Submit input",
        submitIcon: Send,
      };
    case "edit":
      return {
        eyebrow: "Edit panel",
        title: "Waiting for edits",
        description: "This node expects a structured revision before execution can continue.",
        submitLabel: "Submit edits",
        submitIcon: Send,
      };
    case "approve":
      return {
        eyebrow: "Approval panel",
        title: "Waiting for approval",
        description: "This node needs an explicit approval decision before execution can continue.",
        submitLabel: "Send approval",
        submitIcon: Check,
      };
    case "wait":
      return {
        eyebrow: "Wait panel",
        title: "Waiting on an external event",
        description: "This node is paused by design until its wait condition is satisfied.",
        submitLabel: "Observe wait",
        submitIcon: Sparkles,
      };
    case "retry":
      return {
        eyebrow: "Retry panel",
        title: "Node needs recovery",
        description: "This node is blocked. Capture the retry rationale and restart from here.",
        submitLabel: "Retry node",
        submitIcon: RotateCcw,
      };
    default:
      return {
        eyebrow: "Observe panel",
        title: "Current run focus",
        description: "Use this surface to monitor the active node and advance the run when ready.",
        submitLabel: "Continue run",
        submitIcon: Play,
      };
  }
}

function resolvePrimarySubmitLabel(node: PlanNodeDataModel, mode: RunPanelMode, fallbackLabel: string) {
  if (mode === "execute") {
    return "Start node";
  }

  if (mode === "observe" && (node.status === "active" || node.active)) {
    return "Continue run";
  }

  return fallbackLabel;
}

function extractRunResult(node: PlanNodeDataModel) {
  const candidates = [
    node.completionSummary,
    typeof node.metadata.output === "string" ? node.metadata.output : null,
    typeof node.metadata.result === "string" ? node.metadata.result : null,
    typeof node.metadata.lastResult === "string" ? node.metadata.lastResult : null,
    typeof node.metadata.summary === "string" ? node.metadata.summary : null,
  ].filter((value): value is string => Boolean(value && value.trim()));

  return candidates[0] ?? null;
}

export function TaskPlanGraphInspector({
  node,
  graphCopy,
  nodes = [],
}: {
  node: PlanNodeDataModel | null;
  graphCopy: GraphCopy;
  nodes?: PlanNodeDataModel[];
}) {
  if (!node) {
    return (
      <aside className="rounded-[24px] border border-border/60 bg-muted/[0.18] p-4">
        <p className="text-sm font-semibold text-foreground">{graphCopy.inspectorTitle}</p>
        <p className="mt-2 text-sm text-muted-foreground">{graphCopy.inspectorEmpty}</p>
      </aside>
    );
  }

  const currentNode = node;

  const dependencyNames = resolveDependencyNames(currentNode, nodes);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(() => defaultActionForNode(currentNode));
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => buildDefaultFieldValues(currentNode.interactiveFields));
  const [runLog, setRunLog] = useState<Array<{ id: string; title: string; detail: string }>>([]);

  useEffect(() => {
    setSelectedActionId(defaultActionForNode(currentNode));
    setFieldValues(buildDefaultFieldValues(currentNode.interactiveFields));
    setRunLog([]);
  }, [currentNode]);

  const selectedAction = useMemo(
    () => currentNode.availableActions.find((action) => action.id === selectedActionId) ?? null,
    [currentNode.availableActions, selectedActionId],
  );
  const runResult = useMemo(() => extractRunResult(currentNode), [currentNode]);
  const runPanelMode = useMemo(() => resolveRunPanelMode(currentNode), [currentNode]);
  const runPanelCopy = useMemo(() => getRunPanelCopy(runPanelMode), [runPanelMode]);
  const runPanelTheme = useMemo(() => getRunPanelTheme(runPanelMode), [runPanelMode]);
  const runPanelHints = useMemo(() => getRunPanelHints(runPanelMode), [runPanelMode]);
  const showRunControls = currentNode.status === "ready"
    || currentNode.status === "active"
    || currentNode.status === "waiting"
    || currentNode.status === "blocked";
  const SubmitIcon = runPanelCopy.submitIcon;
  const primarySubmitLabel = resolvePrimarySubmitLabel(currentNode, runPanelMode, runPanelCopy.submitLabel);

  const canSubmitRunAction = currentNode.interactiveFields.every((field) => {
    if (!field.required) return true;
    return Boolean(fieldValues[field.key]?.trim());
  });

  function handleRunAction() {
    const payload = currentNode.interactiveFields
      .map((field) => `${field.label}: ${fieldValues[field.key] || "-"}`)
      .join(" · ");
    const label = selectedAction?.label ?? currentNode.nextAction ?? "Run action";
    setRunLog((current) => [
      {
        id: `${Date.now()}`,
        title: label,
        detail: payload || "UI-only preview. No backend action sent.",
      },
      ...current,
    ].slice(0, 4));
  }

  return (
    <aside className="rounded-[24px] border border-border/70 bg-background/96 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur">
      <div className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{nodeKindLabel(node.kind, graphCopy)}</span>
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{node.statusLabel}</span>
          <span className="rounded-full bg-foreground/6 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{interactionLabel(node.interactionType)}</span>
        </div>
        <h3 className="mt-3 text-lg font-semibold text-foreground">{node.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{node.summary}</p>
      </div>

      <div className="mt-4 space-y-4">
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorWhy}</p>
          <InfoRow label={graphCopy.detailObjective} value={node.objective} />
          <InfoRow label={graphCopy.detailNextAction} value={node.nextAction} />
          <InfoRow label={graphCopy.detailReadiness} value={node.readiness} />
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorDependencies}</p>
          {dependencyNames.length > 0 ? (
            <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{graphCopy.detailDependencies}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {dependencyNames.map((dependencyName) => (
                  <DependencyChip key={dependencyName} title={dependencyName} />
                ))}
              </div>
            </div>
          ) : null}
          <InfoRow label={graphCopy.detailRequiredInfo} value={node.requiredInfo.join(", ") || null} />
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorExecution}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <InfoRow label={graphCopy.detailPhase} value={node.phase} />
            <InfoRow label={graphCopy.detailExecutionMode} value={node.executionMode} />
            <InfoRow label={graphCopy.detailPriority} value={node.priority} />
            <InfoRow label={graphCopy.detailEstimatedDuration} value={typeof node.estimatedMinutes === "number" ? `${node.estimatedMinutes} min` : null} />
            <InfoRow label={graphCopy.detailLinkedTask} value={node.linkedTaskId} />
          </div>
        </section>

        {showRunControls ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{runPanelCopy.eyebrow}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{runPanelCopy.title}</p>
              </div>
              <span className={cn("rounded-full px-2 py-1 text-[10px] font-medium", runPanelTheme.badge)}>
                {interactionLabel(currentNode.interactionType)}
              </span>
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

              {node.nextAction ? (
                <p className="mt-3 text-xs text-muted-foreground">Next UI step: {node.nextAction}</p>
              ) : null}

              {node.availableActions.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {node.availableActions.map((action) => (
                    <ActionButton
                      key={action.id}
                      action={action}
                      isActive={selectedActionId === action.id}
                      onClick={() => setSelectedActionId(action.id)}
                    />
                  ))}
                </div>
              ) : null}

              {node.interactiveFields.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {node.interactiveFields.map((field) => (
                    <RunField
                      key={field.key}
                      field={field}
                      value={fieldValues[field.key] ?? ""}
                      onChange={(value) => setFieldValues((current) => ({ ...current, [field.key]: value }))}
                    />
                  ))}
                </div>
              ) : null}

              {node.interactiveFields.length === 0 && ["confirm", "approve", "execute", "observe", "wait", "retry"].includes(runPanelMode) ? (
                <div className="mt-3 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                  {runPanelMode === "wait"
                    ? "This node is waiting on an external event, so there is no manual form to fill here."
                    : runPanelMode === "execute"
                      ? "This node can be started directly. No extra manual fields are required first."
                      : runPanelMode === "retry"
                        ? "This node is blocked. Use retry once the failure cause is understood."
                        : "This node does not require free-form input. The action here is a direct decision or execution step."}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!selectedAction && currentNode.interactiveFields.length === 0 ? !["observe", "execute", "wait"].includes(runPanelMode) : !canSubmitRunAction}
                  className={buttonVariants({ variant: "default", size: "sm", className: "rounded-xl" })}
                  onClick={handleRunAction}
                >
                  {selectedAction?.kind === "approve"
                    ? <Check className="size-4" />
                    : selectedAction?.kind === "confirm" || selectedAction?.kind === "choose"
                      ? <Check className="size-4" />
                      : selectedAction?.kind === "retry"
                        ? <RotateCcw className="size-4" />
                    : selectedAction?.kind === "trigger"
                      ? <Sparkles className="size-4" />
                      : <SubmitIcon className="size-4" />}
                  {selectedAction ? getActionVerb(selectedAction) : primarySubmitLabel}
                </button>

                {!["observe", "wait"].includes(runPanelMode) ? (
                  <button
                    type="button"
                    className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-xl" })}
                    onClick={() => {
                      setRunLog((current) => [
                        {
                          id: `${Date.now()}`,
                          title: "Observe only",
                          detail: `Simulated switch to passive observation for \"${currentNode.title}\".`,
                        },
                        ...current,
                      ].slice(0, 4));
                    }}
                  >
                    <Sparkles className="size-4" />
                    Observe
                  </button>
                ) : null}

                {(currentNode.status === "active" || currentNode.active) ? (
                  <button
                    type="button"
                    className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-xl" })}
                    onClick={() => {
                      setRunLog((current) => [
                        {
                          id: `${Date.now()}`,
                          title: "Mark done",
                          detail: `Simulated completion for \"${currentNode.title}\".`,
                        },
                        ...current,
                      ].slice(0, 4));
                    }}
                  >
                    <Check className="size-4" />
                    Mark done
                  </button>
                ) : null}

                <span className="text-xs text-muted-foreground">
                  Preview only. Backend wiring comes later.
                </span>
              </div>
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Run result</p>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-3">
            {runResult ? (
              <p className="text-sm leading-6 text-foreground">{runResult}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No run result yet for this node.</p>
            )}
          </div>

          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/[0.14] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Simulated run feed</p>
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
                  ? "Select a node action, fill required fields, then simulate the run flow here."
                  : "Run controls appear only for the current node. Results for this node still show here."}
              </p>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorOutcomes}</p>
          <InfoRow label={graphCopy.detailCompletionSummary} value={node.completionSummary} />
          <InfoRow label="Branches" value={node.branchLabels.join(", ") || null} />
          <InfoRow label="Options" value={node.options.join(", ") || null} />
          {node.availableActions.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {node.availableActions.map((action) => (
                <ActionChip key={action.id} action={action} />
              ))}
            </div>
          ) : null}
        </section>

        {node.interactiveFields.length > 0 ? (
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{graphCopy.inspectorFields}</p>
            <div className="space-y-2">
              {node.interactiveFields.map((field) => (
                <FieldCard key={field.key} field={field} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
