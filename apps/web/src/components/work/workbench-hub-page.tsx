"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  PanelRightOpen,
  Play,
  Sparkles,
} from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskListRouteData } from "@/pages";

type TaskItem = TaskListRouteData["tasks"][number];

type Props = {
  tasks: TaskItem[];
  workspaceId: string;
  copy: TaskListRouteData["dictionary"];
};

const SECTION_TABS = [
  { key: "all", label: "All" },
  { key: "needs_me", label: "Needs Me" },
  { key: "ready", label: "Ready" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
] as const;

type TabKey = (typeof SECTION_TABS)[number]["key"];

function categorize(task: TaskItem): TabKey {
  if (["WaitingForInput", "WaitingForApproval", "Blocked"].includes(task.status)) return "needs_me";
  if (["Ready", "Queued", "Draft"].includes(task.status) && task.projection?.isRunnable) return "ready";
  if (task.status === "Running") return "running";
  if (["Completed", "Done"].includes(task.status)) return "completed";
  if (task.status === "Failed") return "failed";
  return "ready";
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

function actionLabel(task: TaskItem): { label: string; variant: "default" | "outline" } {
  switch (task.status) {
    case "WaitingForInput":
      return { label: "Provide Input", variant: "default" };
    case "WaitingForApproval":
      return { label: "Handle Approval", variant: "default" };
    case "Failed":
      return { label: "Recover", variant: "default" };
    case "Running":
      return { label: "View Progress", variant: "default" };
    case "Completed":
    case "Done":
      return { label: "View Result", variant: "outline" };
    default:
      return { label: "Start Work", variant: "default" };
  }
}

const overviewCards = [
  { key: "needs_me", label: "Needs My Attention", icon: AlertTriangle, accent: "from-amber-50 to-white text-amber-700" },
  { key: "ready", label: "Ready to Start", icon: Play, accent: "from-blue-50 to-white text-blue-700" },
  { key: "running", label: "Currently Running", icon: Sparkles, accent: "from-emerald-50 to-white text-emerald-700" },
  { key: "completed", label: "Recently Completed", icon: CheckCircle2, accent: "from-violet-50 to-white text-violet-700" },
] as const;

export function WorkbenchHubPage({ tasks, workspaceId: _workspaceId }: Props) {
  const [tab, setTab] = useState<TabKey>("all");

  const categorized = tasks.map((t) => ({ ...t, category: categorize(t) }));

  const needsMe = categorized.filter((t) => t.category === "needs_me");
  const ready = categorized.filter((t) => t.category === "ready");
  const running = categorized.filter((t) => t.category === "running");
  const completed = categorized.filter((t) => t.category === "completed");
  const failed = categorized.filter((t) => t.category === "failed");

  const counts: Record<string, number> = {
    needs_me: needsMe.length,
    ready: ready.length,
    running: running.length,
    completed: completed.length,
  };

  let displayed: (TaskItem & { category: string })[] = [];
  if (tab === "all") {
    displayed = [...needsMe, ...ready, ...running, ...completed, ...failed];
  } else if (tab === "needs_me") {
    displayed = needsMe;
  } else if (tab === "ready") {
    displayed = ready;
  } else if (tab === "running") {
    displayed = running;
  } else if (tab === "completed") {
    displayed = completed;
  } else if (tab === "failed") {
    displayed = failed;
  }

  const sectionLabels: Record<string, string> = {
    needs_me: "Needs My Attention",
    ready: "Ready to Start",
    running: "Currently Running",
    completed: "Recently Completed",
    failed: "Failed / Blocked",
  };

  const grouped = new Map<string, (TaskItem & { category: string })[]>();
  for (const t of displayed) {
    if (!grouped.has(t.category)) grouped.set(t.category, []);
    grouped.get(t.category)!.push(t);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workbench Hub</h1>
        <p className="text-sm text-muted-foreground">
          Your execution queue — review what needs your attention and advance tasks with AI collaboration.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {overviewCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setTab(card.key as TabKey)}
              className={cn(
                "rounded-[20px] border border-border/60 bg-gradient-to-br p-3.5 text-left shadow-sm transition-all hover:shadow-md",
                card.accent,
                tab === card.key && "ring-2 ring-primary/30",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight">{counts[card.key] ?? 0}</p>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/80 p-1.5 shadow-sm">
                  <Icon className="size-4" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {SECTION_TABS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setTab(s.key)}
            className={
              tab === s.key
                ? buttonVariants({ variant: "default", size: "sm", className: "rounded-xl" })
                : buttonVariants({ variant: "ghost", size: "sm", className: "rounded-xl" })
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {displayed.length === 0 ? (
        <div className="rounded-2xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No tasks in this view. Ready-to-run tasks will appear here when scheduled.
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <section key={category}>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {sectionLabels[category] ?? category}
                </h2>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((task) => {
                  const action = actionLabel(task);
                  return (
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
                          className={buttonVariants({
                            variant: action.variant,
                            size: "sm",
                            className: "rounded-xl",
                          })}
                        >
                          <PanelRightOpen className="size-3.5" />
                          <span className="hidden sm:inline">{action.label}</span>
                        </LocalizedLink>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
