"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ExternalLink,
  Play,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { Badge } from "shared/ui/badge";
import { Button } from "shared/ui/button";
import { PageFrame } from "shared/ui/page-frame";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "shared/ui/select";
import {
  TaskActionsMenu,
  type TaskActionsMenuItem,
} from "@/components/tasks/shared";
import {
  deleteTask,
  markTaskDone,
  reopenTask,
  startExecution,
} from "@/lib/task-actions-client";
import type { Dictionary } from "@/pages";
import type { WorkStateView } from "@chrona/domain";

type TaskItem = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  kind: string;
  recurrenceRule: string | null;
  dueAt: string | null;
  updatedAt: string;
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  projection: {
    runStatus: string | null;
    isRunnable: boolean;
    latestArtifactTitle?: string | null;
    latestRunStatus?: string | null;
  } | null;
  result?: {
    runId: string | null;
    runStatus: string | null;
    provider: string | null;
    occurrenceId: string | null;
    executedAt: string | null;
    artifact: {
      id: string;
      title: string;
      type: string;
      uri: string;
      runId: string;
      createdAt: string;
    } | null;
  } | null;
  stateView: WorkStateView;
  source: {
    source: "external_calendar";
    sourceName: string;
    sourceColor: string;
  } | null;
};

type TaskCounts = {
  all: number;
  needsMe: number;
  ready: number;
  running: number;
  completed: number;
  failed: number;
};

type Props = {
  tasks: TaskItem[];
  workspaceId: string;
  copy: Dictionary;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  counts: TaskCounts;
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

const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Urgent"] as const;
const SORT_OPTIONS = ["updatedAt", "createdAt", "dueAt", "title"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

function isFilterKey(value: string | null): value is FilterKey {
  return value !== null && FILTERS.some((f) => f.key === value);
}

function statusTone(stateView: WorkStateView) {
  if (stateView.tone === "success") return "success" as const;
  if (stateView.tone === "info") return "info" as const;
  if (stateView.tone === "warning") return "warning" as const;
  if (stateView.tone === "danger") return "destructive" as const;
  return "outline" as const;
}

function priorityTone(priority: string) {
  if (priority === "Urgent") return "destructive" as const;
  if (priority === "High") return "warning" as const;
  return "outline" as const;
}

export function taskAutomationLabel(
  task: Pick<TaskItem, "autoPlanGeneration" | "autoExecute">,
  copy: TaskListCopy,
) {
  if (task.autoExecute) return copy.automationAutoComplete;
  if (task.autoPlanGeneration) return copy.automationAutoPlan;
  return copy.automationManual;
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
  if (task.stateView.tone === "danger")
    return "from-destructive to-destructive/60";
  if (task.stateView.tone === "warning") return "from-warning to-warning/60";
  if (task.stateView.tone === "info") return "from-info to-info/60";
  if (task.stateView.tone === "success") return "from-success to-success/60";
  return "from-primary to-primary/60";
}

function formatRelativeTime(dateStr: string, copy: TaskListCopy): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return copy.relativeJustNow;
  if (diffMins < 60)
    return copy.relativeMinutesAgo.replace("{count}", String(diffMins));
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24)
    return copy.relativeHoursAgo.replace("{count}", String(diffHrs));
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7)
    return copy.relativeDaysAgo.replace("{count}", String(diffDays));
  return date.toLocaleDateString();
}

function filterLabel(filter: FilterKey, copy: TaskListCopy): string {
  if (filter === "needs_me") return copy.filterNeedsMe;
  return copy[filter];
}

function canStartTask(task: TaskItem): boolean {
  return task.stateView.primaryActionId === "start_execution";
}

function canCompleteTask(task: TaskItem): boolean {
  return !["result_ready", "done", "cancelled"].includes(task.stateView.state);
}

function canReopenTask(task: TaskItem): boolean {
  return ["done", "cancelled"].includes(task.stateView.state);
}

function TaskListHero({
  title,
  copy,
  activeFilterLabel,
  counts,
}: {
  title: string;
  copy: TaskListCopy;
  activeFilterLabel: string;
  counts: TaskCounts;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-0.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <span className="rounded-full border border-primary/15 bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
            {activeFilterLabel}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {copy.listDescription}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <TaskStat label={copy.statTotal} value={counts.all} />
        <TaskStat
          label={copy.statNeeds}
          value={counts.needsMe}
          className="text-warning-foreground"
        />
        <TaskStat
          label={copy.statReady}
          value={counts.ready}
          className="text-info"
        />
      </div>
      <p className="basis-full text-[11px] text-muted-foreground">
        Needs you: input, approval, or review required · Ready: can start now ·
        Running: active execution · Failed: execution stopped and needs recovery
      </p>
    </div>
  );
}

