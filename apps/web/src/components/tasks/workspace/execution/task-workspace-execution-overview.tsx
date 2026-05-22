import { useState, type ReactNode } from "react";
import { Archive, CalendarClock, FileText, Sparkles } from "lucide-react";
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

export type CommandCenterCopy = {
  actionsTab: string;
  resultTab: string;
  artifactsTab: string;
  activityTab: string;
};

const DEFAULT_COMMAND_CENTER_COPY: CommandCenterCopy = {
  actionsTab: "Actions",
  resultTab: "Result",
  artifactsTab: "Artifacts",
  activityTab: "Activity",
};

export function TaskWorkspaceExecutionOverview({
  latestResult,
  artifacts,
  activity,
  runtimeEvents = [],
  primaryAction,
  copy: copyProp,
  onAction,
}: {
  readiness: ExecutionOverviewCard;
  latestResult: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  primaryAction?: CommandCenterPrimaryAction | null;
  copy?: Partial<CommandCenterCopy>;
  progressLabel?: string;
  taskStatus?: string;
  nextAction?: string;
  onAction?: OverviewAction;
}) {
  const [activeTab, setActiveTab] = useState<CommandCenterTab>("actions");
  const copy = { ...DEFAULT_COMMAND_CENTER_COPY, ...copyProp };
  const tabs: Array<{ id: CommandCenterTab; label: string }> = [
    { id: "actions", label: copy.actionsTab },
    { id: "result", label: copy.resultTab },
    { id: "artifacts", label: copy.artifactsTab },
    { id: "activity", label: copy.activityTab },
  ];

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
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="rounded-[0.7rem] px-2 py-1.5 text-xs font-semibold data-active:bg-slate-950 data-active:text-white data-active:shadow-sm" onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="actions" className="space-y-2">
            <>
              {primaryAction ? <PrimaryActionCard action={primaryAction} /> : null}
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

type RuntimeActivityFeedItem =
  | {
      kind: "text";
      id: string;
      type: "assistant_text_delta" | "reasoning_delta";
      provider: string;
      text: string;
    }
  | {
      kind: "event";
      id: string;
      event: WorkspaceRuntimeEvent;
    };

function runtimeTextScopeKey(event: WorkspaceRuntimeEvent) {
  return [
    event.event.type,
    event.action,
    event.runId ?? "run",
    event.nodeId ?? "node",
    event.runtimeName,
    event.provider,
  ].join(":");
}

function buildRuntimeActivityFeed(runtimeEvents: WorkspaceRuntimeEvent[]) {
  const feed: RuntimeActivityFeedItem[] = [];
  let currentTextSegment: { key: string; item: Extract<RuntimeActivityFeedItem, { kind: "text" }> } | null = null;

  runtimeEvents.forEach((event, index) => {
    if (event.event.type !== "assistant_text_delta" && event.event.type !== "reasoning_delta") {
      currentTextSegment = null;
      feed.push({
        kind: "event",
        id: `${event.sequence ?? index}:${event.event.type}:${event.rawEventType ?? "event"}`,
        event,
      });
      return;
    }

    const key = runtimeTextScopeKey(event);
    if (currentTextSegment !== null && currentTextSegment.key === key) {
      currentTextSegment.item.text += event.event.text;
      return;
    }

    const item = {
      kind: "text" as const,
      id: `${event.sequence ?? index}:${event.event.type}:${event.runId ?? "run"}`,
      type: event.event.type,
      provider: event.provider,
      text: event.event.text,
    };
    feed.push(item);
    currentTextSegment = { key, item };
  });

  return feed.filter((item) => item.kind === "event" || item.text.trim()).slice(-12).reverse();
}

export function ActivityCard({ activity, runtimeEvents = [] }: { activity: WorkspaceActivityItem[]; runtimeEvents?: WorkspaceRuntimeEvent[] }) {
  const runtimeFeedItems = buildRuntimeActivityFeed(runtimeEvents);
  const items = activity.slice(0, 30);
  const hasRuntimeActivity = runtimeFeedItems.length > 0;

  return (
    <section className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-cyan-700" />
          <p className="text-sm font-semibold text-slate-950">Execution activity</p>
        </div>
        {runtimeEvents.length > 0 ? (
          <span className="rounded-full border border-cyan-200/70 bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-800">
            {runtimeEvents.at(-1)?.provider ?? "runtime"}
          </span>
        ) : null}
      </div>
      {runtimeFeedItems.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {runtimeFeedItems.map((item) => (
            item.kind === "text"
              ? <RuntimeTextActivityRow key={item.id} item={item} />
              : <RuntimeActivityRow key={item.id} event={item.event} />
          ))}
        </div>
      ) : null}
      {items.length === 0 ? (
        hasRuntimeActivity ? null : (
          <p className="mt-1.5 text-[13px] text-slate-500">Activity will appear after planning or execution starts.</p>
        )
      ) : (
        <div className={cn("space-y-1.5", hasRuntimeActivity ? "mt-3 border-t border-slate-200/70 pt-2" : "mt-1.5")}>
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

function RuntimeTextActivityRow({ item }: { item: Extract<RuntimeActivityFeedItem, { kind: "text" }> }) {
  if (item.type === "reasoning_delta") {
    return (
      <details className="rounded-xl border border-slate-200/80 bg-white/70 px-2.5 py-2 text-xs text-slate-500 shadow-sm">
        <summary className="cursor-pointer font-medium text-slate-800">Reasoning</summary>
        <p className="mt-1 whitespace-pre-wrap leading-5">{item.text.trim()}</p>
      </details>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/85 px-2.5 py-2 text-sm leading-5 text-slate-800 shadow-inner">
      <p className="mb-1 text-xs font-medium text-slate-500">Assistant response</p>
      <p className="whitespace-pre-wrap">{item.text.trim()}</p>
    </div>
  );
}

function RuntimeActivityRow({ event }: { event: WorkspaceRuntimeEvent }) {
  const value = event.event;
  if (value.type === "tool_started") {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs shadow-sm">
        <span className="font-medium text-slate-900">{value.label}</span>
        {typeof value.preview === "string" && value.preview ? <span className="ml-1 text-slate-500">{value.preview}</span> : null}
      </div>
    );
  }
  if (value.type === "tool_completed") {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs shadow-sm">
        <span className={value.error ? "font-medium text-red-700" : "font-medium text-emerald-700"}>
          {value.error ? `${value.label} failed` : `${value.label} completed`}
        </span>
        {value.durationMs !== undefined ? <span className="ml-1 text-slate-500">{Math.round(value.durationMs)}ms</span> : null}
        {value.error ? <span className="ml-1 text-red-700">{value.error.message}</span> : null}
      </div>
    );
  }
  if (value.type === "approval_required") {
    return <div className="rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 shadow-sm">Approval required</div>;
  }
  if (value.type === "run_status") {
    return <div className="rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-500 shadow-sm">{value.message ?? value.status}</div>;
  }
  return <div className="rounded-xl border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-500 shadow-sm">{value.type === "raw_event" ? value.rawEventType ?? "Raw provider event" : value.type}</div>;
}
