import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { ChevronDown, ChevronUp, Copy, Maximize2, Minimize2 } from "lucide-react";
import type { NodeResultOutput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import { DEFAULT_GRAPH_COPY } from "@/components/tasks/plan/task-plan-graph/constants";
import { TaskPlanGraphInspectorDetails } from "@/components/tasks/plan/task-plan-graph/inspector-details";
import {
  evidenceLines,
  extractRunError,
  extractRunResult,
  ResultOutputCard,
} from "@/components/tasks/plan/task-plan-graph/inspector-run-panel";
import type {
  PlanNodeDataModel,
  PlanNodeField,
} from "@/components/tasks/plan/task-plan-graph/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TaskExecutionDispatchResult } from "../model/task-workspace-query";
import {
  buildDefaultWorkspaceActionFields,
  buildWorkspaceCheckpointActionInput,
  getWorkspaceActionDisabledReason,
  pickDefaultWorkspaceAction,
} from "../model/task-workspace-actions";
import type { NodeDetailPanelState } from "../model/task-workspace-types";

const TAB_LABELS: Record<NodeDetailPanelState["tabs"][number], string> = {
  result: "Result",
  action: "Action",
  evidence: "Evidence",
  configuration: "Details",
};

type NodeDetailVariant = "panel" | "rail" | "drawer";
type NodeDrawerSize = "collapsed" | "half" | "expanded";

const TAB_ORDER: NodeDetailPanelState["tabs"][number][] = [
  "result",
  "action",
  "evidence",
  "configuration",
];

function statusTone(status: NodeDetailPanelState["status"]) {
  if (status === "completed") return "secondary" as const;
  if (status === "running") return "secondary" as const;
  if (status === "approval-needed") return "secondary" as const;
  if (status === "blocked") return "destructive" as const;
  return "outline" as const;
}

function EmptyDetailState() {
  return (
    <section
      id="task-workspace-node-actions"
      aria-label="Current node details"
      className="scroll-mt-4"
    >
      <div className="rounded-[1.35rem] border border-dashed border-slate-300 bg-white/75 px-4 py-5 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold text-slate-950">
          No active node selected
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Select a plan node, generate a plan, or wait for execution to expose the current node details here.
        </p>
      </div>
    </section>
  );
}

function stringifyOutput(output: NodeResultOutput) {
  if (output.kind === "text" || output.kind === "markdown") return output.content;
  if (output.kind === "json") return JSON.stringify(output.value, null, 2);
  if (output.kind === "file") return [output.title, output.path, output.description].filter(Boolean).join("\n");
  return "";
}

function ResultTab({ node }: { node: PlanNodeDataModel }) {
  const runResult = useMemo(() => extractRunResult(node), [node]);
  const runError = useMemo(() => extractRunError(node), [node]);
  const outputs = node.resultOutputs ?? [];
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const copyText = [runResult, ...outputs.map(stringifyOutput)]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n");

  async function handleCopyResult() {
    if (!copyText) return;

    try {
      await navigator.clipboard.writeText(copyText);
      setCopyStatus("Copied result.");
    } catch {
      setCopyStatus("Copy failed. Select the result text manually.");
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-950">
            Result summary
          </p>
          {runResult || outputs.length > 0 ? (
            <Button
              type="button"
              onClick={handleCopyResult}
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
            >
              <Copy className="size-3.5" />
              Copy result
            </Button>
          ) : null}
        </div>
        {copyStatus ? (
          <p className="mb-2 text-xs text-slate-500" role="status">
            {copyStatus}
          </p>
        ) : null}
        {runError ? (
          <pre className="whitespace-pre-wrap text-xs leading-5 text-red-700">
            {runError}
          </pre>
        ) : outputs.length > 0 ? (
          <div className="space-y-2">
            {runResult ? (
              <p className="text-sm leading-5 text-slate-800">{runResult}</p>
            ) : null}
            {outputs.map((output, index) => (
              <ResultOutputCard
                key={`${output.kind}:${index}`}
                output={output}
                disableInternalScroll
              />
            ))}
          </div>
        ) : runResult ? (
          <p className="text-sm leading-5 text-slate-800">{runResult}</p>
        ) : (
          <p className="text-sm text-slate-500">
            No run result yet for this node.
          </p>
        )}
      </div>
    </div>
  );
}

function EvidenceTab({ node }: { node: PlanNodeDataModel }) {
  const evidence = useMemo(
    () => evidenceLines(node.resultEvidence),
    [node.resultEvidence],
  );

  return (
    <div className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <p className="text-sm font-semibold text-slate-950">Evidence</p>
      {evidence.length > 0 ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-950/[0.035] p-3 text-xs leading-5 text-slate-600">
          {evidence.join("\n")}
        </pre>
      ) : (
        <p className="mt-2 text-sm text-slate-500">
          No evidence or runtime metadata is attached to this node yet.
        </p>
      )}
    </div>
  );
}

function RunField({
  field,
  value,
  invalid,
  error,
  onChange,
  readOnly = false,
}: {
  field: PlanNodeField;
  value: string;
  invalid?: boolean;
  error?: { message?: string };
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const fieldId = `node-action-${field.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const label = (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-slate-800">{field.label}</span>
      {field.required ? (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
          required
        </span>
      ) : null}
      {readOnly ? (
        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
          submitted
        </span>
      ) : null}
    </div>
  );

  if (field.control === "textarea") {
    return (
      <Field data-invalid={invalid} className="gap-1.5">
        <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
        <Textarea
          id={fieldId}
          aria-invalid={invalid}
          rows={3}
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "rounded-xl border-slate-200 bg-white/90 text-sm shadow-sm",
            readOnly && "bg-muted/50 text-muted-foreground",
          )}
        />
        {invalid ? <FieldError errors={[error]} /> : null}
      </Field>
    );
  }

  if (field.control === "select" || field.control === "approval") {
    const options = field.options ?? ["Approve", "Reject", "Needs changes"];
    const shouldShowSubmittedOption = readOnly && value && !options.includes(value);

    return (
      <Field data-invalid={invalid} className="gap-1.5">
        <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
        <Select
          value={value}
          disabled={readOnly}
          onValueChange={onChange}
        >
          <SelectTrigger id={fieldId} aria-invalid={invalid} className="w-full rounded-xl border-slate-200 bg-white/90 text-sm shadow-sm">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {shouldShowSubmittedOption ? (
                <SelectItem value={value}>{value}</SelectItem>
              ) : null}
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {invalid ? <FieldError errors={[error]} /> : null}
      </Field>
    );
  }

  return (
    <Field data-invalid={invalid} className="gap-1.5">
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <Input
        id={fieldId}
        aria-invalid={invalid}
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "rounded-xl border-slate-200 bg-white/90 text-sm shadow-sm",
          readOnly && "bg-muted/50 text-muted-foreground",
        )}
      />
      {invalid ? <FieldError errors={[error]} /> : null}
    </Field>
  );
}

function isTerminalStatus(status: PlanNodeDataModel["status"]) {
  return status === "done" || status === "skipped";
}

function hasSubmittedInputFields(inputFields: Record<string, string> | undefined) {
  return Boolean(inputFields && Object.values(inputFields).some((value) => value.trim()));
}

export function WorkspaceNodeActionControls({
  node,
  disabledActionReason,
  onSubmitCheckpointAction,
  className,
}: {
  node: PlanNodeDataModel;
  disabledActionReason?: string;
  onSubmitCheckpointAction?: (
    action: SubmitCheckpointActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
  className?: string;
}) {
  const actions = node.availableActions ?? [];
  const fields = useMemo(() => node.interactiveFields ?? [], [node.interactiveFields]);
  const fieldStructureKey = fields
    .map((field) => `${field.key}:${field.control ?? "text"}:${field.required ? "required" : "optional"}:${field.options?.join(",") ?? ""}`)
    .join("|");
  const actionOptionsKey = actions
    .map((action) => `${action.id}:${action.emphasis ?? ""}`)
    .join("|");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(() =>
    pickDefaultWorkspaceAction(node),
  );
  const form = useForm<Record<string, string>>({
    defaultValues: buildDefaultWorkspaceActionFields(fields),
    mode: "onChange",
  });
  const resetKey = `${node.id}|${fieldStructureKey}`;
  const lastResetKeyRef = useRef(resetKey);
  const fieldValues = (useWatch({ control: form.control }) as Record<string, string> | undefined) ?? buildDefaultWorkspaceActionFields(fields);
  const selectedAction = actions.find((action) => action.id === selectedActionId) ?? null;
  const submittedFields = node.inputFields;
  const isReadOnlySubmittedInput = fields.length > 0 && isTerminalStatus(node.status) && hasSubmittedInputFields(submittedFields);
  const hasActionPayload = actions.length > 0 || (fields.length > 0 && !isReadOnlySubmittedInput);
  const [isDispatching, setIsDispatching] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const submitDisabledReason = getWorkspaceActionDisabledReason({
    fields,
    values: fieldValues,
    isDispatching,
    baseReason: disabledActionReason,
  });

  useEffect(() => {
    setSelectedActionId((currentActionId) =>
      currentActionId && actions.some((action) => action.id === currentActionId)
        ? currentActionId
        : pickDefaultWorkspaceAction(node),
    );
  }, [actionOptionsKey, actions, node]);

  useEffect(() => {
    if (lastResetKeyRef.current === resetKey) return;

    lastResetKeyRef.current = resetKey;
    form.reset(buildDefaultWorkspaceActionFields(fields));
  }, [fields, form, resetKey]);

  async function handleSubmitAction(values: Record<string, string>) {
    if (submitDisabledReason) return;

    setIsDispatching(true);
    setActionStatus(null);
    try {
      if (!onSubmitCheckpointAction) {
        throw new Error("Checkpoint actions are not available for this view.");
      }

      const result = await onSubmitCheckpointAction(buildWorkspaceCheckpointActionInput({
        node,
        selectedAction,
        fields,
        values,
      }));
      setActionStatus(result.message);
    } catch (cause) {
      setActionStatus(cause instanceof Error ? cause.message : "Failed to dispatch execution action.");
    } finally {
      setIsDispatching(false);
    }
  }

  return (
    <div className={cn("rounded-[1rem] border border-orange-200 bg-orange-50/70 p-3 shadow-sm", className)}>
      <p className="text-sm font-semibold text-slate-950">Action required</p>
      <p className="mt-1 break-words text-sm text-slate-600">
        {node.nextAction ??
          node.summary ??
          "Review the current node state before continuing."}
      </p>
      {disabledActionReason ? (
        <div className="mt-2 rounded-lg border border-amber-300/60 bg-white/80 px-2.5 py-1.5 text-sm text-amber-900">
          {disabledActionReason}
        </div>
      ) : null}
      {actions.length > 1 ? (
        <Field className="mt-2 gap-1.5">
          <FieldLabel>Action</FieldLabel>
          <Select
            value={selectedActionId ?? ""}
            onValueChange={setSelectedActionId}
          >
            <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white/90 text-sm shadow-sm">
              <SelectValue placeholder="Select action" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {actions.map((action) => (
                  <SelectItem key={action.id} value={action.id}>
                    {action.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {fields.length > 0 ? (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(event) => void form.handleSubmit(handleSubmitAction)(event)}>
          {isReadOnlySubmittedInput ? (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
              Submitted input
            </p>
          ) : null}
          <FieldGroup className="grid gap-2 md:grid-cols-2">
            {fields.map((field) => (
              <Controller
                key={field.key}
                name={field.key}
                control={form.control}
                rules={{ required: !isReadOnlySubmittedInput && field.required ? "Required" : false }}
                render={({ field: controllerField, fieldState }) =>
                  <RunField
                    field={field}
                    value={isReadOnlySubmittedInput ? submittedFields?.[field.key] ?? field.value?.trim() ?? "" : controllerField.value ?? ""}
                    invalid={fieldState.invalid}
                    error={fieldState.error}
                    readOnly={isReadOnlySubmittedInput}
                    onChange={controllerField.onChange}
                  />
                }
              />
            ))}
          </FieldGroup>
          {hasActionPayload ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={Boolean(submitDisabledReason)}
                title={submitDisabledReason ?? undefined}
                variant="default"
                size="sm"
                className="h-8 rounded-full px-3 text-xs shadow-sm"
              >
                {isDispatching ? "Sending..." : selectedAction ? `Send ${selectedAction.label}` : "Send input"}
              </Button>
              {submitDisabledReason ? (
                <span className="text-xs text-slate-500">{submitDisabledReason}</span>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : (
        <p className="mt-2 rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-sm text-slate-600">
          {node.interactionType === "wait"
            ? "This node is waiting on an external event, so there is no manual form to fill here."
            : "This node does not require free-form input."}
        </p>
      )}
      {hasActionPayload && fields.length === 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={Boolean(submitDisabledReason)}
            title={submitDisabledReason ?? undefined}
            onClick={() => void form.handleSubmit(handleSubmitAction)()}
            variant="default"
            size="sm"
            className="h-8 rounded-full px-3 text-xs shadow-sm"
          >
            {isDispatching ? "Sending..." : selectedAction ? `Send ${selectedAction.label}` : "Send input"}
          </Button>
          {submitDisabledReason ? (
            <span className="text-xs text-slate-500">{submitDisabledReason}</span>
          ) : null}
        </div>
      ) : null}
      {actionStatus ? (
        <p className="mt-2 rounded-xl border border-slate-200/80 bg-white/85 px-2.5 py-1.5 text-sm text-slate-600" role="status">
          {actionStatus}
        </p>
      ) : null}
    </div>
  );
}

function ConfigurationTab({
  node,
  nodes,
}: {
  node: PlanNodeDataModel;
  nodes: PlanNodeDataModel[];
}) {
  return (
    <div className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <TaskPlanGraphInspectorDetails
        node={node}
        graphCopy={DEFAULT_GRAPH_COPY}
        nodes={nodes}
        tone="light"
      />
    </div>
  );
}

export function TaskWorkspaceNodeDetailPanel({
  detail,
  selectedNodes,
  variant = "panel",
  drawerSize = "half",
  onDrawerSizeChange,
  preferredTab,
  onPreferredTabApplied,
  onSubmitCheckpointAction,
}: {
  detail: NodeDetailPanelState;
  selectedNodes: PlanNodeDataModel[];
  variant?: NodeDetailVariant;
  drawerSize?: NodeDrawerSize;
  onDrawerSizeChange?: (size: NodeDrawerSize) => void;
  preferredTab?: NodeDetailPanelState["tabs"][number] | null;
  onPreferredTabApplied?: () => void;
  onSubmitCheckpointAction?: (
    action: SubmitCheckpointActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
}) {
  const currentNode = detail.currentNode;
  const [activeTab, setActiveTab] = useState<
    NodeDetailPanelState["tabs"][number]
  >(detail.tabs[0] ?? "result");

  useEffect(() => {
    if (preferredTab && detail.tabs.includes(preferredTab)) {
      if (preferredTab !== activeTab) {
        setActiveTab(preferredTab);
      }
      onPreferredTabApplied?.();
      return;
    }

    const nextTab = detail.tabs.includes(activeTab)
      ? activeTab
      : detail.tabs[0] ?? "result";

    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeTab, detail.tabs, onPreferredTabApplied, preferredTab]);

  if (!currentNode) return <EmptyDetailState />;

  const node = currentNode;
  const orderedTabs = TAB_ORDER.filter((tab) => detail.tabs.includes(tab));
  const isDrawer = variant === "drawer";
  const isCollapsedDrawer = isDrawer && drawerSize === "collapsed";
  const drawerHeightClass =
    drawerSize === "expanded"
      ? "h-[min(62vh,560px)]"
      : drawerSize === "half"
        ? "h-[340px]"
        : "h-[52px]";
  const nextPrimaryDrawerSize: NodeDrawerSize =
    drawerSize === "collapsed" ? "half" : "collapsed";
  const drawerNodeTitle = detail.title || node.title || "Selected node";

  return (
    <section
      id="task-workspace-node-actions"
      aria-label="Current node details"
      data-node-detail-drawer={isDrawer ? "true" : undefined}
      className={cn(
        "flex min-w-0 scroll-mt-2 flex-col overflow-hidden backdrop-blur",
        variant === "rail"
          ? "h-[420px] max-h-[55vh] rounded-[1.35rem] border border-slate-200/80 bg-white/88 shadow-[0_18px_55px_rgba(15,23,42,0.08)]"
          : isDrawer
            ? cn(
              "pointer-events-auto w-full transition-[height,transform,opacity] duration-200 ease-out",
              drawerHeightClass,
              isCollapsedDrawer
                ? "rounded-t-[1.1rem] border border-white/10 bg-slate-950/94 shadow-[0_-12px_42px_rgba(15,23,42,0.22)]"
                : "rounded-[1.35rem] border border-slate-200/80 bg-white/88 shadow-[0_18px_55px_rgba(15,23,42,0.08)]",
            )
          : "h-[380px] max-h-[calc(100vh-1rem)] rounded-[1.35rem] border border-slate-200/80 bg-white/88 shadow-[0_18px_55px_rgba(15,23,42,0.08)] md:h-[340px] xl:h-full xl:max-h-[calc(100vh-1.5rem)]",
      )}
    >
      <div className={cn(
        "flex items-center justify-between gap-2 border-b px-2.5",
        isCollapsedDrawer
          ? "border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(8,47,73,0.92))] py-2 text-slate-100"
          : "border-slate-200/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.98),rgba(236,254,255,0.72))] py-1.5",
      )}>
        {isDrawer ? (
          <>
            <h2 className="sr-only">Current node: {detail.title}</h2>
            <button
              type="button"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-full px-1.5 py-1 text-left transition-colors",
                isCollapsedDrawer ? "hover:bg-white/10" : "hover:bg-white/70",
              )}
              aria-label={drawerSize === "collapsed" ? "Open selected node drawer" : "Collapse selected node drawer"}
              onClick={() => onDrawerSizeChange?.(nextPrimaryDrawerSize)}
            >
              <span className={cn("shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em]", isCollapsedDrawer ? "text-cyan-200" : "text-cyan-700")}>
                Node
              </span>
              <span className={cn("min-w-0 truncate text-sm font-semibold", isCollapsedDrawer ? "text-white" : "text-slate-950")}>
                {drawerNodeTitle}
              </span>
            </button>
            <div className={cn("flex shrink-0 items-center gap-1 rounded-full p-0.5 shadow-sm", isCollapsedDrawer ? "border border-white/10 bg-white/10" : "border border-slate-200 bg-white/80")}>
              <button
                type="button"
                className={cn("inline-flex size-7 items-center justify-center rounded-full transition-colors", isCollapsedDrawer ? "text-white hover:bg-white/15" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950")}
                aria-label="Toggle selected node drawer"
                onClick={() => onDrawerSizeChange?.(nextPrimaryDrawerSize)}
              >
                {drawerSize === "collapsed" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
              {isCollapsedDrawer ? null : (
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
                  aria-label={drawerSize === "expanded" ? "Show half-height drawer" : "Expand selected node drawer"}
                  onClick={() => onDrawerSizeChange?.(drawerSize === "expanded" ? "half" : "expanded")}
                >
                  {drawerSize === "expanded" ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700">
                Node
              </p>
              <h2 aria-label={`Current node: ${detail.title}`} className="min-w-0 truncate text-sm font-semibold text-slate-950">
                {detail.title}
              </h2>
              <Badge variant={statusTone(detail.status)}>
                {detail.status ?? "waiting"}
              </Badge>
              <span className="shrink-0 rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                Step {detail.stepPosition}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className="hidden sm:inline">Auto-refresh</span>
              <span
                className={cn(
                  "h-5 w-9 rounded-full p-0.5",
                  detail.autoRefreshEnabled ? "bg-slate-950" : "bg-slate-200",
                )}
              >
                <span
                  className={cn(
                    "block size-4 rounded-full bg-white transition-transform",
                    detail.autoRefreshEnabled && "translate-x-4",
                  )}
                />
              </span>
            </div>
          </>
        )}
      </div>

      {isCollapsedDrawer ? null : (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as NodeDetailPanelState["tabs"][number])} className="min-h-0 flex-1 gap-0">
          <TabsList aria-label="Node detail tabs" className="flex h-auto justify-start gap-1 rounded-none border-b border-slate-200/80 bg-white/70 px-2.5 py-1.5">
            {orderedTabs.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="flex-none rounded-full px-2.5 py-1 text-[11px] font-semibold data-active:bg-slate-950 data-active:text-white data-active:shadow-sm" onClick={() => setActiveTab(tab)}>
                {TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="result" aria-label={`${TAB_LABELS.result} tab`} className={cn("min-h-0 flex-1 overflow-y-auto bg-slate-50/75 p-2", variant === "rail" && "max-h-none")}>
            <ResultTab node={node} />
          </TabsContent>
          <TabsContent value="evidence" aria-label={`${TAB_LABELS.evidence} tab`} className={cn("min-h-0 flex-1 overflow-y-auto bg-slate-50/75 p-2", variant === "rail" && "max-h-none")}>
            <EvidenceTab node={node} />
          </TabsContent>
          <TabsContent value="action" aria-label={`${TAB_LABELS.action} tab`} className={cn("min-h-0 flex-1 overflow-y-auto bg-slate-50/75 p-2", variant === "rail" && "max-h-none")}>
            <WorkspaceNodeActionControls
              node={node}
              disabledActionReason={detail.disabledActionReason}
              onSubmitCheckpointAction={onSubmitCheckpointAction}
            />
          </TabsContent>
          <TabsContent value="configuration" aria-label={`${TAB_LABELS.configuration} tab`} className={cn("min-h-0 flex-1 overflow-y-auto bg-slate-50/75 p-2", variant === "rail" && "max-h-none")}>
            <ConfigurationTab node={node} nodes={selectedNodes} />
          </TabsContent>
        </Tabs>
      )}

    </section>
  );
}
