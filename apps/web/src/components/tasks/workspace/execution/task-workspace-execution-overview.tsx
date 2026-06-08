import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { buildResultSpec, validateChronaSpec, type UiDocument } from "@chrona/ui-protocol";
import type { PlanNodeDataModel } from "@/components/tasks/plan/task-plan-graph/types";
import { cn } from "@/lib/utils";
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
import { buildCommandCenterNowTabSpec, buildCommandCenterOutputTabSpec, buildCommandCenterTrailTabSpec } from "./build-execution-overview-spec";

type OverviewAction = (nodeId?: string) => void;
type CommandCenterTab = "now" | "output" | "trail";

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
  outputTab: "Output",
  trailTab: "Trail",
};

function isActionablePrimary(primaryAction?: CommandCenterPrimaryAction | null) {
  const kind = primaryAction?.kind;
  return (
    kind === "current-operation" ||
    kind === "start-plan" ||
    kind === "accept-or-regenerate" ||
    kind === "generate"
  );
}

function buildNodeResultContentSpec(node: PlanNodeDataModel | null, emptyMessage: string) {
  const specOutput = node?.resultOutputs?.[0] ?? null;
  if (specOutput) {
    const result = validateChronaSpec(specOutput);
    if (!result.ok) {
      const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      return buildResultSpec([], {
        errorMessage: `Unable to render this node's result (${detail}).`,
      });
    }
    return specOutput;
  }
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
  primaryAction,
  copy: copyProp,
  commandCenterUi,
  onAction,
}: {
  progress: ProgressSummary;
  readiness: ExecutionOverviewCard;
  /** Retained for callers; the Now tab derives its status card from readiness/attention. */
  latestResult?: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  latestCompletedNode: PlanNodeDataModel | null;
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  primaryAction?: CommandCenterPrimaryAction | null;
  copy?: Partial<CommandCenterCopy>;
  onAction?: OverviewAction;
  commandCenterUi?: {
    artifactsSpec?: UiDocument | null;
    trailSpec?: UiDocument | null;
  } | null;
}) {
  const [activeTab, setActiveTab] = useState<CommandCenterTab>("now");
  const { messages } = useI18n();
  const ws = messages.components?.taskWorkspace ?? {};
  const copy = { ...DEFAULT_COMMAND_CENTER_COPY, ...copyProp };
  const hasAttention = attention !== null;
  const needsNow = hasAttention || primaryAction?.kind === "current-operation";
  const showNowBadge = needsNow || isActionablePrimary(primaryAction);

  const prevNeedsNowRef = useRef(needsNow);
  useEffect(() => {
    if (needsNow && !prevNeedsNowRef.current) {
      setActiveTab("now");
    }
    prevNeedsNowRef.current = needsNow;
  }, [needsNow]);

  const tabs: Array<{ id: CommandCenterTab; label: string; badge?: boolean }> = [
    { id: "now", label: copy.nowTab, badge: showNowBadge },
    { id: "output", label: copy.outputTab },
    { id: "trail", label: copy.trailTab },
  ];

  const statusLabel = primaryAction?.statusLabel
    ?? attention?.statusLabel
    ?? readiness.statusLabel
    ?? null;

  const nowHandlers = {
    ...(primaryAction?.actionHandlers ?? {}),
    "command-center-primary": (params: Record<string, unknown>) => {
      const actionId = typeof params.actionId === "string" ? params.actionId : null;
      if (actionId === (primaryAction?.kind ?? primaryAction?.label)) primaryAction?.onClick?.();
    },
  };
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
                {ws.commandCenter ?? "Command Center"}
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
          <TabsList className="grid h-auto w-full shrink-0 grid-cols-3 gap-1 rounded-[1rem] border border-border/60 bg-muted/70 p-1 shadow-inner">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative rounded-[0.78rem] px-2.5 py-2 text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                {tab.label}
                {tab.badge ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute right-1 top-1 size-1.5 rounded-full",
                      attention ? "bg-warning" : "bg-primary",
                    )}
                  />
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="now" className="min-h-0 space-y-2.5 overflow-y-auto pr-1.5">
            <SpecRenderer
              key={primaryAction?.kind ?? "now"}
              spec={buildCommandCenterNowTabSpec({ primaryAction, readiness, attention, runtimeEvents, copy: ws })}
              handlers={nowHandlers}
              onStateChange={primaryAction?.onActionStateChange}
            />
          </TabsContent>

          <TabsContent value="output" className="min-h-0 space-y-2.5 overflow-y-auto pr-1.5">
            <SpecRenderer
              spec={buildCommandCenterOutputTabSpec({ latestCompletedNode, resultSpec, artifacts, copy: ws, apiArtifactsSpec: commandCenterUi?.artifactsSpec ?? null })}
              handlers={locateHandlers}
            />
          </TabsContent>

          <TabsContent value="trail" className="min-h-0 space-y-2.5 overflow-y-auto pr-1.5">
            <SpecRenderer
              spec={commandCenterUi?.trailSpec ?? buildCommandCenterTrailTabSpec({
                activity,
                runtimeEvents,
                copy: {
                  ...ws,
                  activityTitle: taskWorkspaceActivityMessages.taskTitle,
                  activityEmpty: taskWorkspaceActivityMessages.taskEmpty,
                },
                toolLabels: taskWorkspaceActivityMessages.toolLabels,
              })}
            />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
