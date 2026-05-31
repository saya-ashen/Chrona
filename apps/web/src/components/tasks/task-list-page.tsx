"use client";

import { useState } from "react";
import {
  ExternalLink,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskActionsMenu, type TaskActionsMenuItem } from "@/components/tasks/shared";
import { deleteTask, markTaskDone, reopenTask, startExecution } from "@/lib/task-actions-client";
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
  if (["Completed", "Done"].includes(status)) return "success" as const;
  if (["Running"].includes(status)) return "info" as const;
  if (["Ready", "Queued"].includes(status)) return "secondary" as const;
  if (["WaitingForInput", "WaitingForApproval"].includes(status)) return "warning" as const;
  if (["Failed", "Blocked"].includes(status)) return "destructive" as const;
  return "outline" as const;
}

function priorityTone(priority: string) {
  if (priority === "Urgent") return "destructive" as const;
  if (priority === "High") return "warning" as const;
  return "outline" as const;
}

function toPreviewText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function taskAccentClass(task: TaskItem): string {
  if (["Failed", "Blocked"].includes(task.status)) return "from-destructive to-destructive/60";
  if (["WaitingForInput", "WaitingForApproval"].includes(task.status)) return "from-warning to-warning/60";
  if (task.status === "Running") return "from-info to-info/60";
  if (["Completed", "Done"].includes(task.status)) return "from-success to-success/60";
  return "from-primary to-primary/60";
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

function canStartTask(task: TaskItem): boolean {
  return task.projection?.isRunnable === true && !["Running", "Completed", "Done"].includes(task.status);
}

function canCompleteTask(task: TaskItem): boolean {
  return !["Completed", "Done"].includes(task.status);
}

function canReopenTask(task: TaskItem): boolean {
  return ["Completed", "Done"].includes(task.status);
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
        <TaskStat label={copy.statNeeds} value={counts.needsMe} className="text-warning-foreground" />
        <TaskStat label={copy.statReady} value={counts.ready} className="text-info" />
      </div>
    </div>
  );
}

function TaskStat({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <span className="rounded-full border border-border/70 bg-card px-2 py-1 shadow-xs">
      {label} <strong className={`font-semibold text-foreground ${className}`}>{value}</strong>
    </span>
  );
}

