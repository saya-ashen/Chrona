import { useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { taskWorkspaceActivityMessages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { mergeWorkspaceActivity, runtimeEventsToWorkspaceActivity } from "../model/task-workspace-activity";
import type { WorkspaceRuntimeEvent } from "../hooks/use-task-workspace-plan-state";
import type { WorkspaceActivityItem } from "../model/task-workspace-types";

function dotClassName(tone: WorkspaceActivityItem["tone"]) {
  if (tone === "success") return "bg-emerald-500";
  if (tone === "warning") return "bg-orange-500";
  if (tone === "danger") return "bg-red-500";
  if (tone === "info") return "bg-blue-500";
  return "bg-slate-300";
}

function toneBadgeVariant(tone: WorkspaceActivityItem["tone"]) {
  if (tone === "danger") return "destructive" as const;
  if (tone === "success" || tone === "info") return "secondary" as const;
  return "outline" as const;
}

function timeLabel(timestamp: string | null | undefined) {
  return timestamp ? timestamp.slice(11, 16) : null;
}

function ToolDetails({ item }: { item: WorkspaceActivityItem }) {
  const [expanded, setExpanded] = useState(false);
  const tool = item.tool;
  if (!tool) return null;

  const detailRows = [
    [taskWorkspaceActivityMessages.toolLabels.tool, tool.label ?? tool.name],
    [taskWorkspaceActivityMessages.toolLabels.input, tool.inputSummary],
    [taskWorkspaceActivityMessages.toolLabels.preview, tool.preview],
    [taskWorkspaceActivityMessages.toolLabels.duration, tool.durationMs !== undefined ? `${Math.round(tool.durationMs)}ms` : undefined],
    [taskWorkspaceActivityMessages.toolLabels.error, tool.error],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (detailRows.length === 0) return null;

  return (
    <div className="mt-1.5 rounded-xl border border-slate-200/80 bg-white/75 p-2">
      <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-2 text-xs" onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {expanded ? taskWorkspaceActivityMessages.hideToolDetails : taskWorkspaceActivityMessages.showToolDetails}
      </Button>
      {expanded ? (
        <dl className="mt-2 space-y-1.5 text-xs">
          {detailRows.map(([label, value]) => (
            <div key={label} className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)]">
              <dt className="font-semibold text-slate-500">{label}</dt>
              <dd className="whitespace-pre-wrap break-words text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function ActivityRow({ item }: { item: WorkspaceActivityItem }) {
  const label = timeLabel(item.timestamp);
  const isReasoning = item.kind === "reasoning";
  const text = item.assistant?.text ?? item.summary;

  return (
    <div className="flex gap-2 rounded-xl border border-transparent px-1.5 py-1.5 hover:border-slate-200/70 hover:bg-slate-50/80">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dotClassName(item.tone))} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {label ? <span className="text-xs text-slate-500">{label}</span> : null}
          <p className="break-words text-sm font-medium text-slate-900">{item.title}</p>
          {item.sourceNodeTitle ? <Badge variant="outline" className="max-w-full truncate text-[10px]">{item.sourceNodeTitle}</Badge> : null}
          {item.tool ? <Badge variant={toneBadgeVariant(item.tone)} className="gap-1 text-[10px]"><Wrench className="size-3" />{item.tool.state}</Badge> : null}
        </div>
        {isReasoning ? (
          <details className="mt-1 rounded-lg border border-slate-200/70 bg-white/70 px-2 py-1.5 text-xs text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-800">{taskWorkspaceActivityMessages.reasoningDetails}</summary>
            <p className="mt-1 whitespace-pre-wrap break-words leading-5">{text}</p>
          </details>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-[1.35] text-slate-500">{text}</p>
        )}
        <ToolDetails item={item} />
      </div>
    </div>
  );
}

export function WorkspaceActivityFeed({
  activity,
  runtimeEvents = [],
  title = taskWorkspaceActivityMessages.taskTitle,
  emptyMessage = taskWorkspaceActivityMessages.taskEmpty,
  limit = 30,
  hasOlderActivity = false,
  isLoadingOlder = false,
  onLoadOlder,
}: {
  activity: WorkspaceActivityItem[];
  runtimeEvents?: WorkspaceRuntimeEvent[];
  title?: string;
  emptyMessage?: string;
  limit?: number;
  hasOlderActivity?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => void;
}) {
  const items = mergeWorkspaceActivity([...runtimeEventsToWorkspaceActivity(runtimeEvents, limit), ...activity], limit);

  return (
    <section className="rounded-[1rem] border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-cyan-700" />
          <p className="text-sm font-semibold text-slate-950">{title}</p>
        </div>
        {runtimeEvents.length > 0 ? (
          <span className="rounded-full border border-cyan-200/70 bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-800">
            {runtimeEvents.at(-1)?.provider ?? "runtime"}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="mt-2 space-y-1">
          {items.map((item) => <ActivityRow key={item.id} item={item} />)}
        </div>
      )}
      {hasOlderActivity && onLoadOlder ? (
        <Button type="button" variant="outline" size="sm" className="mt-3 w-full rounded-full text-xs" disabled={isLoadingOlder} onClick={onLoadOlder}>
          {isLoadingOlder ? taskWorkspaceActivityMessages.loadingOlder : taskWorkspaceActivityMessages.loadOlder}
        </Button>
      ) : null}
    </section>
  );
}
