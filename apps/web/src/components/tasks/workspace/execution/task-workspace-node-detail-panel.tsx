import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
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
import { buttonVariants } from "@/components/ui/button";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
} from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { TaskExecutionDispatchResult } from "../model/task-workspace-query";
import type { NodeDetailPanelState } from "../model/task-workspace-types";

const TAB_LABELS: Record<NodeDetailPanelState["tabs"][number], string> = {
  result: "Result",
  action: "Action",
  evidence: "Evidence",
  configuration: "Configuration",
};

const TAB_ORDER: NodeDetailPanelState["tabs"][number][] = [
  "result",
  "action",
  "evidence",
  "configuration",
];

function statusTone(status: NodeDetailPanelState["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "running") return "info" as const;
  if (status === "approval-needed") return "warning" as const;
  if (status === "blocked") return "critical" as const;
  return "neutral" as const;
}

function tabClassName(active: boolean) {
  return cn(
    "border-b-2 px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-primary text-primary"
      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
  );
}

function buildDefaultFieldValues(fields: PlanNodeField[]) {
  return Object.fromEntries(
    fields.map((field) => [field.key, field.value || ""]),
  );
}

function defaultActionForNode(node: PlanNodeDataModel) {
  return (
    node.availableActions?.find((action) => action.emphasis === "primary")
      ?.id ??
    node.availableActions?.[0]?.id ??
    null
  );
}

function EmptyDetailState() {
  return (
    <section
      id="task-workspace-node-actions"
      aria-label="Current node details"
      className="scroll-mt-4"
    >
      <div className="rounded-[1.35rem] border border-dashed border-border/60 bg-background px-4 py-5">
        <p className="text-sm font-semibold text-foreground">
          {DEFAULT_GRAPH_COPY.inspectorTitle}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {DEFAULT_GRAPH_COPY.inspectorEmpty}
        </p>
      </div>
    </section>
  );
}

function ResultTab({ node }: { node: PlanNodeDataModel }) {
  const runResult = useMemo(() => extractRunResult(node), [node]);
  const runError = useMemo(() => extractRunError(node), [node]);
  const outputs = node.resultOutputs ?? [];

  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px]">
      <div className="rounded-lg border border-border/50 bg-white p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            Result summary
          </p>
          {runResult || outputs.length > 0 ? (
            <button
              type="button"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "h-7 rounded-lg px-2 text-xs",
              })}
            >
              <Copy className="size-3.5" />
              Copy result
            </button>
          ) : null}
        </div>
        {runError ? (
          <pre className="whitespace-pre-wrap text-xs leading-5 text-red-700">
            {runError}
          </pre>
        ) : outputs.length > 0 ? (
          <div className="space-y-2">
            {runResult ? (
              <p className="text-sm leading-5 text-foreground">{runResult}</p>
            ) : null}
            {outputs.map((output, index) => (
              <ResultOutputCard
                key={`${output.kind}:${index}`}
                output={output}
              />
            ))}
          </div>
        ) : runResult ? (
          <p className="text-sm leading-5 text-foreground">{runResult}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No run result yet for this node.
          </p>
        )}
      </div>
      <EvidenceSummary node={node} />
    </div>
  );
}

function EvidenceSummary({ node }: { node: PlanNodeDataModel }) {
  const evidence = useMemo(
    () => evidenceLines(node.resultEvidence),
    [node.resultEvidence],
  );

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/55 p-2.5">
      <p className="text-sm font-semibold text-foreground">Key evidence</p>
      {evidence.length > 0 ? (
        <div className="mt-1.5 space-y-1">
          {evidence.slice(0, 4).map((line) => (
            <div
              key={line}
              className="rounded-md bg-white/80 px-2 py-1 text-xs text-muted-foreground"
            >
              {line}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          No evidence or runtime metadata is attached to this node yet.
        </p>
      )}
    </div>
  );
}

function EvidenceTab({ node }: { node: PlanNodeDataModel }) {
  const evidence = useMemo(
    () => evidenceLines(node.resultEvidence),
    [node.resultEvidence],
  );

  return (
    <div className="rounded-lg border border-border/50 bg-white p-2.5">
      <p className="text-sm font-semibold text-foreground">Evidence</p>
      {evidence.length > 0 ? (
        <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
          {evidence.join("\n")}
        </pre>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No evidence or runtime metadata is attached to this node yet.
        </p>
      )}
    </div>
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
  const label = (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground">{field.label}</span>
      {field.required ? (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
          required
        </span>
      ) : null}
    </div>
  );

  if (field.control === "textarea") {
    return (
      <label className="space-y-1.5">
        {label}
        <textarea
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            textareaClassName,
            "rounded-xl border-border/70 bg-background/80 text-sm",
          )}
        />
      </label>
    );
  }

  if (field.control === "select" || field.control === "approval") {
    return (
      <label className="space-y-1.5">
        {label}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            selectClassName,
            "rounded-xl border-border/70 bg-background/80 text-sm",
          )}
        >
          <option value="">Select...</option>
          {(field.options ?? ["Approve", "Reject", "Needs changes"]).map(
            (option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ),
          )}
        </select>
      </label>
    );
  }

  return (
    <label className="space-y-1.5">
      {label}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          inputClassName,
          "rounded-xl border-border/70 bg-background/80 text-sm",
        )}
      />
    </label>
  );
}