function TaskFilterBar({ filter, counts, copy, onFilterChange }: { filter: FilterKey; counts: TaskCounts; copy: TaskListCopy; onFilterChange: (filter: FilterKey) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border/70 bg-card p-1.5 shadow-xs">
      {FILTERS.map((f) => (
        <Button
          key={f.key}
          type="button"
          onClick={() => onFilterChange(f.key)}
          variant={filter === f.key ? "default" : "ghost"}
          size="sm"
          className={filter === f.key ? "rounded-xl" : "rounded-xl text-muted-foreground hover:bg-muted"}
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

function TaskRow({
  task,
  copy,
  checked,
  isPending,
  onToggleSelected,
  onAction,
  onDelete,
}: {
  task: TaskItem;
  copy: TaskListCopy;
  checked: boolean;
  isPending: boolean;
  onToggleSelected: (taskId: string, checked: boolean) => void;
  onAction: (action: TaskListAction, task: TaskItem) => void;
  onDelete: (task: TaskItem) => void;
}) {
  const actionItems: TaskActionsMenuItem[] = [
    {
      id: "open",
      label: copy.viewDetails,
      icon: ExternalLink,
      href: `/tasks/${task.id}`,
    },
    {
      id: "start",
      label: copy.actionStart,
      icon: Play,
      disabled: !canStartTask(task) || isPending,
      disabledReason: copy.actionStartDisabled,
      onSelect: () => onAction("start", task),
    },
    ...(canReopenTask(task)
      ? [{
          id: "reopen",
          label: copy.actionReopen,
          icon: RotateCcw,
          disabled: isPending,
          onSelect: () => onAction("reopen", task),
        }]
      : [{
          id: "complete",
          label: copy.actionComplete,
          icon: RotateCcw,
          disabled: !canCompleteTask(task) || isPending,
          onSelect: () => onAction("complete", task),
        }]),
    {
      id: "delete",
      label: copy.actionDelete,
      icon: Trash2,
      destructive: true,
      disabled: isPending,
      onSelect: () => onDelete(task),
    },
  ];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
      <div className={`absolute inset-y-3 left-3 w-1 rounded-full bg-gradient-to-b ${taskAccentClass(task)}`} aria-hidden="true" />
      <div className="flex flex-wrap items-center justify-between gap-3 pl-4">
        <Checkbox
          aria-label={copy.selectTask.replace("{title}", task.title)}
          checked={checked}
          disabled={isPending}
          onCheckedChange={(value) => onToggleSelected(task.id, value === true)}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{task.title}</h3>
            <Badge variant={statusTone(task.status)}>{task.status}</Badge>
            <Badge variant={priorityTone(task.priority)}>{task.priority}</Badge>
            {task.projection?.runStatus && task.projection.runStatus !== "idle" && (
              <Badge variant="secondary">{task.projection.runStatus}</Badge>
            )}
          </div>
          {task.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{toPreviewText(task.description)}</p>}
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
          <TaskActionsMenu label={copy.moreActions.replace("{title}", task.title)} items={actionItems} />
        </div>
      </div>
    </div>
  );
}

type TaskListAction = "start" | "complete" | "reopen";

type PendingDelete =
  | { kind: "single"; task: TaskItem }
  | { kind: "bulk"; tasks: TaskItem[] }
  | null;

export function TaskListPage({ tasks, workspaceId: _workspaceId, copy }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [isPending, setIsPending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const taskCopy = copy.pages.tasks;

  const filtered = tasks.filter((t) => matchesFilter(t, filter));
  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id));
  const visibleSelectedCount = filtered.filter((task) => selectedIds.has(task.id)).length;
  const allVisibleSelected = filtered.length > 0 && visibleSelectedCount === filtered.length;

  const counts = {
    all: tasks.length,
    needsMe: tasks.filter((t) => matchesFilter(t, "needs_me")).length,
    ready: tasks.filter((t) => matchesFilter(t, "ready")).length,
    running: tasks.filter((t) => matchesFilter(t, "running")).length,
    completed: tasks.filter((t) => matchesFilter(t, "completed")).length,
    failed: tasks.filter((t) => matchesFilter(t, "failed")).length,
  };
  const activeFilterLabel = filterLabel(filter, taskCopy);

  function refreshTasks() {
    navigate(".", { replace: true });
  }

  function updateSelection(taskId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  function toggleVisibleSelection(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const task of filtered) {
        if (checked) next.add(task.id);
        else next.delete(task.id);
      }
      return next;
    });
  }

  async function runTaskAction(action: TaskListAction, task: TaskItem) {
    setIsPending(true);
    setActionMessage(null);
    try {
      if (action === "start") await startExecution({ taskId: task.id });
      if (action === "complete") await markTaskDone({ taskId: task.id });
      if (action === "reopen") await reopenTask({ taskId: task.id });
      refreshTasks();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : taskCopy.actionFailed);
    } finally {
      setIsPending(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const deleteIds = pendingDelete.kind === "single"
      ? [pendingDelete.task.id]
      : pendingDelete.tasks.map((task) => task.id);

    setIsPending(true);
    setActionMessage(null);
    try {
      await Promise.all(deleteIds.map((taskId) => deleteTask({ taskId })));
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const taskId of deleteIds) next.delete(taskId);
        return next;
      });
      setPendingDelete(null);
      refreshTasks();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : taskCopy.actionFailed);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-3xl border border-border/60 bg-card/60 p-2 shadow-sm sm:p-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl bg-gradient-to-br from-muted/40 to-primary-soft/30 p-3 sm:p-4">
        <TaskListHero title={copy.nav.tasks} copy={taskCopy} activeFilterLabel={activeFilterLabel} counts={counts} />
        <TaskFilterBar filter={filter} counts={counts} copy={taskCopy} onFilterChange={setFilter} />

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 text-xs shadow-xs">
          <label className="flex items-center gap-2 font-medium text-foreground">
            <Checkbox
              aria-label={taskCopy.selectVisible}
              checked={allVisibleSelected}
              disabled={filtered.length === 0 || isPending}
              onCheckedChange={(value) => toggleVisibleSelection(value === true)}
            />
            {taskCopy.selectedCount.replace("{count}", String(selectedIds.size))}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {actionMessage ? <span className="text-destructive" role="status">{actionMessage}</span> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectedIds.size === 0 || isPending}
              onClick={() => setSelectedIds(new Set())}
              className="rounded-xl"
            >
              {taskCopy.bulkClear}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedTasks.length === 0 || isPending}
              onClick={() => setPendingDelete({ kind: "bulk", tasks: selectedTasks })}
              className="rounded-xl"
            >
              <Trash2 className="size-3.5" />
              {taskCopy.bulkDelete}
            </Button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 p-10 text-center text-sm text-muted-foreground shadow-xs">
            {taskCopy.emptyFiltered}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                copy={taskCopy}
                checked={selectedIds.has(task.id)}
                isPending={isPending}
                onToggleSelected={updateSelection}
                onAction={(action, actionTask) => void runTaskAction(action, actionTask)}
                onDelete={(deleteTaskItem) => setPendingDelete({ kind: "single", task: deleteTaskItem })}
              />
            ))}
          </div>
        )}
      </div>
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDelete?.kind === "single"
                ? taskCopy.deleteTitle.replace("{title}", pendingDelete.task.title)
                : taskCopy.bulkDeleteTitle.replace("{count}", String(pendingDelete?.tasks.length ?? 0))}
            </DialogTitle>
            <DialogDescription>{taskCopy.deleteDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setPendingDelete(null)}>
              {taskCopy.cancel}
            </Button>
            <Button type="button" variant="destructive" disabled={isPending} onClick={() => void confirmDelete()}>
              {isPending ? taskCopy.deleting : taskCopy.actionDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
