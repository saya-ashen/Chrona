import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { ChevronUp, Copy, X } from "lucide-react";
import type { ExecutionActionInput, NodeResultOutput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import { DEFAULT_GRAPH_COPY } from "@/components/tasks/plan/task-plan-graph/constants";
import { TaskPlanGraphInspectorDetails } from "@/components/tasks/plan/task-plan-graph/inspector-details";
import {
  extractRunError,
  extractRunResult,
  ResultOutputCard,
} from "@/components/tasks/plan/task-plan-graph/inspector-run-panel";
import { stringifyResultOutput } from "@/components/tasks/plan/task-plan-graph/result-output-format";
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
import { useI18n } from "@chrona/i18n/react";
import { taskWorkspaceActivityMessages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import type { TaskExecutionDispatchResult } from "../model/task-workspace-query";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import {
  buildDefaultWorkspaceActionFields,
  buildWorkspaceCheckpointActionInput,
  getWorkspaceActionDisabledReason,
  pickDefaultWorkspaceAction,
} from "../model/task-workspace-actions";
import type { NodeDetailPanelState, WorkspaceActivityItem } from "../model/task-workspace-types";
import { WorkspaceActivityFeed } from "./workspace-activity-feed";

type TaskWorkspaceCopy = Record<string, string | undefined>;

function useTaskWorkspaceCopy(): TaskWorkspaceCopy {
  const { messages } = useI18n();
  return messages.components?.taskWorkspace ?? {};
}

type NodeDetailVariant = "panel" | "rail" | "drawer";
export type NodeDrawerSize = "collapsed" | "expanded";
export type NodeDrawerFrame = { left: number; width: number };

const TAB_ORDER: NodeDetailPanelState["tabs"][number][] = [
  "result",
  "activity",
  "action",
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
  const copy = useTaskWorkspaceCopy();
  return (
    <section
      id="task-workspace-node-actions"
      aria-label={copy.currentNodeDetails ?? "Current node details"}
      className="scroll-mt-4"
    >
      <div className="rounded-[1.35rem] border border-dashed border-border bg-card/75 px-4 py-5 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold text-foreground">
          {copy.emptyDetailState ?? "No active node selected"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a plan node, generate a plan, or wait for execution to expose the current node details here.
        </p>
      </div>
    </section>
  );
}

function outputsContainText(outputs: NodeResultOutput[], text: string | null) {
  const normalizedText = text?.trim();
  if (!normalizedText) return false;

  return outputs.some((output) => stringifyResultOutput(output).includes(normalizedText));
}

function ResultTab({ node }: { node: PlanNodeDataModel }) {
  const copy = useTaskWorkspaceCopy();
  const rawRunResult = useMemo(() => extractRunResult(node), [node]);
  const runError = useMemo(() => extractRunError(node), [node]);
  const outputs = node.resultOutputs ?? [];
  const runResult = outputsContainText(outputs, rawRunResult) ? null : rawRunResult;
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const copyText = [runResult, ...outputs.map(stringifyResultOutput)]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n");

  async function handleCopyResult() {
    if (!copyText) return;

    try {
      await navigator.clipboard.writeText(copyText);
      setCopyStatus(copy.copiedResult ?? "Copied result.");
    } catch {
      setCopyStatus(copy.copyFailed ?? "Copy failed. Select the result text manually.");
    }
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-[1rem] border border-border/70 bg-card/90 p-3 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            {copy.resultSummary ?? "Result summary"}
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
              {copy.copyResult ?? "Copy result"}
            </Button>
          ) : null}
        </div>
        {copyStatus ? (
          <p className="mb-2 text-xs text-muted-foreground" role="status">
            {copyStatus}
          </p>
        ) : null}
        {runError ? (
          <pre className="whitespace-pre-wrap text-xs leading-5 text-destructive">
            {runError}
          </pre>
        ) : outputs.length > 0 ? (
          <div className="space-y-2">
            {runResult ? (
              <p className="text-sm leading-5 text-foreground/80">{runResult}</p>
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
          <p className="text-sm leading-5 text-foreground/80">{runResult}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {copy.noRunResult ?? "No run result yet for this node."}
          </p>
        )}
      </div>
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
  const copy = useTaskWorkspaceCopy();
  const label = (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground/90">{field.label}</span>
      {field.required ? (
        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning-foreground">
          {copy.requiredLabel ?? "Required"}
        </span>
      ) : null}
      {readOnly ? (
        <span className="rounded-full bg-success/12 px-1.5 py-0.5 text-[10px] text-success">
          {copy.submittedLabel ?? "submitted"}
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
            "rounded-xl border-border bg-background text-sm shadow-sm",
            readOnly && "bg-muted/50 text-muted-foreground",
          )}
        />
        {invalid ? <FieldError errors={[error]} /> : null}
      </Field>
    );
  }

  if (field.control === "select" || field.control === "approval") {
    const options = field.options ?? [
      copy.approve ?? "Approve",
      copy.reject ?? "Reject",
      copy.needsChanges ?? "Needs changes",
    ];
    const shouldShowSubmittedOption = readOnly && value && !options.includes(value);

    return (
      <Field data-invalid={invalid} className="gap-1.5">
        <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
        <Select
          value={value}
          disabled={readOnly}
          onValueChange={onChange}
        >
          <SelectTrigger id={fieldId} aria-invalid={invalid} className="w-full rounded-xl border-border bg-background text-sm shadow-sm">
            <SelectValue placeholder={copy.selectPlaceholder ?? "Select..."} />
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
          "rounded-xl border-border bg-background text-sm shadow-sm",
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

function AutoRefreshIndicator({ enabled }: { enabled: boolean }) {
  const copy = useTaskWorkspaceCopy();
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
      title={enabled
        ? (copy.liveUpdatesOn ?? "Live updates are on while this node is active.")
        : (copy.liveUpdatesResume ?? "Live updates resume when this node becomes active.")}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          enabled ? "animate-pulse bg-success" : "bg-muted-foreground/40",
        )}
      />
      <span>{enabled ? (copy.live ?? "Live") : (copy.idle ?? "Idle")}</span>
    </span>
  );
}

function WorkspaceActionSubmit({
  asSubmit,
  isDispatching,
  selectedActionLabel,
  submitDisabledReason,
  onClick,
  className,
}: {
  asSubmit: boolean;
  isDispatching: boolean;
  selectedActionLabel?: string;
  submitDisabledReason?: string | null;
  onClick?: () => void;
  className?: string;
}) {
  const copy = useTaskWorkspaceCopy();
  const submitLabel = isDispatching
    ? (copy.sending ?? "Sending...")
    : selectedActionLabel
      ? `${copy.sendPrefix ?? "Send"} ${selectedActionLabel}`
      : (copy.sendInput ?? "Send input");
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        type={asSubmit ? "submit" : "button"}
        disabled={Boolean(submitDisabledReason)}
        title={submitDisabledReason ?? undefined}
        onClick={onClick}
        variant="default"
        size="sm"
        className="h-8 rounded-full px-3 text-xs shadow-sm"
      >
        {submitLabel}
      </Button>
      {submitDisabledReason ? (
        <span className="text-xs text-muted-foreground">{submitDisabledReason}</span>
      ) : null}
    </div>
  );
}

function hasSubmittedInputFields(inputFields: Record<string, string> | undefined) {
  return Boolean(inputFields && Object.values(inputFields).some((value) => value.trim()));
}

export function WorkspaceNodeActionControls({
  node,
  disabledActionReason,
  onDispatchExecutionAction,
  onSubmitCheckpointAction,
  className,
}: {
  node: PlanNodeDataModel;
  disabledActionReason?: string;
  onDispatchExecutionAction?: (
    action: ExecutionActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
  onSubmitCheckpointAction?: (
    action: SubmitCheckpointActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
  className?: string;
}) {
  const actions = node.availableActions ?? [];
  const copy = useTaskWorkspaceCopy();
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
    copy,
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
      if (selectedAction?.executionAction) {
        if (!onDispatchExecutionAction) {
          throw new Error(copy.executionActionsUnavailable ?? "Execution actions are not available for this view.");
        }
        const result = await onDispatchExecutionAction(selectedAction.executionAction);
        setActionStatus(result.message);
        return;
      }

      if (!onSubmitCheckpointAction) {
        throw new Error(copy.checkpointActionsUnavailable ?? "Checkpoint actions are not available for this view.");
      }

      const result = await onSubmitCheckpointAction(buildWorkspaceCheckpointActionInput({
        node,
        selectedAction,
        fields,
        values,
      }));
      setActionStatus(result.message);
    } catch (cause) {
      setActionStatus(cause instanceof Error ? cause.message : (copy.failedDispatchExecution ?? "Failed to dispatch execution action."));
    } finally {
      setIsDispatching(false);
    }
  }

  return (
    <div className={cn("rounded-[1rem] border border-warning/40 bg-warning/10 p-3 shadow-sm", className)}>
      <p className="text-sm font-semibold text-foreground">{copy.actionRequiredTitle ?? "Action required"}</p>
      <p className="mt-1 break-words text-sm text-muted-foreground">
        {node.nextAction ??
          node.summary ??
          (copy.reviewNodeState ?? "Review the current node state before continuing.")}
      </p>
      {disabledActionReason ? (
        <div className="mt-2 rounded-lg border border-warning/40 bg-background/80 px-2.5 py-1.5 text-sm text-warning-foreground">
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
            <SelectTrigger className="w-full rounded-xl border-border bg-background text-sm shadow-sm">
              <SelectValue placeholder={copy.selectActionLabel ?? "Select action"} />
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
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-success">
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
            <WorkspaceActionSubmit
              asSubmit
              isDispatching={isDispatching}
              selectedActionLabel={selectedAction?.label}
              submitDisabledReason={submitDisabledReason}
            />
          ) : null}
        </form>
      ) : (
        <p className="mt-2 rounded-xl border border-border/70 bg-background/80 px-2.5 py-1.5 text-sm text-muted-foreground">
          {node.interactionType === "wait"
            ? "This node is waiting on an external event, so there is no manual form to fill here."
            : "This node does not require free-form input."}
        </p>
      )}
      {hasActionPayload && fields.length === 0 ? (
        <WorkspaceActionSubmit
          asSubmit={false}
          isDispatching={isDispatching}
          selectedActionLabel={selectedAction?.label}
          submitDisabledReason={submitDisabledReason}
          onClick={() => void form.handleSubmit(handleSubmitAction)()}
          className="mt-3"
        />
      ) : null}
      {actionStatus ? (
        <p className="mt-2 rounded-xl border border-border/70 bg-background/85 px-2.5 py-1.5 text-sm text-muted-foreground" role="status">
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
    <div className="rounded-[1rem] border border-border/70 bg-card/90 p-3 shadow-sm">
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
  activity,
  runtimeEvents = [],
  isActivityLoading,
  selectedNodes,
  variant = "panel",
  drawerSize = "expanded",
  drawerFrame,
  onDrawerSizeChange,
  preferredTab,
  onPreferredTabApplied,
  onDispatchExecutionAction,
  onSubmitCheckpointAction,
}: {
  detail: NodeDetailPanelState;
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  isActivityLoading?: boolean;
  selectedNodes: PlanNodeDataModel[];
  variant?: NodeDetailVariant;
  drawerSize?: NodeDrawerSize;
  drawerFrame?: NodeDrawerFrame | null;
  onDrawerSizeChange?: (size: NodeDrawerSize) => void;
  preferredTab?: NodeDetailPanelState["tabs"][number] | null;
  onPreferredTabApplied?: () => void;
  onDispatchExecutionAction?: (
    action: ExecutionActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
  onSubmitCheckpointAction?: (
    action: SubmitCheckpointActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
}) {
  const currentNode = detail.currentNode;
  const copy = useTaskWorkspaceCopy();
  const tabLabels: Record<NodeDetailPanelState["tabs"][number], string> = {
    result: copy.tabResult ?? "Result",
    action: copy.tabAction ?? "Action",
    activity: copy.tabActivity ?? "Activity",
    configuration: copy.tabDetails ?? "Details",
  };
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
  const drawerNodeTitle = detail.title || node.title || (copy.selectedNode ?? "Selected node");
  const tabs = (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as NodeDetailPanelState["tabs"][number])} className="min-h-0 flex-1 gap-0">
      <TabsList aria-label={copy.nodeDetailTabsAria ?? "Node detail tabs"} className="flex h-auto justify-start gap-1 rounded-none border-b border-border/70 bg-card/70 px-2.5 py-1.5">
        {orderedTabs.map((tab) => (
          <TabsTrigger key={tab} value={tab} onClick={() => setActiveTab(tab)} className="flex-none rounded-full px-2.5 py-1 text-[11px] font-semibold data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm">
            {tabLabels[tab]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="result" aria-label={`${tabLabels.result} tab`} className={cn("min-h-0 flex-1 overflow-y-auto bg-muted/40 p-2", variant === "rail" && "max-h-none")}>
        <ResultTab node={node} />
      </TabsContent>
      <TabsContent value="activity" aria-label={`${tabLabels.activity} tab`} className={cn("min-h-0 flex-1 overflow-y-auto bg-muted/40 p-2", variant === "rail" && "max-h-none")}>
        <WorkspaceActivityFeed
          activity={activity}
          runtimeEvents={runtimeEvents}
          title={taskWorkspaceActivityMessages.nodeTitle}
          emptyMessage={isActivityLoading ? (copy.loadingNodeActivity ?? "Loading node activity...") : taskWorkspaceActivityMessages.nodeEmpty}
        />
      </TabsContent>
      <TabsContent value="action" aria-label={`${tabLabels.action} tab`} className={cn("min-h-0 flex-1 overflow-y-auto bg-muted/40 p-2", variant === "rail" && "max-h-none")}>
        <WorkspaceNodeActionControls
          node={node}
          disabledActionReason={detail.disabledActionReason}
          onDispatchExecutionAction={onDispatchExecutionAction}
          onSubmitCheckpointAction={onSubmitCheckpointAction}
        />
      </TabsContent>
      <TabsContent value="configuration" aria-label={`${tabLabels.configuration} tab`} className={cn("min-h-0 flex-1 overflow-y-auto bg-muted/40 p-2", variant === "rail" && "max-h-none")}>
        <ConfigurationTab node={node} nodes={selectedNodes} />
      </TabsContent>
    </Tabs>
  );

  if (isDrawer) {
    if (drawerSize === "collapsed") {
      return (
        <button
          id="task-workspace-node-actions"
          type="button"
          aria-label={copy.openNodeDrawer ?? "Open selected node drawer"}
          data-node-detail-drawer="true"
          onClick={() => onDrawerSizeChange?.("expanded")}
          className="pointer-events-auto flex h-[52px] w-full min-w-0 items-center justify-between gap-2 rounded-[1.35rem] border border-border/70 bg-card/95 px-2.5 py-1.5 text-left shadow-lg backdrop-blur transition hover:border-primary/40 hover:bg-primary-soft"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              Node
            </span>
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {drawerNodeTitle}
            </span>
            <Badge variant={statusTone(detail.status)}>
              {detail.status ?? "waiting"}
            </Badge>
            <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Step {detail.stepPosition}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <AutoRefreshIndicator enabled={detail.autoRefreshEnabled} />
            <span className="flex size-7 items-center justify-center rounded-full border border-primary/30 bg-primary-soft text-primary">
              <ChevronUp />
            </span>
          </span>
        </button>
      );
    }

    return (
      <section
        id="task-workspace-node-actions"
        aria-label={copy.currentNodeDetails ?? "Current node details"}
        data-node-detail-drawer="true"
        className="pointer-events-auto fixed inset-x-2 bottom-2 z-50 mx-auto flex h-[min(72vh,680px)] max-w-[calc(100vw-1rem)] select-text flex-col overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/95 text-sm text-popover-foreground shadow-xl backdrop-blur"
        style={drawerFrame ? { left: drawerFrame.left, right: "auto", width: drawerFrame.width } : undefined}
      >
        <div className="border-b border-border/70 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--card)_92%,transparent),color-mix(in_oklab,var(--primary-soft)_60%,var(--card)))] px-2.5 py-1.5 text-left">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                Node
              </span>
              <h2 className="min-w-0 truncate font-heading text-sm font-semibold text-foreground">
                Current node: {drawerNodeTitle}
              </h2>
              <Badge variant={statusTone(detail.status)}>
                {detail.status ?? "waiting"}
              </Badge>
              <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Step {detail.stepPosition}
              </span>
              <p className="sr-only">
                Inspect result, activity, actions, and details for the selected plan node.
              </p>
            </div>
            <AutoRefreshIndicator enabled={detail.autoRefreshEnabled} />
            <Button type="button" variant="ghost" size="icon-xs" aria-label={copy.closeNodeDrawer ?? "Close selected node drawer"} className="rounded-full" onClick={() => onDrawerSizeChange?.("collapsed")}>
              <X />
            </Button>
          </div>
        </div>
        {tabs}
      </section>
    );
  }

  return (
    <section
      id="task-workspace-node-actions"
      aria-label={copy.currentNodeDetails ?? "Current node details"}
      className={cn(
        "flex min-w-0 scroll-mt-2 flex-col overflow-hidden backdrop-blur",
        variant === "rail"
          ? "h-[420px] max-h-[55vh] rounded-[1.35rem] border border-border/70 bg-card/90 shadow-lg"
          : "h-[380px] max-h-[calc(100vh-1rem)] rounded-[1.35rem] border border-border/70 bg-card/90 shadow-lg md:h-[340px] xl:h-full xl:max-h-[calc(100vh-1.5rem)]",
      )}
    >
      <div className={cn(
        "flex items-center justify-between gap-2 border-b px-2.5",
        "border-border/70 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--card)_92%,transparent),color-mix(in_oklab,var(--primary-soft)_60%,var(--card)))] py-1.5",
      )}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            Node
          </p>
          <h2 aria-label={`Current node: ${detail.title}`} className="min-w-0 truncate text-sm font-semibold text-foreground">
            {detail.title}
          </h2>
          <Badge variant={statusTone(detail.status)}>
            {detail.status ?? "waiting"}
          </Badge>
          <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Step {detail.stepPosition}
          </span>
        </div>
        <AutoRefreshIndicator enabled={detail.autoRefreshEnabled} />
      </div>

      {tabs}

    </section>
  );
}