function ActionTab({
  node,
  disabledActionReason,
  selectedActionId,
  setSelectedActionId,
  fieldValues,
  setFieldValues,
}: {
  node: PlanNodeDataModel;
  disabledActionReason?: string;
  selectedActionId: string | null;
  setSelectedActionId: (actionId: string) => void;
  fieldValues: Record<string, string>;
  setFieldValues: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
}) {
  const actions = node.availableActions ?? [];
  const fields = node.interactiveFields ?? [];

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/55 p-2.5">
      <p className="text-sm font-semibold text-foreground">Action required</p>
      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
        {node.nextAction ??
          node.summary ??
          "Review the current node state before continuing."}
      </p>
      {disabledActionReason ? (
        <div className="mt-2 rounded-lg border border-amber-300/60 bg-white/80 px-2.5 py-1.5 text-sm text-amber-900">
          {disabledActionReason}
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => setSelectedActionId(action.id)}
              className={buttonVariants({
                variant: selectedActionId === action.id ? "default" : "outline",
                size: "sm",
                className: "h-7 rounded-lg px-2 text-xs",
              })}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {fields.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {fields.map((field) => (
            <RunField
              key={field.key}
              field={field}
              value={fieldValues[field.key] ?? ""}
              onChange={(value) =>
                setFieldValues((current) => ({
                  ...current,
                  [field.key]: value,
                }))
              }
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-border/50 bg-white/75 px-2.5 py-1.5 text-sm text-muted-foreground">
          {node.interactionType === "wait"
            ? "This node is waiting on an external event, so there is no manual form to fill here."
            : "This node does not require free-form input."}
        </p>
      )}
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
    <div className="rounded-lg border border-border/50 bg-white p-2.5">
      <TaskPlanGraphInspectorDetails
        node={node}
        graphCopy={DEFAULT_GRAPH_COPY}
        nodes={nodes}
      />
    </div>
  );
}

export function TaskWorkspaceNodeDetailPanel({
  detail,
  selectedNodes,
}: {
  detail: NodeDetailPanelState;
  selectedNodes: PlanNodeDataModel[];
  onDispatchExecutionAction: (
    action: ExecutionActionInput,
  ) => Promise<TaskExecutionDispatchResult>;
}) {
  const currentNode = detail.currentNode;
  const [activeTab, setActiveTab] = useState<
    NodeDetailPanelState["tabs"][number]
  >(detail.tabs[0] ?? "result");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(() =>
    currentNode ? defaultActionForNode(currentNode) : null,
  );
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    buildDefaultFieldValues(currentNode?.interactiveFields ?? []),
  );

  useEffect(() => {
    setActiveTab(detail.tabs[0] ?? "result");
    setSelectedActionId(currentNode ? defaultActionForNode(currentNode) : null);
    setFieldValues(
      buildDefaultFieldValues(currentNode?.interactiveFields ?? []),
    );
  }, [currentNode, detail.tabs]);

  if (!currentNode) return <EmptyDetailState />;

  const node = currentNode;
  const orderedTabs = TAB_ORDER.filter((tab) => detail.tabs.includes(tab));

  return (
    <section
      id="task-workspace-node-actions"
      aria-label="Current node details"
      className="flex h-[380px] max-h-[calc(100vh-1rem)] scroll-mt-2 flex-col rounded-[0.9rem] border border-border/50 bg-white shadow-none md:h-[360px] xl:h-full xl:max-h-[calc(100vh-1.5rem)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-2.5 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Current node: {detail.title}
          </h2>
          <StatusBadge tone={statusTone(detail.status)}>
            {detail.status ?? "waiting"}
          </StatusBadge>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            Step {detail.stepPosition}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Auto-refresh</span>
          <span
            className={cn(
              "h-5 w-9 rounded-full p-0.5",
              detail.autoRefreshEnabled ? "bg-primary" : "bg-muted",
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
      </div>

      <div
        className="flex gap-1 border-b border-border/50 px-2.5"
        role="tablist"
        aria-label="Node detail tabs"
      >
        {orderedTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={tabClassName(activeTab === tab)}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        aria-label={`${TAB_LABELS[activeTab]} tab`}
        className="min-h-0 flex-1 overflow-y-auto bg-white p-2"
      >
        {activeTab === "result" ? <ResultTab node={node} /> : null}
        {activeTab === "evidence" ? <EvidenceTab node={node} /> : null}
        {activeTab === "action" ? (
          <ActionTab
            node={node}
            disabledActionReason={detail.disabledActionReason}
            selectedActionId={selectedActionId}
            setSelectedActionId={setSelectedActionId}
            fieldValues={fieldValues}
            setFieldValues={setFieldValues}
          />
        ) : null}
        {activeTab === "configuration" ? (
          <ConfigurationTab node={node} nodes={selectedNodes} />
        ) : null}
      </div>

    </section>
  );
}
