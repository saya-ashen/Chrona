import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { ActionCenterItem } from "@chrona/contracts/api";
import { deriveAttentionDescriptor, type WorkStateView } from "@chrona/domain";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  Inbox,
  Search,
} from "lucide-react";
import { Badge } from "shared/ui/badge";
import { Button } from "shared/ui/button";
import { Card, CardContent } from "shared/ui/card";
import { Input } from "@/components/ui/input";
import { LocalizedLink } from "@/components/i18n/localized-link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "shared/ui/select";
import { cn } from "@/lib/utils"

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
type QueueFilter =
  "all" | "critical" | "review" | "waiting" | "recovery" | "low";
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
  waitingInput: "Waiting input",
  reviewResults: "Review results",
  resolvedToday: "Resolved today",
  allFilter: "All",
  criticalFilter: "Critical",
  reviewFilter: "Review results",
  waitingFilter: "Waiting input",
  recoveryFilter: "Recovery",
  lowRiskFilter: "Low risk",
  searchPlaceholder: "Search tasks, runs, or agents...",
  sortLabel: "Sort",
  newestFirst: "Newest first",
  priorityFirst: "Priority first",
  criticalPriority: "Critical priority",
  reviewAndFollowUp: "Review and follow-up",
  waitingForInput: "Waiting for input",
  resolvedLowPriority: "Resolved / Low priority",
  noFilteredItemsTitle: "No matching action items",
  noFilteredItemsDescription: "Try a different filter or search term.",
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

function riskBadgeVariant(riskLevel: string) {
  const risk = riskLevel.toLowerCase();
  if (risk === "critical" || risk === "high") return "destructive" as const;
  if (risk === "medium") return "warning" as const;
  return "outline" as const;
}

function statusForItem(item: ActionCenterPresentationItem) {
  if (item.stateView) return item.stateView.label;
  switch (item.kind) {
    case "recovery":
      return "Failed";
    case "blocked":
      return "Blocked";
    case "approval":
      return "Approval";
    case "input":
      return "Waiting input";
    case "schedule_proposal":
      return "Proposal";
    case "execution_completed":
      return "Completed";
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

function matchesFilter(item: ActionCenterItem, filter: QueueFilter) {
  const group = groupForItem(item);
  switch (filter) {
    case "critical":
      return group === "critical";
    case "review":
      return group === "review";
    case "waiting":
      return group === "waiting";
    case "recovery":
      return item.kind === "recovery" || item.kind === "blocked";
    case "low":
      return item.riskLevel.toLowerCase() === "low" || group === "resolved";
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
        "rounded-xl border bg-card px-3 py-2 shadow-sm",
        emphasis ? "border-primary/30 bg-primary-soft/45" : "border-border/70",
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
        <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-2 shadow-sm">
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label={copy.queueDescription}
          >
            {(
              [
                ["all", copy.allFilter],
                ["critical", copy.criticalFilter],
                ["review", copy.reviewFilter],
                ["waiting", copy.waitingFilter],
                ["recovery", copy.recoveryFilter],
                ["low", copy.lowRiskFilter],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={filter === value ? "secondary" : "outline"}
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
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
                  className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
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
                        <CardContent className="p-3 pl-4">
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="flex min-w-0 items-start gap-2.5">
                                  <span
                                    className={cn(
                                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                                      tone.icon,
                                    )}
                                  >
                                    <Icon className="size-3.5" aria-hidden />
                                  </span>
                                  <div className="min-w-0">
                                    <h3 className="line-clamp-1 break-words text-sm font-semibold leading-tight text-foreground">
                                      {item.actionType}
                                    </h3>
                                    <p className="line-clamp-1 break-words text-sm font-medium text-foreground/90">
                                      {item.sourceTaskTitle}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                  <Badge
                                    variant={riskBadgeVariant(item.riskLevel)}
                                  >
                                    {copy.risk}: {item.riskLevel}
                                  </Badge>
                                  <Badge variant={tone.badge}>
                                    {copy.status}: {statusForItem(item)}
                                  </Badge>
                                </div>
                              </div>
                              <p className="line-clamp-2 max-w-3xl break-words text-[13px] leading-5 text-muted-foreground">
                                {item.consequence || item.summary}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                {item.currentRunLabel ? (
                                  <span className="break-all">
                                    {copy.run}: {item.currentRunLabel}
                                  </span>
                                ) : null}
                                {item.detail ? (
                                  <span className="line-clamp-1 break-words">
                                    {item.detail}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 lg:justify-end [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:px-2 [&_a[data-slot=button]]:h-7 [&_a[data-slot=button]]:px-2">
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
