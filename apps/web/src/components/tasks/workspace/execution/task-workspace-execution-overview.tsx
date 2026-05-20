import { useState, type ReactNode } from "react";
import { Archive, Bell, CalendarClock, CheckCircle2, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { ExecutionOverviewCard, WorkspaceActivityItem, WorkspaceArtifactItem } from "../model/task-workspace-types";

type OverviewAction = (nodeId?: string) => void;
type CommandCenterTab = "actions" | "result" | "artifacts" | "activity";

export type CommandCenterPrimaryAction = {
  label: string;
  description: string;
  statusLabel?: string;
  tone?: ExecutionOverviewCard["tone"];
  disabled?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
  actionControls?: ReactNode;
  suppressAttentionCard?: boolean;
};

const COMMAND_CENTER_TABS: Array<{ id: CommandCenterTab; label: string }> = [
  { id: "actions", label: "操作" },
  { id: "result", label: "结果" },
  { id: "artifacts", label: "产物" },
  { id: "activity", label: "活动" },
];

export function TaskWorkspaceExecutionOverview({
  readiness,
  latestResult,
  attention,
  artifacts,
  activity,
  runtimeEvents = [],
  primaryAction,
  progressLabel = readiness.statusLabel ?? readiness.title,
  taskStatus = readiness.title,
  nextAction = latestResult.description,
  onAction,
}: {
  readiness: ExecutionOverviewCard;
  latestResult: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  primaryAction?: CommandCenterPrimaryAction | null;
  progressLabel?: string;
  taskStatus?: string;
  nextAction?: string;
  onAction?: OverviewAction;
}) {
  const [activeTab, setActiveTab] = useState<CommandCenterTab>("actions");
  const pendingAttention = attention ?? {
    id: "attention-empty",
    title: "Needs handling",
    description: "No approval, input, or blocker needs attention.",
    tone: "neutral" as const,
  };

  return (
    <aside aria-label="Execution overview" className="min-h-0 min-w-0">
      <div className="rounded-[1.15rem] border border-slate-200/80 bg-white/88 p-3 shadow-sm backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-slate-950 text-cyan-100 shadow-sm">
              <Sparkles className="size-3.5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Task</p>
              <h2 className="text-sm font-semibold text-slate-950">Command Center</h2>
            </div>
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CommandCenterTab)} className="gap-2">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-[0.9rem] border border-slate-200/80 bg-slate-100/70 p-1">
            {COMMAND_CENTER_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="rounded-[0.7rem] px-2 py-1.5 text-xs font-semibold data-active:bg-slate-950 data-active:text-white data-active:shadow-sm" onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="actions" className="space-y-2">
            <>
              {primaryAction ? <PrimaryActionCard action={primaryAction} /> : null}
              <TaskSummaryCard status={taskStatus} progressLabel={progressLabel} nextAction={nextAction} />
              {primaryAction?.suppressAttentionCard ? null : (
                <AttentionCard card={pendingAttention} readiness={readiness} onAction={onAction} />
              )}
            </>
          </TabsContent>
          <TabsContent value="result" className="space-y-2">
            <LatestResultCard card={latestResult} onAction={onAction} />
          </TabsContent>
          <TabsContent value="artifacts" className="space-y-2">
            <ArtifactsCard artifacts={artifacts} onAction={onAction} />
          </TabsContent>
          <TabsContent value="activity" className="space-y-2">
            <ActivityCard activity={activity} runtimeEvents={runtimeEvents} />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}

function PrimaryActionCard({ action }: { action: CommandCenterPrimaryAction }) {
  return (
    <section className={cn("rounded-[1rem] border p-3 shadow-sm", cardToneClass(action.tone ?? "info"))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Current operation</p>
          <p className="mt-0.5 break-words text-sm font-semibold text-slate-950">{action.label}</p>
        </div>
        {action.statusLabel ? <span className="shrink-0 rounded-full bg-white/85 px-2 py-0.5 text-xs font-medium text-slate-600">{action.statusLabel}</span> : null}
      </div>
      <p className="mt-2 break-words text-[13px] leading-[1.4] text-slate-800">{action.description}</p>
      {action.actionControls ? <div className="mt-3">{action.actionControls}</div> : null}
      {action.onClick ? (
        <Button
          type="button"
          size="sm"
          className="mt-3 h-8 rounded-full px-3 text-xs shadow-sm"
          disabled={action.disabled || action.isLoading}
          onClick={action.onClick}
        >
          {action.isLoading ? "Generating..." : action.label}
        </Button>
      ) : null}
    </section>
  );
}

function TaskSummaryCard({
  status,
  progressLabel,
  nextAction,
}: {
  status: string;
  progressLabel: string;
  nextAction: string;
}) {
  return (
    <section className="rounded-[1rem] border border-emerald-100 bg-emerald-50/70 p-3 shadow-sm ring-1 ring-emerald-100">
      <div className="flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">{status}</p>
          <p className="mt-0.5 text-xs font-medium text-emerald-700">{progressLabel}</p>
          <p className="mt-2 break-words rounded-xl bg-white/75 px-2.5 py-2 text-[13px] leading-[1.4] text-slate-700">
            {nextAction}
          </p>
        </div>
      </div>
    </section>
  );
}

function cardToneClass(tone: ExecutionOverviewCard["tone"]) {
  if (tone === "critical") return "border-red-200 bg-red-50/70 ring-1 ring-red-100";
  if (tone === "warning") return "border-orange-200 bg-orange-50/70 ring-1 ring-orange-100";
  if (tone === "success") return "border-emerald-100 bg-emerald-50/70 ring-1 ring-emerald-100";
  if (tone === "info") return "border-cyan-100 bg-cyan-50/60 ring-1 ring-cyan-100";
  return "border-slate-200 bg-white/85";
}

function LatestResultCard({ card, onAction }: { card: ExecutionOverviewCard; onAction?: OverviewAction }) {
  const resultText = card.content?.trim() || card.description;

  return (
    <section className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-slate-950 text-cyan-100">
            <Sparkles className="size-3.5" />
          </span>
          <p className="text-sm font-semibold text-slate-950">{card.title}</p>
        </div>
        {card.statusLabel ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{card.statusLabel}</span> : null}
      </div>
      <div className="mt-2 max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200/70 bg-slate-950/[0.035] px-2.5 py-2 text-[13px] leading-[1.45] text-slate-800">
        {resultText === "No execution result yet."
          ? "Result summary will appear here after the current node finishes."
          : resultText}
      </div>
      {card.actionLabel && onAction ? (
        <button type="button" className="mt-2 text-xs font-semibold text-cyan-700 hover:text-cyan-900" onClick={() => onAction(card.actionNodeId)}>
          Locate result node
        </button>
      ) : null}
    </section>
  );
}

function AttentionCard({ card, readiness, onAction }: { card: ExecutionOverviewCard; readiness: ExecutionOverviewCard; onAction?: OverviewAction }) {
  return (
    <section className={cn("rounded-[1rem] border p-3 shadow-sm", cardToneClass(card.tone))}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("flex size-7 items-center justify-center rounded-full", card.tone === "warning" ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700")}>
            <Bell className="size-3.5" />
          </span>
          <p className="text-sm font-semibold text-slate-950">{card.title}</p>
        </div>
        {card.statusLabel ? <span className="rounded-full bg-white/85 px-2 py-0.5 text-xs font-medium text-orange-700">{card.statusLabel}</span> : null}
      </div>
      <p className="mt-2 line-clamp-2 break-words text-[13px] leading-[1.4] text-slate-800">{card.description}</p>
      <p className="mt-1.5 break-words text-xs text-slate-500">Readiness: {readiness.description}</p>
      {card.actionLabel && onAction ? (
        <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="default" size="sm" className="h-8 rounded-full px-3 text-xs shadow-sm" onClick={() => onAction(card.actionNodeId)}>
            {card.actionLabel}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ArtifactsCard({ artifacts, onAction }: { artifacts: WorkspaceArtifactItem[]; onAction?: OverviewAction }) {
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(artifacts[0]?.id ?? null);

  return (
    <section className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Archive className="size-4 text-cyan-700" />
          <p className="text-sm font-semibold text-slate-950">Artifacts ({artifacts.length})</p>
        </div>
      </div>
      {artifacts.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-slate-500">No artifacts yet.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {artifacts.slice(0, 4).map((artifact) => (
            <div key={artifact.id} className="rounded-xl border border-slate-100 bg-slate-50/70 px-2 py-1.5">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left"
                onClick={() => setExpandedArtifactId((current) => current === artifact.id ? null : artifact.id)}
                aria-expanded={expandedArtifactId === artifact.id}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
                  <FileText className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium text-slate-900">{artifact.title}</span>
                  <span className="block break-words text-xs text-slate-500">{artifact.type}</span>
                </span>
              </button>
              {expandedArtifactId === artifact.id ? (
                <div className="mt-2 rounded-lg border border-slate-200/70 bg-white/85 p-2">
                  {artifact.content ? (
                    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{artifact.content}</pre>
                  ) : (
                    <p className="text-xs text-slate-500">No inline preview is available for this artifact.</p>
                  )}
                  {artifact.sourceNodeId && onAction ? (
                    <button type="button" className="mt-2 text-xs font-semibold text-cyan-700" onClick={() => onAction(artifact.sourceNodeId)}>
                      Locate source node
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function dotClassName(tone: WorkspaceActivityItem["tone"]) {
  if (tone === "success") return "bg-emerald-500";
  if (tone === "warning") return "bg-orange-500";
  if (tone === "critical") return "bg-red-500";
  if (tone === "info") return "bg-blue-500";
  return "bg-slate-300";
}

function runtimeEventTone(event: WorkspaceRuntimeEvent): WorkspaceActivityItem["tone"] {
  if (event.event.type === "tool_completed") return event.event.error ? "critical" : "success";
  if (event.event.type === "approval_required") return "warning";
  if (event.event.type === "run_status") {
    if (event.event.status === "completed") return "success";
    if (event.event.status === "failed") return "critical";
    if (event.event.status === "cancelled") return "warning";
  }
  return event.event.type === "reasoning_delta" || event.event.type === "raw_event" ? "neutral" : "info";
}

function runtimeEventTitle(event: WorkspaceRuntimeEvent) {
  switch (event.event.type) {
    case "assistant_text_delta":
      return "Assistant response";
    case "reasoning_delta":
      return "Reasoning";
    case "tool_started":
      return "Tool started";
    case "tool_completed":
      return event.event.error ? "Tool failed" : "Tool completed";
    case "approval_required":
      return "Approval required";
    case "run_status":
      return "Provider run status";
    case "raw_event":
      return "Provider event";
  }
}

function runtimeEventDescription(event: WorkspaceRuntimeEvent) {
  switch (event.event.type) {
    case "assistant_text_delta":
    case "reasoning_delta":
      return event.event.text.trim() || event.provider;
    case "tool_started":
      return event.event.preview ? `${event.event.label}: ${String(event.event.preview)}` : event.event.label;
    case "tool_completed":
      return event.event.error?.message ?? event.event.label;
    case "approval_required":
      return event.nodeTitle ?? event.provider;
    case "run_status":
      return event.event.message ?? event.event.status;
    case "raw_event":
      return event.rawEventType ?? event.event.rawEventType ?? "Raw provider event";
  }
}

function runtimeEventToActivityItem(event: WorkspaceRuntimeEvent, index: number): WorkspaceActivityItem {
  return {
    id: `live-${event.runId ?? event.nativeRunId ?? event.nodeId ?? "runtime"}-${event.sequence ?? index}-${event.event.type}`,
    title: runtimeEventTitle(event),
    description: runtimeEventDescription(event),
    tone: runtimeEventTone(event),
    timestamp: event.timestamp ?? null,
  };
}

export function ActivityCard({ activity, runtimeEvents = [] }: { activity: WorkspaceActivityItem[]; runtimeEvents?: WorkspaceRuntimeEvent[] }) {
  const liveActivity = runtimeEvents.slice(-20).reverse().map(runtimeEventToActivityItem);
  const items = [...liveActivity, ...activity].slice(0, 30);

  return (
    <section className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-cyan-700" />
          <p className="text-sm font-semibold text-slate-950">Execution activity</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-slate-500">Activity will appear after planning or execution starts.</p>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          {items.map((item) => (
            <div key={item.id} className="flex gap-2">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotClassName(item.tone))} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {item.timestamp ? <span className="text-xs text-slate-500">{item.timestamp.slice(11, 16)}</span> : null}
                  <p className="break-words text-sm font-medium text-slate-900">{item.title}</p>
                </div>
                <p className="mt-0.5 line-clamp-2 break-words text-xs leading-[1.35] text-slate-500">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
