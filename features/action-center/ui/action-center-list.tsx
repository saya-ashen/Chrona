import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { ActionCenterItem } from "@chrona/contracts";
import { deriveAttentionDescriptor, type WorkStateView } from "@chrona/domain";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  Inbox,
  Search,
} from "lucide-react";
import { Badge } from "@shared/ui"
import { Button } from "@shared/ui"
import { Card, CardContent } from "@shared/ui"
import { Input } from "@shared/ui"
import { LocalizedLink } from "./localized-link";
import { Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue, } from "@shared/ui"
import { cn } from "@shared/ui"

type ActionCenterPresentationItem = ActionCenterItem & {
  stateView?: WorkStateView;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
};

type ActionCenterListProps = {
  items: ActionCenterPresentationItem[];
  copy?: Partial<typeof DEFAULT_COPY>;
};

type ActionGroupKey = "critical" | "review" | "waiting" | "resolved";
type QueueFilter = "all" | "input" | "approval" | "review" | "recovery";
type QueueSort = "newest" | "priority";

type QueueItem = ActionCenterPresentationItem;

const DEFAULT_COPY = {
  risk: "Risk",
  task: "Task",
  run: "Run",
  openTask: "Open Task",
  approve: "Approve",
  reject: "Reject",
  editAndApprove: "Edit and Approve",
  emptyTitle: "You're all caught up",
  emptyDescription:
    "No decisions, input requests, schedule proposals, or recovery work need your attention right now.",
  emptyAction: "View tasks",
  queueTitle: "Action queue",
  queueDescription:
    "What needs attention, why it matters, and the next button to press.",
  needsAction: "Needs action",
  waitingInput: "Provide input",
  reviewResults: "Review",
  resolvedToday: "Resolved today",
  allFilter: "All",
  inputFilter: "Provide input",
  approvalFilter: "Approvals",
  reviewFilter: "Review",
  recoveryFilter: "Recover",
  searchPlaceholder: "Search tasks or runs...",
  sortLabel: "Sort",
  newestFirst: "Newest first",
  priorityFirst: "Highest priority",
  criticalPriority: "Recover now",
  reviewAndFollowUp: "Review",
  waitingForInput: "Input and approval",
  resolvedLowPriority: "Resolved",
  noFilteredItemsTitle: "No matching action items",
  noFilteredItemsDescription: "No items need this action right now.",
  clearFilters: "Clear filters",
  status: "Status",
};

const GROUP_ORDER: ActionGroupKey[] = [
  "critical",
  "review",
  "waiting",
  "resolved",
];

function groupForItem(item: ActionCenterPresentationItem): ActionGroupKey {
  return deriveAttentionDescriptor({
    stateView: item.stateView,
    itemKind: item.kind,
    riskLevel: item.riskLevel,
  }).group;
}

function priorityScore(item: ActionCenterItem) {
  const groupScore = { critical: 0, review: 1, waiting: 2, resolved: 3 }[
    groupForItem(item)
  ];
  const riskScore =
    item.riskLevel.toLowerCase() === "critical"
      ? 0
      : item.riskLevel.toLowerCase() === "high"
        ? 1
        : item.riskLevel.toLowerCase() === "medium"
          ? 2
          : 3;
  return groupScore * 10 + riskScore;
}

function toneForGroup(group: ActionGroupKey) {
  switch (group) {
    case "critical":
      return {
        bar: "bg-destructive",
        icon: "bg-destructive/10 text-destructive",
        badge: "destructive" as const,
        Icon: AlertTriangle,
      };
    case "waiting":
      return {
        bar: "bg-warning",
        icon: "bg-warning/15 text-warning-foreground dark:text-warning",
        badge: "warning" as const,
        Icon: Clock3,
      };
    case "review":
      return {
        bar: "bg-violet-500",
        icon: "bg-violet-500/10 text-violet-700 dark:text-violet-200",
        badge: "secondary" as const,
        Icon: ClipboardCheck,
      };
    case "resolved":
      return {
        bar: "bg-success",
        icon: "bg-success/12 text-success",
        badge: "success" as const,
        Icon: CheckCircle2,
      };
  }
}

