"use client";

import { useState } from "react";
import {
  ExternalLink,
} from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/pages";

type TaskItem = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  updatedAt: string;
  projection: {
    runStatus: string | null;
    isRunnable: boolean;
  } | null;
};

type Props = {
  tasks: TaskItem[];
  workspaceId: string;
  copy: Dictionary;
};

const FILTERS = [
  { key: "all" },
  { key: "needs_me" },
  { key: "ready" },
  { key: "running" },
  { key: "completed" },
  { key: "failed" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];
type TaskListCopy = Dictionary["pages"]["tasks"];

function matchesFilter(task: TaskItem, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_me":
      return ["WaitingForInput", "WaitingForApproval", "Blocked"].includes(task.status);
    case "ready":
      return ["Ready", "Queued", "Draft"].includes(task.status) && Boolean(task.projection?.isRunnable);
    case "running":
      return task.status === "Running";
    case "completed":
      return ["Completed", "Done"].includes(task.status);
    case "failed":
      return task.status === "Failed";
  }
}

function statusTone(status: string) {
  if (["Completed", "Done"].includes(status)) return "secondary" as const;
  if (["Running", "Ready", "Queued"].includes(status)) return "secondary" as const;
  if (["WaitingForInput", "WaitingForApproval"].includes(status)) return "secondary" as const;
  if (["Failed", "Blocked"].includes(status)) return "destructive" as const;
  return "outline" as const;
}

function priorityTone(priority: string) {
  if (priority === "Urgent") return "destructive" as const;
  if (priority === "High") return "secondary" as const;
  return "outline" as const;
}

function taskAccentClass(task: TaskItem): string {
  if (["Failed", "Blocked"].includes(task.status)) return "from-red-500 to-orange-400";
  if (["WaitingForInput", "WaitingForApproval"].includes(task.status)) return "from-amber-400 to-yellow-300";
  if (task.status === "Running") return "from-blue-500 to-cyan-400";
  if (["Completed", "Done"].includes(task.status)) return "from-emerald-500 to-teal-400";
  return "from-primary to-violet-400";
}

function formatRelativeTime(dateStr: string, copy: TaskListCopy): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return copy.relativeJustNow;
  if (diffMins < 60) return copy.relativeMinutesAgo.replace("{count}", String(diffMins));
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return copy.relativeHoursAgo.replace("{count}", String(diffHrs));
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return copy.relativeDaysAgo.replace("{count}", String(diffDays));
  return date.toLocaleDateString();
}

type TaskCounts = {
  all: number;
  needsMe: number;
  ready: number;
  running: number;
  completed: number;
  failed: number;
};

function filterLabel(filter: FilterKey, copy: TaskListCopy): string {
  if (filter === "needs_me") return copy.filterNeedsMe;
  return copy[filter];
}

function TaskListHero({ title, copy, activeFilterLabel, counts }: { title: string; copy: TaskListCopy; activeFilterLabel: string; counts: TaskCounts }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-0.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <span className="rounded-full border border-primary/15 bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
            {activeFilterLabel}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{copy.listDescription}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <TaskStat label={copy.statTotal} value={counts.all} />
        <TaskStat label={copy.statNeeds} value={counts.needsMe} className="text-amber-600" />
        <TaskStat label={copy.statReady} value={counts.ready} className="text-cyan-600" />
      </div>
    </div>
  );
}

function TaskStat({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <span className="rounded-full border border-white/70 bg-white/75 px-2 py-1 shadow-sm">
      {label} <strong className={`font-semibold text-foreground ${className}`}>{value}</strong>
    </span>
  );
}

function TaskFilterBar({ filter, counts, copy, onFilterChange }: { filter: FilterKey; counts: TaskCounts; copy: TaskListCopy; onFilterChange: (filter: FilterKey) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[20px] border border-white/70 bg-white/80 p-1.5 shadow-sm backdrop-blur">
      {FILTERS.map((f) => (
        <Button
          key={f.key}
          type="button"
          onClick={() => onFilterChange(f.key)}
          variant={filter === f.key ? "default" : "ghost"}
          size="sm"
          className={filter === f.key ? "rounded-2xl shadow-sm" : "rounded-2xl text-slate-600 hover:bg-slate-100"}
        >
          {filterLabel(f.key, copy)}
          <span className="ml-1.5 text-[11px] opacity-60">{counts[filterKeyToCountKey(f.key)]}</span>
        </Button>
      ))}
    </div>
  );
}

function filterKeyToCountKey(filter: FilterKey): keyof TaskCounts {
  return filter === "needs_me" ? "needsMe" : filter;
}

function TaskRow({ task, copy }: { task: TaskItem; copy: TaskListCopy }) {
  return (
    <div className="group relative overflow-hidden rounded-[24px] border border-white/70 bg-white/92 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md">
      <div className={`absolute inset-y-3 left-3 w-1 rounded-full bg-gradient-to-b ${taskAccentClass(task)}`} aria-hidden="true" />
      <div className="flex flex-wrap items-center justify-between gap-3 pl-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{task.title}</h3>
            <Badge variant={statusTone(task.status)}>{task.status}</Badge>
            <Badge variant={priorityTone(task.priority)}>{task.priority}</Badge>
            {task.projection?.runStatus && task.projection.runStatus !== "idle" && (
              <Badge variant="secondary">{task.projection.runStatus}</Badge>
            )}
          </div>
          {task.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {task.dueAt && <span>{copy.duePrefix}: {new Date(task.dueAt).toLocaleDateString()}</span>}
            <span>{copy.updatedPrefix}: {formatRelativeTime(task.updatedAt, copy)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="default" size="sm" className="rounded-xl shadow-sm">
            <LocalizedLink href={`/tasks/${task.id}`}>
              <ExternalLink className="size-3.5" />
              <span>{copy.viewDetails}</span>
            </LocalizedLink>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TaskListPage({ tasks, workspaceId: _workspaceId, copy }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const taskCopy = copy.pages.tasks;

  const filtered = tasks.filter((t) => matchesFilter(t, filter));

  const counts = {
    all: tasks.length,
    needsMe: tasks.filter((t) => matchesFilter(t, "needs_me")).length,
    ready: tasks.filter((t) => matchesFilter(t, "ready")).length,
    running: tasks.filter((t) => matchesFilter(t, "running")).length,
    completed: tasks.filter((t) => matchesFilter(t, "completed")).length,
    failed: tasks.filter((t) => matchesFilter(t, "failed")).length,
  };
  const activeFilterLabel = filterLabel(filter, taskCopy);

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-[30px] border border-border/55 bg-white/70 p-2 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:p-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-[24px] bg-[linear-gradient(135deg,rgba(248,250,252,0.94),rgba(238,242,255,0.78))] p-3 sm:p-4">
        <TaskListHero title={copy.nav.tasks} copy={taskCopy} activeFilterLabel={activeFilterLabel} counts={counts} />
        <TaskFilterBar filter={filter} counts={counts} copy={taskCopy} onFilterChange={setFilter} />

        {filtered.length === 0 ? (
          <div className="rounded-[26px] border border-dashed border-border/70 bg-white/80 p-10 text-center text-sm text-muted-foreground shadow-sm">
            {taskCopy.emptyFiltered}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {filtered.map((task) => <TaskRow key={task.id} task={task} copy={taskCopy} />)}
          </div>
        )}
      </div>
    </div>
  );
}
