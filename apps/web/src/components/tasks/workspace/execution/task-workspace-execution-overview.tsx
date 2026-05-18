import { useState } from "react";
import { Archive, Bell, CalendarClock, CheckCircle2, FileText, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ExecutionOverviewCard, WorkspaceActivityItem, WorkspaceArtifactItem } from "../model/task-workspace-types";

type OverviewAction = (nodeId?: string) => void;
type CommandCenterTab = "actions" | "result" | "artifacts" | "activity";

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
    tone: "success" as const,
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
        <div className="mb-2 grid grid-cols-4 gap-1 rounded-[0.9rem] border border-slate-200/80 bg-slate-100/70 p-1">
          {COMMAND_CENTER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={cn(
                "rounded-[0.7rem] px-2 py-1.5 text-xs font-semibold transition-colors",
                activeTab === tab.id
                  ? "bg-slate-950 text-white shadow-sm"
                  : "text-slate-600 hover:bg-white/75 hover:text-slate-950",
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="space-y-2" role="tabpanel">
          {activeTab === "actions" ? (
            <>
              <TaskSummaryCard status={taskStatus} progressLabel={progressLabel} nextAction={nextAction} />
              <AttentionCard card={pendingAttention} readiness={readiness} onAction={onAction} />
            </>
          ) : null}
          {activeTab === "result" ? <LatestResultCard card={latestResult} onAction={onAction} /> : null}
          {activeTab === "artifacts" ? <ArtifactsCard artifacts={artifacts} onAction={onAction} /> : null}
          {activeTab === "activity" ? <ActivityCard activity={activity} /> : null}
        </div>
      </div>
    </aside>
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
      <div className="mt-2 line-clamp-3 break-words rounded-xl border border-slate-200/70 bg-slate-950/[0.035] px-2.5 py-2 text-[13px] leading-[1.4] text-slate-700">
        {card.description === "No execution result yet."
          ? "Result summary will appear here after the current node finishes."
          : card.description}
      </div>
      {card.actionLabel && onAction ? (
        <button type="button" className="mt-2 text-xs font-semibold text-cyan-700 hover:text-cyan-900" onClick={() => onAction(card.actionNodeId)}>
          View full result -&gt;
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
            <button type="button" className={buttonVariants({ variant: "default", size: "sm", className: "h-8 rounded-full px-3 text-xs shadow-sm" })} onClick={() => onAction(card.actionNodeId)}>
            {card.actionLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ArtifactsCard({ artifacts, onAction }: { artifacts: WorkspaceArtifactItem[]; onAction?: OverviewAction }) {
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
        <div className="mt-2 space-y-1">
          {artifacts.slice(0, 4).map((artifact) => (
            <div key={artifact.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-2 py-1.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
                <FileText className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-slate-900">{artifact.title}</p>
                <p className="break-words text-xs text-slate-500">{artifact.type}</p>
              </div>
              {artifact.sourceNodeId && onAction ? (
                <button type="button" className="text-xs font-semibold text-cyan-700" onClick={() => onAction(artifact.sourceNodeId)}>
                  Source
                </button>
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

export function ActivityCard({ activity }: { activity: WorkspaceActivityItem[] }) {
  return (
    <section className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-cyan-700" />
          <p className="text-sm font-semibold text-slate-950">Execution activity</p>
        </div>
      </div>
      {activity.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-slate-500">Activity will appear after planning or execution starts.</p>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          {activity.slice(0, 5).map((item) => (
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
