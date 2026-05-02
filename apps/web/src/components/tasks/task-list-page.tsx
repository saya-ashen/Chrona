"use client";

import { useState } from "react";
import {
  PanelRightOpen,
  ExternalLink,
} from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
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
  { key: "all", label: "All" },
  { key: "needs_me", label: "Needs Me" },
  { key: "ready", label: "Ready" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

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
  if (["Completed", "Done"].includes(status)) return "success" as const;
  if (["Running", "Ready", "Queued"].includes(status)) return "info" as const;
  if (["WaitingForInput", "WaitingForApproval"].includes(status)) return "warning" as const;
  if (["Failed", "Blocked"].includes(status)) return "critical" as const;
  return "neutral" as const;
}

function priorityTone(priority: string) {
  if (priority === "Urgent") return "critical" as const;
  if (priority === "High") return "warning" as const;
  return "neutral" as const;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function TaskListPage({ tasks, workspaceId: _workspaceId }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = tasks.filter((t) => matchesFilter(t, filter));

  const counts = {
    all: tasks.length,
    needsMe: tasks.filter((t) => matchesFilter(t, "needs_me")).length,
    ready: tasks.filter((t) => matchesFilter(t, "ready")).length,
    running: tasks.filter((t) => matchesFilter(t, "running")).length,
    completed: tasks.filter((t) => matchesFilter(t, "completed")).length,
    failed: tasks.filter((t) => matchesFilter(t, "failed")).length,
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Manage all tasks — review status, priority, and open the workbench to advance execution.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={
              filter === f.key
                ? buttonVariants({ variant: "default", size: "sm", className: "rounded-xl" })
                : buttonVariants({ variant: "ghost", size: "sm", className: "rounded-xl" })
            }
          >
            {f.label}
            <span className="ml-1.5 text-[11px] opacity-60">{counts[filter === "needs_me" ? "needsMe" : filter]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No tasks match the current filter.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((task) => (
            <div
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/30"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground">
                    {task.title}
                  </h3>
                  <StatusBadge tone={statusTone(task.status)}>{task.status}</StatusBadge>
                  <StatusBadge tone={priorityTone(task.priority)}>{task.priority}</StatusBadge>
                  {task.projection?.runStatus && task.projection.runStatus !== "idle" && (
                    <StatusBadge tone="info">{task.projection.runStatus}</StatusBadge>
                  )}
                </div>
                {task.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {task.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  {task.dueAt && <span>Due: {new Date(task.dueAt).toLocaleDateString()}</span>}
                  <span>Updated: {formatRelativeTime(task.updatedAt)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <LocalizedLink
                  href={`/workspaces/${task.workspaceId}/work/${task.id}`}
                  className={buttonVariants({ variant: "default", size: "sm", className: "rounded-xl" })}
                >
                  <PanelRightOpen className="size-3.5" />
                  <span className="hidden sm:inline">Workbench</span>
                </LocalizedLink>
                <LocalizedLink
                  href={`/workspaces/${task.workspaceId}/tasks/${task.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-xl" })}
                >
                  <ExternalLink className="size-3.5" />
                  <span className="hidden sm:inline">Details</span>
                </LocalizedLink>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
