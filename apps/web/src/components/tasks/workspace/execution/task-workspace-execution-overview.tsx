import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { createStateStore } from "@json-render/react";
import { buildResultSpec, type UiDocument } from "@chrona/ui-protocol";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import { taskWorkspaceActivityMessages } from "@/lib/i18n/messages";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type {
  ExecutionOverviewCard,
  ProgressSummary,
  WorkspaceActivityItem,
  WorkspaceArtifactItem,
} from "../model/task-workspace-types";
import { SpecRenderer } from "../catalog/spec-renderer";
import { buildCommandCenterOutputTabSpec, buildCommandCenterTrailTabSpec } from "./build-execution-overview-spec";
import { mergeWorkspaceActivity, runtimeEventsToWorkspaceActivity } from "../model/task-workspace-activity";

type OverviewAction = (nodeId?: string) => void;
type CommandCenterTab = "output" | "trail";

export type CommandCenterPrimaryAction = {
  kind?: string;
  label: string;
  description: string;
  statusLabel?: string;
  tone?: ExecutionOverviewCard["tone"];
  disabled?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
  actionSpec?: UiDocument | null;
  actionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
  onActionStateChange?: (changes: Array<{ path: string; value: unknown }>) => void;
  suppressAttentionCard?: boolean;
};

export type CommandCenterCopy = {
  nowTab: string;
  outputTab: string;
  trailTab: string;
};

const DEFAULT_COMMAND_CENTER_COPY: CommandCenterCopy = {
  nowTab: "Now",
  outputTab: "Results",
  trailTab: "Activity",
};

const TRAIL_ACTIVITY_LIMIT = 100;

function commandCenterTrailItems(commandCenter?: { documents: { trail: UiDocument } } | null) {
  const items = commandCenter?.documents.trail.state?.trail;
  if (!items || typeof items !== "object" || Array.isArray(items)) return [];
  const trailItems = (items as { items?: unknown }).items;
  return Array.isArray(trailItems) ? trailItems as WorkspaceActivityItem[] : [];
}

function buildNodeResultContentSpec(_node: PlanNodeDataModel | null, emptyMessage: string) {
  return buildResultSpec([], { emptyMessage });
}

