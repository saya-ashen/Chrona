import type { UiDocument } from "@chrona/ui-protocol";
import type { PlanExecutionResult } from "@chrona/contracts/ai";
import type { PlanNodeDataModel } from "../../../apps/web/src/components/tasks/plan/task-plan-graph/types";
import { Badge } from "../../../apps/web/src/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../apps/web/src/components/ui/card";
import type { WorkspaceActivityItem } from "../../task-workspace";
import type { WorkspaceRuntimeEvent } from "../model/workspace-runtime-events";
import type { createTaskWorkspaceExecutionConsoleView } from "../../task-workspace";
import { TaskWorkspaceActionRail } from "./action-rail";
import {
  TaskWorkspaceExecutionOverview,
  type CommandCenterCopy,
  type CommandCenterPrimaryAction,
} from "./task-workspace-execution-overview";

type ConsoleView = ReturnType<typeof createTaskWorkspaceExecutionConsoleView>;
type WorkspaceCopy = Record<string, string | undefined>;

function NodeDetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="text-xs text-foreground">{value}</dd>
    </div>
  );
}

function PlanNodeDetailCard({ node, copy }: { node: PlanNodeDataModel | null; copy: WorkspaceCopy }) {
  if (!node) return null;
  const dependencies = node.dependencies?.join(", ") ?? null;
  const requiredInfo = node.requiredInfo?.join(", ") ?? null;
  return (
    <Card size="sm" className="mb-2.5 gap-3 bg-background/80 py-3" role="region" aria-label={copy.nodeDetailOverlayAria ?? "Selected node details"}>
      <CardHeader className="gap-2 px-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{copy.nodeDetailOverlayTitle ?? "Node details"}</p>
            <CardTitle className="mt-1 truncate text-sm">{node.title}</CardTitle>
          </div>
          <Badge variant="outline">{node.statusLabel ?? node.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3">
        <NodeDetailRow label="Objective" value={node.objective} />
        <NodeDetailRow label="Summary" value={node.summary} />
        <NodeDetailRow label="Next action" value={node.nextAction} />
        <div className="grid gap-2 sm:grid-cols-2">
          <NodeDetailRow label="Mode" value={node.executionMode ?? node.interactionType ?? null} />
          <NodeDetailRow label="Executor" value={node.executor} />
          <NodeDetailRow label="Estimate" value={typeof node.estimatedMinutes === "number" ? `${node.estimatedMinutes} min` : null} />
          <NodeDetailRow label="Depends on" value={dependencies} />
        </div>
        <NodeDetailRow label="Required info" value={requiredInfo} />
      </CardContent>
    </Card>
  );
}

/** Right-rail inspector keeps task-level controls visible while showing selected plan node context. */
export function TaskWorkspaceInspector({
  taskId,
  consoleView,
  primaryAction,
  commandCenter,
  commandCenterActionHandlers,
  runtimeEvents,
  liveActivity,
  currentExecution,
  commandCenterCopy,
  copy,
  onAction,
  isPlanCompact = false,
  selectedNode,
}: {
  taskId: string;
  consoleView: ConsoleView;
  primaryAction: CommandCenterPrimaryAction;
  commandCenter: { documents: { now: UiDocument; output: UiDocument; trail: UiDocument } } | null;
  commandCenterActionHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>;
  runtimeEvents: WorkspaceRuntimeEvent[];
  liveActivity: WorkspaceActivityItem[];
  currentExecution?: PlanExecutionResult | null;
  commandCenterCopy?: Partial<CommandCenterCopy>;
  copy: WorkspaceCopy;
  isPlanCompact?: boolean;
  selectedNode?: PlanNodeDataModel | null;
  onAction: (nodeId?: string) => void;
}) {
  return (
    <aside
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/60"
      aria-label={copy.commandCenterAria ?? "Task command center"}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border/50 bg-muted/25 px-2.5 py-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            {copy.commandCenter ?? "Task Execution"}
          </p>
          {consoleView.progress.totalSteps > 0 ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {consoleView.progress.completedSteps}/{consoleView.progress.totalSteps} steps
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2.5">
        <PlanNodeDetailCard node={selectedNode ?? null} copy={copy} />
        <TaskWorkspaceActionRail
          taskId={taskId}
          serverNowSpec={commandCenter?.documents.now ?? null}
          primaryAction={primaryAction}
          readiness={consoleView.readiness}
          attention={consoleView.attention}
          runtimeEvents={runtimeEvents}
          commandCenterActionHandlers={commandCenterActionHandlers}
          copy={copy}
        />
        <TaskWorkspaceExecutionOverview
          taskId={taskId}
          progress={consoleView.progress}
          readiness={consoleView.readiness}
          latestResult={consoleView.latestResult}
          attention={consoleView.attention}
          latestCompletedNode={consoleView.latestCompletedNode}
          artifacts={consoleView.artifacts}
          activity={consoleView.activity}
          commandCenterActionHandlers={commandCenterActionHandlers}
          commandCenter={commandCenter}
          runtimeEvents={runtimeEvents}
          liveActivity={liveActivity}
          currentExecution={currentExecution}
          primaryAction={primaryAction}
          copy={commandCenterCopy}
          activityLayout={isPlanCompact ? "side" : "below"}
          onAction={onAction}
        />
      </div>
    </aside>
  );
}
