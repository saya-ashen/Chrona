import { useEffect, useMemo, useRef, useState } from "react";
import { buildResultSpec, normalizeChronaSpec, validateChronaSpec } from "@chrona/ui-protocol";
import { DEFAULT_GRAPH_COPY } from "@/components/tasks/plan/task-plan-graph/constants";
import { TaskPlanGraphInspectorDetails } from "@/components/tasks/plan/task-plan-graph/inspector-details";
import { extractRunError } from "@/components/tasks/plan/task-plan-graph/inspector-run-panel";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@chrona/i18n/react";
import { taskWorkspaceActivityMessages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { NodeDetailPanelState, WorkspaceActivityItem } from "../model/task-workspace-types";
import { WorkspaceActivityFeed } from "./workspace-activity-feed";
import { SpecRenderer } from "../catalog/spec-renderer";

type TaskWorkspaceCopy = Record<string, string | undefined>;

function useTaskWorkspaceCopy(): TaskWorkspaceCopy {
  const { messages } = useI18n();
  return messages.components?.taskWorkspace ?? {};
}

const TAB_ORDER: NodeDetailPanelState["tabs"][number][] = [
  "result",
  "activity",
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
      <div className="rounded-[1.15rem] border border-dashed border-border bg-muted/45 px-4 py-5">
        <p className="text-sm font-semibold text-foreground">
          {copy.emptyDetailState ?? "No active node selected"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {copy.emptyDetailStateHint ?? "Select a plan node, generate a plan, or wait for execution to expose the current node details here."}
        </p>
      </div>
    </section>
  );
}

function ResultTab({ node }: { node: PlanNodeDataModel }) {
  const copy = useTaskWorkspaceCopy();
  const runError = useMemo(() => extractRunError(node), [node]);
  const specOutput = node.resultOutputs?.[0] ?? null;
  if (specOutput) {
    const result = validateChronaSpec(specOutput);
    if (result.ok) {
      return <SpecRenderer spec={normalizeChronaSpec(result.spec)} />;
    }
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    return (
      <SpecRenderer
        spec={buildResultSpec([], {
          errorMessage: (copy.invalidResultSpec ?? "Unable to render this node's result ({detail}).").replace("{detail}", detail),
        })}
      />
    );
  }

  const emptyMessage = node.status === "active" || node.status === "in_progress"
    ? (copy.resultPendingWhileRunning ?? "Result will appear when this node completes.")
    : node.status === "done" || node.status === "skipped"
      ? (copy.noUserVisibleDeliverable ?? "This node completed without a user-visible deliverable.")
      : (copy.noRunResult ?? "No run result yet for this node.");

  return (
    <SpecRenderer
      spec={buildResultSpec([], {
        errorMessage: runError ?? undefined,
        emptyMessage: runError ? undefined : emptyMessage,
      })}
    />
  );
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


function hasResultSpec(node: PlanNodeDataModel) {
  return Boolean(node.resultOutputs?.length);
}

function isCompletedNode(node: PlanNodeDataModel) {
  return node.status === "done" || node.status === "skipped";
}

function defaultNodeDetailTab(node: PlanNodeDataModel | null, tabs: NodeDetailPanelState["tabs"]): NodeDetailPanelState["tabs"][number] {
  if (!node) return tabs[0] ?? "result";
  const candidates: NodeDetailPanelState["tabs"] = [
    hasResultSpec(node) || isCompletedNode(node) ? "result" : null,
    node.status === "active" || node.status === "in_progress" ? "activity" : null,
    "configuration",
  ].filter((tab): tab is NodeDetailPanelState["tabs"][number] => Boolean(tab));
  return candidates.find((tab) => tabs.includes(tab)) ?? tabs[0] ?? "result";
}

function drawerReasonLabel(node: PlanNodeDataModel, copy: TaskWorkspaceCopy) {
  if (hasResultSpec(node)) return copy.resultReady ?? "Result ready";
  if (node.status === "active" || node.status === "in_progress") return copy.running ?? "Running";
  return copy.node ?? "Node";
}

function ConfigurationTab({
  node,
  nodes,
}: {
  node: PlanNodeDataModel;
  nodes: PlanNodeDataModel[];
}) {
  return (
    <div className="rounded-[1rem] bg-transparent p-1">
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
  preferredTab,
  onPreferredTabApplied,
}: {
  detail: NodeDetailPanelState;
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  isActivityLoading?: boolean;
  selectedNodes: PlanNodeDataModel[];
  preferredTab?: NodeDetailPanelState["tabs"][number] | null;
  onPreferredTabApplied?: () => void;
}) {
  const currentNode = detail.currentNode;
  const copy = useTaskWorkspaceCopy();
  const tabLabels: Record<NodeDetailPanelState["tabs"][number], string> = {
    result: copy.tabResult ?? "Result",
    activity: copy.tabActivity ?? "Activity",
    configuration: copy.tabDetails ?? "Details",
  };
  const [activeTab, setActiveTab] = useState<
    NodeDetailPanelState["tabs"][number]
  >(() => defaultNodeDetailTab(currentNode, detail.tabs));
  const lastDefaultTabNodeIdRef = useRef(currentNode?.id ?? null);

  useEffect(() => {
    if (preferredTab && detail.tabs.includes(preferredTab)) {
      if (preferredTab !== activeTab) {
        setActiveTab(preferredTab);
      }
      onPreferredTabApplied?.();
      return;
    }

    const nodeId = currentNode?.id ?? null;
    const nextTab = lastDefaultTabNodeIdRef.current !== nodeId
      ? defaultNodeDetailTab(currentNode, detail.tabs)
      : detail.tabs.includes(activeTab)
        ? activeTab
        : defaultNodeDetailTab(currentNode, detail.tabs);

    lastDefaultTabNodeIdRef.current = nodeId;

    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeTab, currentNode, detail.tabs, onPreferredTabApplied, preferredTab]);

  if (!currentNode) return <EmptyDetailState />;

  const node = currentNode;
  const orderedTabs = TAB_ORDER.filter((tab) => detail.tabs.includes(tab));
  const drawerReason = drawerReasonLabel(node, copy);
  const tabs = (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as NodeDetailPanelState["tabs"][number])} className="min-h-0 flex-1 gap-0">
      <TabsList aria-label={copy.nodeDetailTabsAria ?? "Node detail tabs"} className="flex h-auto justify-start gap-1.5 rounded-none border-b border-border/70 bg-muted/35 px-3 py-2">
        {orderedTabs.map((tab) => (
          <TabsTrigger key={tab} value={tab} onClick={() => setActiveTab(tab)} className="flex-none rounded-full border border-border/60 bg-muted/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
            {tabLabels[tab]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="result" aria-label={`${tabLabels.result} tab`} className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-3">
        <ResultTab node={node} />
      </TabsContent>
      <TabsContent value="activity" aria-label={`${tabLabels.activity} tab`} className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-3">
        <WorkspaceActivityFeed
          activity={activity}
          runtimeEvents={runtimeEvents}
          title={taskWorkspaceActivityMessages.nodeTitle}
          emptyMessage={isActivityLoading ? (copy.loadingNodeActivity ?? "Loading node activity...") : taskWorkspaceActivityMessages.nodeEmpty}
        />
      </TabsContent>
      <TabsContent value="configuration" aria-label={`${tabLabels.configuration} tab`} className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-3">
        <ConfigurationTab node={node} nodes={selectedNodes} />
      </TabsContent>
    </Tabs>
  );

  return (
    <section
      id="task-workspace-node-actions"
      aria-label={copy.currentNodeDetails ?? "Current node details"}
      className="flex min-h-0 min-w-0 flex-1 scroll-mt-2 flex-col overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/90 shadow-lg backdrop-blur"
    >
      <div className={cn(
        "flex items-center justify-between gap-2 border-b px-2.5",
        "border-border/70 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--card)_92%,transparent),color-mix(in_oklab,var(--primary-soft)_60%,var(--card)))] py-1.5",
      )}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            {drawerReason}
          </p>
          <h2 aria-label={`Current node: ${detail.title}`} className="min-w-0 truncate text-sm font-semibold text-foreground">
            {detail.title}
          </h2>
          <Badge variant={statusTone(detail.status)}>
            {detail.status ?? "waiting"}
          </Badge>
          <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {copy.stepLabel ?? "Step"} {detail.stepPosition}
          </span>
        </div>
        <AutoRefreshIndicator enabled={detail.autoRefreshEnabled} />
      </div>

      {tabs}

    </section>
  );
}