export function TaskWorkspaceExecutionOverview({
  progress,
  readiness,
  attention,
  latestCompletedNode,
  artifacts,
  activity,
  runtimeEvents = [],
  liveActivity = [],
  primaryAction,
  copy: copyProp,
  commandCenter,
  onAction,
}: {
  taskId: string;
  progress: ProgressSummary;
  readiness: ExecutionOverviewCard;
  /** Retained for callers; the Now tab derives its status card from readiness/attention. */
  latestResult?: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  latestCompletedNode: PlanNodeDataModel | null;
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  liveActivity?: WorkspaceActivityItem[];
  primaryAction?: CommandCenterPrimaryAction | null;
  copy?: Partial<CommandCenterCopy>;
  onAction?: OverviewAction;
  commandCenter?: {
    documents: {
      now: UiDocument;
      output: UiDocument;
      trail: UiDocument;
    };
  } | null;
  commandCenterActionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
}) {
  const [activeTab, setActiveTab] = useState<CommandCenterTab>("output");
  const { messages } = useI18n();
  const ws = messages.components?.taskWorkspace ?? {};
  const copy = { ...DEFAULT_COMMAND_CENTER_COPY, ...copyProp };

  const tabs: Array<{ id: CommandCenterTab; label: string; badge?: boolean }> = [
    { id: "output", label: copy.outputTab },
    { id: "trail", label: copy.trailTab },
  ];

  const trailStore = useMemo(
    () => commandCenter?.documents.trail ? createStateStore(commandCenter.documents.trail.state ?? {}) : null,
    [commandCenter?.documents.trail],
  );
  const savedTrailActivity = useMemo(
    () => commandCenter?.documents.trail ? commandCenterTrailItems(commandCenter) : activity,
    [activity, commandCenter],
  );
  useEffect(() => {
    if (!trailStore) return;
    const limit = TRAIL_ACTIVITY_LIMIT;
    const liveRuntimeActivity = runtimeEventsToWorkspaceActivity(runtimeEvents, limit);
    const items = mergeWorkspaceActivity([...liveActivity, ...liveRuntimeActivity, ...savedTrailActivity], limit);
    trailStore.set("/trail/items", items);
    trailStore.set("/trail/liveCount", liveActivity.length + runtimeEvents.length);
    trailStore.set("/trail/savedCount", savedTrailActivity.length);
    trailStore.set("/trail/provider", runtimeEvents.at(-1)?.provider ?? null);
  }, [liveActivity, runtimeEvents, savedTrailActivity, trailStore]);
  const statusLabel = primaryAction?.statusLabel
    ?? attention?.statusLabel
    ?? readiness.statusLabel
    ?? null;

  const locateHandlers = {
    "locate-workspace-node": (params: Record<string, unknown>) => {
      const nodeId = typeof params.nodeId === "string" ? params.nodeId : undefined;
      if (nodeId) onAction?.(nodeId);
    },
  };
  const resultSpec = buildNodeResultContentSpec(latestCompletedNode, ws.noResultYet ?? "No output yet.");

  return (
    <aside
      aria-label={ws.executionOverviewAria ?? "Execution overview"}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.15rem] border border-border/65 bg-card/95 p-3.5 shadow-[0_10px_35px_rgba(15,23,42,0.07)]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-4 ring-primary/10">
              <Sparkles className="size-4" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                {ws.taskEyebrow ?? "Task"}
              </p>
              <h2 className="font-heading text-base font-semibold leading-tight text-foreground">
                {ws.commandCenter ?? "Execution"}
              </h2>
            </div>
          </div>
        </div>


        <div className="mb-3 shrink-0 space-y-1.5 rounded-xl border border-border/60 bg-muted/35 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            {statusLabel ? (
              <span className="truncate text-xs font-medium text-muted-foreground">{statusLabel}</span>
            ) : <span />}
            {progress.totalSteps > 0 ? (
              <span className="shrink-0 text-xs font-semibold text-foreground">
                {progress.completedSteps}/{progress.totalSteps}
              </span>
            ) : null}
          </div>
          {progress.totalSteps > 0 ? (
            <div className="h-2 w-full overflow-hidden rounded-full bg-background shadow-inner">
              <div
                className="h-full rounded-full bg-primary shadow-[0_0_18px_color-mix(in_oklab,var(--primary)_55%,transparent)] transition-[width]"
                style={{ width: `${progress.percentComplete}%` }}
              />
            </div>
          ) : null}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as CommandCenterTab)}
          className="min-h-0 flex-1 gap-3 overflow-hidden"
        >
          <TabsList className="inline-flex h-auto w-fit max-w-full shrink-0 gap-1 rounded-2xl border border-border/60 bg-muted/45 p-1 shadow-[inset_0_1px_0_hsl(var(--background)/0.75),0_1px_2px_hsl(var(--foreground)/0.06)]">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="min-h-8 min-w-[6.75rem] flex-none rounded-xl border border-transparent px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-[background-color,border-color,box-shadow,color] hover:bg-background/55 hover:text-foreground data-[state=active]:border-border/70 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_3px_hsl(var(--foreground)/0.10),inset_0_1px_0_hsl(var(--background)/0.90)]"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="output" className="min-h-0 space-y-2.5 overflow-y-auto pr-1.5">
            <SpecRenderer
              spec={buildCommandCenterOutputTabSpec({ latestCompletedNode, resultSpec, artifacts, copy: ws, apiArtifactsSpec: commandCenter?.documents.output ?? null })}
              handlers={locateHandlers}
            />
          </TabsContent>

          <TabsContent value="trail" className="min-h-0 space-y-2.5 overflow-y-auto pr-1.5">
            <SpecRenderer
              spec={commandCenter?.documents.trail ?? buildCommandCenterTrailTabSpec({
                activity,
                runtimeEvents,
                copy: {
                  ...ws,
                  activityTitle: taskWorkspaceActivityMessages.taskTitle,
                  activityEmpty: taskWorkspaceActivityMessages.taskEmpty,
                },
                toolLabels: taskWorkspaceActivityMessages.toolLabels,
              })}
              store={trailStore ?? undefined}
            />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