function toneForItem(
  item: ActionCenterPresentationItem,
  group: ActionGroupKey,
) {
  switch (item.stateView?.tone) {
    case "danger":
      return toneForGroup("critical");
    case "warning":
      return toneForGroup("waiting");
    case "success":
      return toneForGroup("resolved");
    case "info":
      return toneForGroup("review");
    default:
      return toneForGroup(group);
  }
}

function statusForItem(item: ActionCenterPresentationItem) {
  if (item.stateView) return item.stateView.label;
  switch (item.kind) {
    case "recovery":
      return item.summary.toLowerCase().includes("cancel")
        ? "Cancelled"
        : "Failed";
    case "blocked":
      return "Blocked";
    case "approval":
      return "Approval needed";
    case "input":
      return "Input needed";
    case "schedule_proposal":
      return "Review proposal";
    case "execution_completed":
      return "Result ready";
    case "task_overdue":
      return "Overdue";
    case "task_due_now":
      return "Due now";
    case "task_due_soon":
      return "Due soon";
    default:
      return item.actionType;
  }
}

function matchesFilter(
  item: ActionCenterPresentationItem,
  filter: QueueFilter,
) {
  switch (filter) {
    case "input":
      return item.kind === "input";
    case "approval":
      return item.kind === "approval" || item.kind === "schedule_proposal";
    case "review":
      return (
        groupForItem(item) === "review" || item.kind === "execution_completed"
      );
    case "recovery":
      return item.kind === "recovery" || item.kind === "blocked";
    default:
      return true;
  }
}