function TaskStat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <span className="rounded-full border border-border/70 bg-card px-2 py-1 shadow-xs">
      {label}{" "}
      <strong className={`font-semibold text-foreground ${className}`}>
        {value}
      </strong>
    </span>
  );
}

function TaskFilterBar({
  filter,
  counts,
  copy,
  onFilterChange,
}: {
  filter: FilterKey;
  counts: TaskCounts;
  copy: TaskListCopy;
  onFilterChange: (filter: FilterKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border/70 bg-card p-1.5 shadow-xs">
      {FILTERS.map((f) => (
        <Button
          key={f.key}
          type="button"
          onClick={() => onFilterChange(f.key)}
          variant={filter === f.key ? "default" : "ghost"}
          size="sm"
          className={
            filter === f.key
              ? "rounded-xl"
              : "rounded-xl text-muted-foreground hover:bg-muted"
          }
        >
          {filterLabel(f.key, copy)}
          <span className="ml-1.5 text-[11px] opacity-60">
            {counts[filterKeyToCountKey(f.key)]}
          </span>
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
      ? [
          {
            id: "reopen",
            label: copy.actionReopen,
            icon: RotateCcw,
            disabled: isPending,
            onSelect: () => onAction("reopen", task),
          },
        ]
      : [
          {
            id: "complete",
            label: copy.actionComplete,
            icon: RotateCcw,
            disabled: !canCompleteTask(task) || isPending,
            onSelect: () => onAction("complete", task),
          },
        ]),
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
      <div
        className={`absolute inset-y-3 left-3 w-1 rounded-full bg-gradient-to-b ${taskAccentClass(task)}`}
        aria-hidden="true"
      />
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
            <h3 className="truncate text-sm font-semibold text-foreground">
              {task.title}
            </h3>
            <Badge variant={statusTone(task.stateView)}>
              {task.stateView.label}
            </Badge>
            <Badge variant={priorityTone(task.priority)}>{task.priority}</Badge>
            <Badge
              variant={
                task.autoExecute
                  ? "info"
                  : task.autoPlanGeneration
                    ? "secondary"
                    : "outline"
              }
            >
              {taskAutomationLabel(task, copy)}
            </Badge>
            {task.source?.source === "external_calendar" && (
              <Badge
                variant="outline"
                className="gap-1"
                title={copy.externalSourceTitle.replace(
                  "{source}",
                  task.source.sourceName,
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: task.source.sourceColor }}
                  aria-hidden="true"
                />
                <CalendarDays className="size-3" />
                {task.source.sourceName}
              </Badge>
            )}
            <Badge variant="outline">{task.stateView.nextActionLabel}</Badge>
          </div>
          {task.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {toPreviewText(task.description)}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {task.dueAt && (
              <span>
                {copy.duePrefix}: {new Date(task.dueAt).toLocaleDateString()}
              </span>
            )}
            <span>
              {copy.updatedPrefix}: {formatRelativeTime(task.updatedAt, copy)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            asChild
            variant="default"
            size="sm"
            className="rounded-xl shadow-sm"
          >
            <LocalizedLink href={`/tasks/${task.id}`}>
              <ExternalLink className="size-3.5" />
              <span>{copy.viewDetails}</span>
            </LocalizedLink>
          </Button>
          <TaskActionsMenu
            label={copy.moreActions.replace("{title}", task.title)}
            items={actionItems}
          />
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

export function TaskListPage({
  tasks,
  workspaceId: _workspaceId,
  copy,
  total,
  page,
  pageSize,
  pageCount,
  counts,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [isPending, setIsPending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const view = searchParams.get("view") === "results" ? "results" : "tasks";
  const resultDate = searchParams.get("resultDate") ?? "all";
  const resultStatus = searchParams.get("resultStatus") ?? "all";
  const resultSource = searchParams.get("resultSource") ?? "all";
  const resultCutoff =
    resultDate === "7d"
      ? Date.now() - 7 * 86400000
      : resultDate === "30d"
        ? Date.now() - 30 * 86400000
        : null;
  const resultCandidates =
    view === "results"
      ? tasks.filter(
          (task) =>
            (task.stateView.state === "result_ready" ||
              task.stateView.state === "done" ||
              Boolean(task.result)) &&
            (resultStatus === "all" ||
              (resultStatus === "needs-review"
                ? task.stateView.state === "result_ready"
                : task.stateView.state === "done")) &&
            (resultSource === "all" || task.id === resultSource),
        )
      : tasks;
  const visibleTasks =
    resultCutoff === null
      ? resultCandidates
      : resultCandidates.filter(
          (task) =>
            new Date(task.result?.executedAt ?? task.updatedAt).getTime() >=
            resultCutoff,
        );
  const taskCopy = copy.pages.tasks;

  const filterParam = searchParams.get("filter");
  const filter: FilterKey = isFilterKey(filterParam) ? filterParam : "all";
  const priority = searchParams.get("priority") ?? "";
  const sort: SortOption = (SORT_OPTIONS as readonly string[]).includes(
    searchParams.get("sort") ?? "",
  )
    ? (searchParams.get("sort") as SortOption)
    : "updatedAt";
  const order: "asc" | "desc" =
    searchParams.get("order") === "asc" ? "asc" : "desc";
  const [searchDraft, setSearchDraft] = useState(
    () => searchParams.get("search") ?? "",
  );

  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id));
  const visibleSelectedCount = tasks.filter((task) =>
    selectedIds.has(task.id),
  ).length;
  const allVisibleSelected =
    tasks.length > 0 && visibleSelectedCount === tasks.length;

  const activeFilterLabel = filterLabel(filter, taskCopy);
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const hasSelection = selectedIds.size > 0;
  const showPagination = total > pageSize || pageCount > 1;

  function updateParams(
    mutate: (params: URLSearchParams) => void,
    resetPage = true,
  ) {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    if (resetPage) next.delete("page");
    setSearchParams(next, { replace: true });
  }

  function setFilter(nextFilter: FilterKey) {
    updateParams((params) => {
      if (nextFilter === "all") params.delete("filter");
      else params.set("filter", nextFilter);
    });
  }

  function setParam(key: string, value: string) {
    updateParams((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
  }

  function goToPage(nextPage: number) {
    updateParams((params) => {
      params.set("page", String(nextPage));
    }, false);
  }

  function submitSearch() {
    setParam("search", searchDraft.trim());
  }

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
      for (const task of tasks) {
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
      setActionMessage(
        error instanceof Error ? error.message : taskCopy.actionFailed,
      );
    } finally {
      setIsPending(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const deleteIds =
      pendingDelete.kind === "single"
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
      setActionMessage(
        error instanceof Error ? error.message : taskCopy.actionFailed,
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <PageFrame mode="workspace">
      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-card p-3 sm:p-4">
        <TaskListHero
          title={copy.nav.tasks}
          copy={taskCopy}
          activeFilterLabel={activeFilterLabel}
          counts={counts}
        />
        <TaskFilterBar
          filter={filter}
          counts={counts}
          copy={taskCopy}
          onFilterChange={setFilter}
        />
        <div
          className="flex w-fit gap-1 rounded-xl border border-border/70 bg-background p-1"
          role="group"
          aria-label="Tasks view"
        >
          <Button
            type="button"
            size="sm"
            variant={view === "tasks" ? "default" : "ghost"}
            onClick={() => setParam("view", "")}
          >
            Work
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "results" ? "default" : "ghost"}
            onClick={() => setParam("view", "results")}
          >
            Results
          </Button>
        </div>
        {view === "results" ? (
          <Select
            value={resultDate}
            onValueChange={(value) =>
              setParam("resultDate", value === "all" ? "" : value)
            }
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Result date">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any date</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
            <Select
              value={resultStatus}
              onValueChange={(value) =>
                setParam("resultStatus", value === "all" ? "" : value)
              }
            >
              <SelectTrigger
                size="sm"
                className="w-40"
                aria-label="Result status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="needs-review">Needs review</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={resultSource}
              onValueChange={(value) =>
                setParam("resultSource", value === "all" ? "" : value)
              }
            >
              <SelectTrigger
                size="sm"
                className="w-48"
                aria-label="Source task"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any source task</SelectItem>
                {tasks
                  .filter((task) => task.result)
                  .map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      {task.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Select>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2">
          <form
            className="relative flex min-w-[12rem] flex-1 items-center"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
            <Input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onBlur={submitSearch}
              placeholder={taskCopy.searchPlaceholder}
              aria-label={taskCopy.searchPlaceholder}
              className="h-8 rounded-lg pl-8 pr-8 text-xs"
            />
            {searchDraft ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Clear search"
                className="absolute right-1 size-6 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearchDraft("");
                  setParam("search", "");
                }}
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
          </form>
          <Select
            value={priority || "all"}
            onValueChange={(value) =>
              setParam("priority", value === "all" ? "" : value)
            }
          >
            <SelectTrigger
              size="sm"
              className="h-8 w-[8.5rem] rounded-lg text-xs"
              aria-label={taskCopy.priorityLabel}
            >
              <SelectValue placeholder={taskCopy.priorityAll} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{taskCopy.priorityAll}</SelectItem>
              {PRIORITY_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {taskCopy.priorities[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sort}
            onValueChange={(value) => setParam("sort", value)}
          >
            <SelectTrigger
              size="sm"
              className="h-8 w-[9rem] rounded-lg text-xs"
              aria-label={taskCopy.sortLabel}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {taskCopy.sortFields[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg text-xs"
            aria-label={
              order === "asc" ? taskCopy.sortAscending : taskCopy.sortDescending
            }
            onClick={() => setParam("order", order === "asc" ? "desc" : "asc")}
          >
            {order === "asc" ? taskCopy.sortAscending : taskCopy.sortDescending}
          </Button>
        </div>
        {hasSelection || actionMessage ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-background px-3 py-2 text-xs">
            <label className="flex items-center gap-2 font-medium text-foreground">
              <Checkbox
                aria-label={taskCopy.selectVisible}
                checked={allVisibleSelected}
                disabled={tasks.length === 0 || isPending}
                onCheckedChange={(value) =>
                  toggleVisibleSelection(value === true)
                }
              />
              {taskCopy.selectedCount.replace(
                "{count}",
                String(selectedIds.size),
              )}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {actionMessage ? (
                <span className="text-destructive" role="status">
                  {actionMessage}
                </span>
              ) : null}
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
                onClick={() =>
                  setPendingDelete({ kind: "bulk", tasks: selectedTasks })
                }
                className="rounded-xl"
              >
                <Trash2 className="size-3.5" />
                {taskCopy.bulkDelete}
              </Button>
            </div>
          </div>
        ) : null}

        {visibleTasks.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-background/70 p-10 text-center text-sm text-muted-foreground">
            {taskCopy.emptyFiltered}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {visibleTasks.map((task) =>
              view === "results" ? (
                <div
                  key={task.id}
                  className="rounded-2xl border border-border/70 bg-card p-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-foreground">
                          {task.result?.artifact?.title ?? task.title}
                        </h3>
                        <Badge
                          variant={
                            task.stateView.state === "result_ready"
                              ? "warning"
                              : "success"
                          }
                        >
                          {task.stateView.state === "result_ready"
                            ? "Needs review"
                            : "Accepted"}
                        </Badge>
                        {task.result?.artifact ? (
                          <Badge variant="outline">
                            {task.result.artifact.type}
                          </Badge>
                        ) : null}
                        {task.result?.occurrenceId ? (
                          <Badge variant="outline">
                            Occurrence {task.result.occurrenceId}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Source task: {task.title}
                        {task.result?.executedAt
                          ? ` · Executed ${new Date(task.result.executedAt).toLocaleString()}`
                          : ` · Updated ${formatRelativeTime(task.updatedAt, taskCopy)}`}
                        {task.result?.provider
                          ? ` · AI ${task.result.provider}`
                          : ""}
                        {task.result?.runId
                          ? ` · Run ${task.result.runId}`
                          : ""}
                      </p>
                      {!task.result?.artifact ? (
                        <p className="text-xs text-warning-foreground">
                          The run has no saved artifact. Open the task to
                          inspect its output and recovery options.
                        </p>
                      ) : null}
                    </div>
                    <Button asChild size="sm">
                      <LocalizedLink href={`/tasks/${task.id}`}>
                        Open result
                      </LocalizedLink>
                    </Button>
                  </div>
                </div>
              ) : (
                <TaskRow
                  key={task.id}
                  task={task}
                  copy={taskCopy}
                  checked={selectedIds.has(task.id)}
                  isPending={isPending}
                  onToggleSelected={updateSelection}
                  onAction={(action, actionTask) =>
                    void runTaskAction(action, actionTask)
                  }
                  onDelete={(deleteTaskItem) =>
                    setPendingDelete({ kind: "single", task: deleteTaskItem })
                  }
                />
              ),
            )}
          </div>
        )}

        {showPagination ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-background px-3 py-2 text-xs">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>
                {taskCopy.paginationRange
                  .replace("{start}", String(rangeStart))
                  .replace("{end}", String(rangeEnd))
                  .replace("{total}", String(total))}
              </span>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => setParam("pageSize", value)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 w-[6.5rem] rounded-lg text-xs"
                  aria-label={taskCopy.pageSizeLabel}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {taskCopy.pageSizeOption.replace(
                        "{count}",
                        String(value),
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {taskCopy.paginationPage
                  .replace("{page}", String(page))
                  .replace("{pageCount}", String(pageCount))}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-lg"
                disabled={page <= 1 || isPending}
                onClick={() => goToPage(page - 1)}
                aria-label={taskCopy.paginationPrevious}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-lg"
                disabled={page >= pageCount || isPending}
                onClick={() => goToPage(page + 1)}
                aria-label={taskCopy.paginationNext}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDelete?.kind === "single"
                ? taskCopy.deleteTitle.replace(
                    "{title}",
                    pendingDelete.task.title,
                  )
                : taskCopy.bulkDeleteTitle.replace(
                    "{count}",
                    String(pendingDelete?.tasks.length ?? 0),
                  )}
            </DialogTitle>
            <DialogDescription>{taskCopy.deleteDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setPendingDelete(null)}
            >
              {taskCopy.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => void confirmDelete()}
            >
              {isPending ? taskCopy.deleting : taskCopy.actionDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