function searchableText(item: ActionCenterItem) {
  return [
    item.actionType,
    item.sourceTaskTitle,
    item.currentRunLabel,
    item.detail,
    item.summary,
    item.consequence,
    item.riskLevel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function actionRequiredCount(item: ActionCenterItem) {
  return groupForItem(item) === "critical" || groupForItem(item) === "waiting";
}

function StatCard({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-baseline justify-between gap-2 border-b border-border/60 px-1 py-2 sm:rounded-lg sm:border sm:bg-card sm:px-3 sm:shadow-sm",
        emphasis && "border-primary/30 sm:bg-primary-soft/45",
      )}
    >
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Inbox className="size-6" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export function ActionCenterList({
  items,
  copy: copyProp,
}: ActionCenterListProps) {
  const copy = { ...DEFAULT_COPY, ...copyProp };
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<QueueSort>("newest");

  const stats = useMemo(
    () => ({
      needsAction: items.filter(actionRequiredCount).length,
      waitingInput: items.filter(
        (item) => groupForItem(item) === "waiting" || item.kind === "input",
      ).length,
      reviewResults: items.filter((item) => groupForItem(item) === "review")
        .length,
      resolvedToday: items.filter((item) => groupForItem(item) === "resolved")
        .length,
    }),
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items
      .filter((item) => matchesFilter(item, filter))
      .filter(
        (item) =>
          normalizedQuery.length === 0 ||
          searchableText(item).includes(normalizedQuery),
      )
      .toSorted((left, right) =>
        sort === "priority" ? priorityScore(left) - priorityScore(right) : 0,
      );
  }, [filter, items, query, sort]);

  const groupedItems = useMemo(() => {
    const groups = new Map<ActionGroupKey, QueueItem[]>();
    for (const group of GROUP_ORDER) groups.set(group, []);
    for (const item of filteredItems)
      groups.get(groupForItem(item))?.push(item);
    return groups;
  }, [filteredItems]);

  if (items.length === 0) {
    return (
      <EmptyState
        title={copy.emptyTitle}
        description={copy.emptyDescription}
        action={
          <Button asChild variant="outline" size="sm">
            <LocalizedLink href="/tasks">{copy.emptyAction}</LocalizedLink>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <section aria-label={copy.queueTitle} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={copy.needsAction}
            value={stats.needsAction}
            emphasis
          />
          <StatCard label={copy.waitingInput} value={stats.waitingInput} />
          <StatCard label={copy.reviewResults} value={stats.reviewResults} />
          <StatCard label={copy.resolvedToday} value={stats.resolvedToday} />
        </div>
        <div className="flex flex-col gap-2 border-y border-border/70 bg-card py-2 sm:rounded-xl sm:border sm:p-2 sm:shadow-sm">
          <div
            className="flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
            role="tablist"
            aria-label={copy.queueDescription}
          >
            {(
              [
                ["all", copy.allFilter],
                ["input", copy.inputFilter],
                ["approval", copy.approvalFilter],
                ["review", copy.reviewFilter],
                ["recovery", copy.recoveryFilter],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={filter === value ? "secondary" : "ghost"}
                size="sm"
                className="h-10 shrink-0 rounded-md px-3 text-xs sm:h-9"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative min-w-0">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="h-8 pl-8 text-sm"
              />
            </label>
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as QueueSort)}
            >
              <SelectTrigger
                aria-label={copy.sortLabel}
                className="h-8 w-full md:w-40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="newest">{copy.newestFirst}</SelectItem>
                <SelectItem value="priority">{copy.priorityFirst}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {filteredItems.length === 0 ? (
        <EmptyState
          title={copy.noFilteredItemsTitle}
          description={copy.noFilteredItemsDescription}
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
            >
              {copy.clearFilters}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {GROUP_ORDER.map((group) => {
            const groupItems = groupedItems.get(group) ?? [];
            if (groupItems.length === 0) return null;
            const title =
              group === "critical"
                ? copy.criticalPriority
                : group === "review"
                  ? copy.reviewAndFollowUp
                  : group === "waiting"
                    ? copy.waitingForInput
                    : copy.resolvedLowPriority;
            return (
              <section
                key={group}
                aria-labelledby={`action-center-${group}`}
                className="space-y-2"
              >
                <h2
                  id={`action-center-${group}`}
                  className="text-xs font-semibold uppercase text-muted-foreground"
                >
                  {title}
                </h2>
                <div className="space-y-2">
                  {groupItems.map((item) => {
                    const tone = toneForItem(item, groupForItem(item));
                    const Icon = tone.Icon;
                    return (
                      <Card
                        key={item.id}
                        className="relative overflow-hidden border-border/60 bg-card shadow-sm"
                      >
                        <div
                          className={cn(
                            "absolute inset-y-0 left-0 w-1",
                            tone.bar,
                          )}
                          aria-hidden
                        />
                        <CardContent className="p-4 pl-5">
                          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                            <div className="flex min-w-0 items-start gap-3">
                              <span
                                className={cn(
                                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                                  tone.icon,
                                )}
                              >
                                <Icon className="size-4" aria-hidden />
                              </span>
                              <div className="min-w-0 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={tone.badge}>
                                    {statusForItem(item)}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {copy.risk}: {item.riskLevel}
                                  </span>
                                </div>
                                <h3 className="break-words text-sm font-semibold text-foreground">
                                  {item.sourceTaskTitle}
                                </h3>
                                <p className="break-words text-[13px] leading-5 text-muted-foreground">
                                  {item.kind === "auto_execution_skipped"
                                    ? item.summary
                                    : item.consequence || item.summary}
                                </p>
                                {item.kind === "auto_execution_skipped" && item.consequence ? (
                                  <p className="break-words text-xs text-muted-foreground">
                                    {item.consequence}
                                  </p>
                                ) : null}
                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  {item.currentRunLabel ? (
                                    <span className="break-all">
                                      {copy.run}: {item.currentRunLabel}
                                    </span>
                                  ) : null}
                                  {item.detail ? (
                                    <span className="break-words">
                                      {item.detail}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap md:justify-end [&_[data-slot=button]]:h-10 [&_a[data-slot=button]]:h-10">
                              {item.primaryAction}
                              {item.secondaryActions}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
