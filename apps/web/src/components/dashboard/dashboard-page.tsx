"use client";

import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock,
  FileText,
  GitPullRequestArrow,
  Inbox as InboxIcon,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Wand2,
  type LucideProps,
} from "lucide-react";

import type { Dictionary } from "@/pages";
import { useRevalidator } from "react-router-dom";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { apiJson } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UiSurfaceFrame } from "@/components/ai-surface/ui-surface-frame";
import { SpecRenderer } from "@/components/tasks/workspace/catalog/spec-renderer";
import type { UiDocument } from "@chrona/ui-protocol";
import { cn } from "@/lib/utils";
import type {
  DashboardAttentionItem,
  DashboardCompletedItem,
  DashboardCompletionCategory,
  DashboardData,
  DashboardEvent,
  DashboardFocusTask,
  DashboardInProgressItem,
  DashboardOutput,
} from "./dashboard-types";

type DashboardCopy = Dictionary["pages"]["dashboard"];

type DashboardPageProps = {
  data: DashboardData;
  copy: DashboardCopy;
  workspaceId?: string;
};

const ATTENTION_TONE: Record<DashboardAttentionItem["kind"], "warning" | "danger" | "info"> = {
  approval: "warning",
  input: "info",
  blocked: "danger",
  failed: "danger",
  schedule_risk: "warning",
};

const ATTENTION_ICON: Record<DashboardAttentionItem["kind"], ComponentType<LucideProps>> = {
  approval: CircleAlert,
  input: MessageSquare,
  blocked: AlertTriangle,
  failed: AlertTriangle,
  schedule_risk: Clock,
};

const CATEGORY_ICON: Record<DashboardCompletionCategory, ComponentType<LucideProps>> = {
  report: FileText,
  research: Search,
  code: GitPullRequestArrow,
  automation: Wand2,
};

const CATEGORY_TONE: Record<DashboardCompletionCategory, string> = {
  report: "text-violet-500",
  research: "text-sky-500",
  code: "text-emerald-500",
  automation: "text-amber-500",
};

const FEED_TONE: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  blocked: "bg-destructive",
  approval: "bg-amber-500",
  input: "bg-sky-500",
  plan: "bg-violet-500",
  schedule: "bg-amber-500",
  started: "bg-sky-500",
  created: "bg-muted-foreground",
};

type DigestRange = "today" | "week" | "all";
type StreamFilter = "all" | "attention" | "inProgress" | "autoCompleted";

const CATEGORY_ORDER: DashboardCompletionCategory[] = ["report", "research", "code", "automation"];
const STREAM_FILTERS: StreamFilter[] = ["all", "attention", "inProgress", "autoCompleted"];

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function fillTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
    template,
  );
}

function formatRelative(value: string | null, copy: DashboardCopy["time"]): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return copy.justNow;
  const minutes = Math.round(diffSec / 60);
  if (minutes < 60) return copy.minutes.replace("{n}", String(minutes));
  const hours = Math.round(minutes / 60);
  if (hours < 24) return copy.hours.replace("{n}", String(hours));
  const days = Math.round(hours / 24);
  if (days < 7) return copy.days.replace("{n}", String(days));
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function OutputLink({ output }: { output: DashboardOutput }) {
  return (
    <LocalizedLink
      href={`/work/${output.taskId}`}
      className="inline-flex max-w-full items-center gap-1.5 truncate text-xs text-muted-foreground hover:text-foreground"
    >
      <FileText className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{output.title}</span>
      <Badge variant="outline" className="shrink-0">
        {output.type}
      </Badge>
    </LocalizedLink>
  );
}

/* ── Headline banner ──────────────────────────────────────────────────────── */

function MetricPill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: ComponentType<LucideProps>;
  label: string;
  value: number;
  tone: "primary" | "warning" | "success" | "info";
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border bg-background/80 px-4 py-3 shadow-sm backdrop-blur">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          tone === "primary" && "bg-primary/10 text-primary",
          tone === "warning" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          tone === "success" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          tone === "info" && "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function HeadlineBanner({
  copy,
  completedToday,
  attentionCount,
  inProgressCount,
  totalAutoCompleted,
}: {
  copy: DashboardCopy;
  completedToday: number;
  attentionCount: number;
  inProgressCount: number;
  totalAutoCompleted: number;
}) {
  let sentence: string;
  if (completedToday > 0 && attentionCount > 0) {
    sentence = fillTemplate(copy.headline.both, { completed: completedToday, attention: attentionCount });
  } else if (completedToday > 0) {
    sentence = fillTemplate(copy.headline.completedOnly, { completed: completedToday });
  } else if (attentionCount > 0) {
    sentence = fillTemplate(copy.headline.attentionOnly, { attention: attentionCount });
  } else {
    sentence = copy.headline.idle;
  }

  return (
    <section className="overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/[0.12] via-background to-background shadow-sm">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] lg:p-8">
        <div className="flex min-w-0 flex-col justify-between gap-6">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur">
              <Sparkles className="size-3.5" aria-hidden />
              {copy.subtitle}
            </span>
            <div className="space-y-2">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{copy.title}</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{sentence}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <LocalizedLink href="/tasks">
                <Plus className="size-4" aria-hidden />
                {copy.newTask}
              </LocalizedLink>
            </Button>
            <Button asChild size="sm" variant="outline" className="bg-background/70">
              <LocalizedLink href="/tasks">{copy.viewAllTasks}</LocalizedLink>
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricPill icon={AlertTriangle} label={copy.summary.title} value={attentionCount} tone="warning" />
          <MetricPill icon={Loader2} label={copy.inProgress.title} value={inProgressCount} tone="info" />
          <MetricPill icon={CheckCircle2} label={copy.digest.rangeToday} value={completedToday} tone="success" />
          <MetricPill icon={Sparkles} label={copy.completed.title} value={totalAutoCompleted} tone="primary" />
        </div>
      </div>
    </section>
  );
}

/* ── Hero: focus headline + needs-you summary ─────────────────────────────── */

function FocusCard({ task, copy }: { task: DashboardFocusTask | null; copy: DashboardCopy }) {
  if (!task) {
    return (
      <Card className="min-h-[220px] border-dashed bg-muted/20">
        <CardContent className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
          <Sparkles className="size-6 text-muted-foreground/60" aria-hidden />
          <p className="text-sm text-muted-foreground">{copy.focus.empty}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/[0.08] to-background shadow-sm">
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
          <Sparkles className="size-4" aria-hidden />
          {copy.focus.eyebrow}
        </div>
        <CardTitle className="text-xl leading-tight">{task.title}</CardTitle>
        {task.reason ? (
          <CardDescription className="text-sm text-foreground/80">{task.reason}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{task.status}</Badge>
          {task.stage ? <span className="truncate">{task.stage}</span> : null}
          {task.latestOutput ? <OutputLink output={task.latestOutput} /> : null}
        </div>
        <Button asChild size="sm" className="shrink-0">
          <LocalizedLink href={`/work/${task.taskId}`}>
            {copy.nextStep[task.nextStep]}
            <ArrowRight className="size-4" aria-hidden />
          </LocalizedLink>
        </Button>
      </CardContent>
    </Card>
  );
}

function NeedsYouCard({
  copy,
  items,
}: {
  copy: DashboardCopy;
  items: DashboardAttentionItem[];
}) {
  const counts = useMemo(() => {
    const map = new Map<DashboardAttentionItem["kind"], number>();
    for (const item of items) map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    return map;
  }, [items]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-amber-500" aria-hidden />
          {copy.summary.title}
        </CardTitle>
        <CardDescription>
          {items.length > 0 ? copy.summary.pending.replace("{n}", String(items.length)) : copy.summary.none}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-6 text-emerald-500/70" aria-hidden />
            <p className="text-sm text-muted-foreground">{copy.attention.empty}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {[...counts.entries()].map(([kind, count]) => {
              const Icon = ATTENTION_ICON[kind];
              const tone = ATTENTION_TONE[kind];
              return (
                <li key={kind} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        tone === "danger" ? "text-destructive" : tone === "warning" ? "text-amber-500" : "text-sky-500",
                      )}
                      aria-hidden
                    />
                    <span className="text-muted-foreground">{copy.attention.kind[kind]}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Auto-completion digest ───────────────────────────────────────────────── */
function DashboardAiBriefStatus({
  aiBrief,
  copy,
  onRegenerate,
}: {
  aiBrief: DashboardData["aiBrief"];
  copy: DashboardCopy["digest"]["aiBrief"];
  onRegenerate: () => void;
}) {
  if (!aiBrief) return null;

  const label =
    aiBrief.status === "generating"
      ? copy.generating
      : aiBrief.status === "dirty"
        ? copy.dirty
        : aiBrief.status === "failed"
          ? copy.failed
          : aiBrief.status === "unconfigured"
            ? copy.unconfigured
            : null;

  if (!label) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        <span className="font-medium text-foreground">{label}</span>
        {aiBrief.errorMessage ? <span> · {aiBrief.errorMessage}</span> : null}
      </span>
      {aiBrief.canGenerate ? (
        <Button size="sm" variant="ghost" onClick={onRegenerate}>
          {copy.regenerate}
        </Button>
      ) : null}
    </div>
  );
}

function useDashboardAiBriefGeneration(input: {
  workspaceId: string;
  aiBrief: DashboardData["aiBrief"];
}) {
  const revalidator = useRevalidator();
  const inFlightKeyRef = useRef<string | null>(null);

  const generate = async (force = false) => {
    const key = force ? `force:${input.aiBrief?.inputFingerprint ?? "unknown"}` : input.aiBrief?.inputFingerprint;
    if (!key || inFlightKeyRef.current === key) return;
    inFlightKeyRef.current = key;
    try {
      await apiJson(`/api/pages/dashboard/ai-brief/generate?workspaceId=${encodeURIComponent(input.workspaceId)}`, {
        method: "POST",
        body: JSON.stringify({ force }),
      });
      void revalidator.revalidate();
    } finally {
      inFlightKeyRef.current = null;
    }
  };

  useEffect(() => {
    if (input.aiBrief?.status === "dirty" && input.aiBrief.canGenerate) {
      void generate(false);
    }
  }, [input.aiBrief?.status, input.aiBrief?.canGenerate, input.aiBrief?.inputFingerprint, input.workspaceId]);

  return { regenerate: () => void generate(true) };
}


function DigestModule({
  copy,
  completed,
  totalAutoCompleted,
  aiBrief,
  onRegenerate,
}: {
  copy: DashboardCopy;
  completed: DashboardCompletedItem[];
  totalAutoCompleted: number;
  aiBrief: DashboardData["aiBrief"];
  onRegenerate: () => void;
}) {
  const [range, setRange] = useState<DigestRange>("today");

  const { scoped, headline, breakdown } = useMemo(() => {
    const dayStart = startOfToday();
    const weekStart = dayStart - 6 * 24 * 60 * 60 * 1000;
    const inRange = (item: DashboardCompletedItem) => {
      if (range === "all") return true;
      const at = item.completedAt ? new Date(item.completedAt).getTime() : 0;
      return at >= (range === "today" ? dayStart : weekStart);
    };
    const scopedItems = completed.filter(inRange);

    const counts = new Map<DashboardCompletionCategory, number>();
    for (const item of scopedItems) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);

    const headlineKey =
      range === "today" ? "todayHeadline" : range === "week" ? "weekHeadline" : "allTimeHeadline";
    const headlineCount = range === "all" ? totalAutoCompleted : scopedItems.length;

    return {
      scoped: scopedItems,
      headline: copy.digest[headlineKey]
        .replace("{n}", String(headlineCount))
        .replace(headlineCount === 1 ? "tasks" : "__noop__", "task"),
      breakdown: CATEGORY_ORDER.map((category) => ({ category, count: counts.get(category) ?? 0 })).filter(
        (entry) => entry.count > 0,
      ),
    };
  }, [completed, copy, range, totalAutoCompleted]);

  const isEmpty = totalAutoCompleted === 0 && completed.length === 0;

  return (
    <UiSurfaceFrame kind="ai-authored" label={copy.digest.title} className="overflow-hidden p-0" bodyClassName="min-w-0">
      <CardHeader className="gap-4 border-b bg-muted/20 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="size-5 text-primary" aria-hidden />
              {copy.digest.title}
            </CardTitle>
            <CardDescription>{copy.digest.description}</CardDescription>
          </div>
          <Tabs value={range} onValueChange={(value) => setRange(value as DigestRange)}>
            <TabsList className="rounded-full">
              <TabsTrigger value="today" className="rounded-full">{copy.digest.rangeToday}</TabsTrigger>
              <TabsTrigger value="week" className="rounded-full">{copy.digest.rangeWeek}</TabsTrigger>
              <TabsTrigger value="all" className="rounded-full">{copy.digest.rangeAll}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {aiBrief?.spec ? (
          <DashboardAiBriefStatus aiBrief={aiBrief} copy={copy.digest.aiBrief} onRegenerate={onRegenerate} />
        ) : null}
      </CardHeader>
      {aiBrief?.spec ? (
        <CardContent className="p-5">
          <SpecRenderer spec={aiBrief.spec as UiDocument} fallback={null} />
        </CardContent>
      ) : null}
      {!aiBrief?.spec ? <CardContent className="p-5">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Sparkles className="size-7 text-muted-foreground/50" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">{copy.digest.empty}</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="space-y-4">
              <p className="text-2xl font-semibold tracking-tight">{headline}</p>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {copy.digest.breakdownTitle}
                </p>
                {breakdown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{copy.completed.empty}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {breakdown.map(({ category, count }) => {
                      const Icon = CATEGORY_ICON[category];
                      return (
                        <div
                          key={category}
                          className="flex items-center gap-2 rounded-xl border bg-background/70 px-3 py-2 shadow-sm"
                        >
                          <Icon className={cn("size-4 shrink-0", CATEGORY_TONE[category])} aria-hidden />
                          <div className="min-w-0">
                            <p className="truncate text-xs text-muted-foreground">
                              {copy.digest.category[category]}
                            </p>
                            <p className="text-sm font-semibold tabular-nums">
                              {copy.digest.categoryUnit[category].replace("{n}", String(count))}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {copy.digest.recentTitle}
              </p>
              {scoped.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">{copy.completed.empty}</p>
              ) : (
                <ul className="divide-y">
                  {scoped.slice(0, 5).map((item) => (
                    <li key={item.taskId} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                        <div className="min-w-0 space-y-0.5">
                          <LocalizedLink
                            href={`/work/${item.taskId}`}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {item.title}
                          </LocalizedLink>
                          {item.output ? (
                            <OutputLink output={item.output} />
                          ) : item.summary ? (
                            <p className="truncate text-xs text-muted-foreground">{item.summary}</p>
                          ) : null}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatRelative(item.completedAt, copy.time)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent> : null}
      {!isEmpty ? (
        <CardContent className="p-5 pt-0">
          <Separator className="mb-3" />
          <Button asChild variant="ghost" size="sm" className="px-0 text-muted-foreground hover:text-foreground">
            <LocalizedLink href="/tasks?filter=completed">
              {copy.digest.viewAll}
              <ArrowRight className="size-4" aria-hidden />
            </LocalizedLink>
          </Button>
        </CardContent>
      ) : null}
    </UiSurfaceFrame>
  );
}

/* ── In-progress + activity feed ──────────────────────────────────────────── */

function InProgressCard({
  copy,
  items,
}: {
  copy: DashboardCopy;
  items: DashboardInProgressItem[];
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Loader2 className="size-4 text-sky-500" aria-hidden />
          {copy.inProgress.title}
        </CardTitle>
        <CardDescription>{copy.inProgress.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Loader2 className="size-6 text-muted-foreground/50" aria-hidden />
            <p className="text-sm text-muted-foreground">{copy.inProgress.empty}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.taskId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Loader2 className="size-4 shrink-0 animate-spin text-sky-500" aria-hidden />
                  <span className="truncate text-sm font-medium">{item.title}</span>
                  {item.stage ? (
                    <span className="truncate text-xs text-muted-foreground">{item.stage}</span>
                  ) : null}
                </div>
                <Button asChild size="sm" variant="ghost" className="shrink-0">
                  <LocalizedLink href={`/work/${item.taskId}`}>{copy.openTask}</LocalizedLink>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityFeedCard({
  copy,
  events,
}: {
  copy: DashboardCopy;
  events: DashboardEvent[];
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <InboxIcon className="size-4 text-muted-foreground" aria-hidden />
          {copy.feed.title}
        </CardTitle>
        <CardDescription>{copy.feed.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <InboxIcon className="size-6 text-muted-foreground/50" aria-hidden />
            <p className="text-sm text-muted-foreground">{copy.feed.empty}</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {events.map((event) => {
              const label = copy.feed.category[event.category as keyof DashboardCopy["feed"]["category"]];
              return (
                <li key={event.id} className="flex gap-3 py-2">
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      FEED_TONE[event.category] ?? "bg-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <LocalizedLink href={`/work/${event.taskId}`} className="font-medium hover:underline">
                        {event.taskTitle}
                      </LocalizedLink>{" "}
                      <span className="text-muted-foreground">— {event.summary ?? label}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatRelative(event.at, copy.time)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Task stream (filtered) ───────────────────────────────────────────────── */

type StreamRow = {
  taskId: string;
  lane: "attention" | "inProgress" | "autoCompleted";
  title: string;
  detail: string | null;
  output: DashboardOutput | null;
  href: string;
  action: string;
  at: string | null;
};

const LANE_BADGE: Record<StreamRow["lane"], "warning" | "info" | "success"> = {
  attention: "warning",
  inProgress: "info",
  autoCompleted: "success",
};

const LANE_ICON: Record<StreamRow["lane"], ComponentType<LucideProps>> = {
  attention: AlertTriangle,
  inProgress: Loader2,
  autoCompleted: CheckCircle2,
};

function TaskStreamCard({
  copy,
  attention,
  inProgress,
  completed,
}: {
  copy: DashboardCopy;
  attention: DashboardAttentionItem[];
  inProgress: DashboardInProgressItem[];
  completed: DashboardCompletedItem[];
}) {
  const [filter, setFilter] = useState<StreamFilter>("all");

  const rows = useMemo<StreamRow[]>(() => {
    const attentionRows: StreamRow[] = attention.map((item) => ({
      taskId: item.taskId,
      lane: "attention",
      title: item.title,
      detail: item.reason ?? copy.attention.kind[item.kind],
      output: item.latestOutput,
      href: `/work/${item.taskId}`,
      action: copy.nextStep[item.nextStep],
      at: item.updatedAt,
    }));
    const inProgressRows: StreamRow[] = inProgress.map((item) => ({
      taskId: item.taskId,
      lane: "inProgress",
      title: item.title,
      detail: item.stage,
      output: item.latestOutput,
      href: `/work/${item.taskId}`,
      action: copy.openTask,
      at: item.updatedAt,
    }));
    const completedRows: StreamRow[] = completed.map((item) => ({
      taskId: item.taskId,
      lane: "autoCompleted",
      title: item.title,
      detail: item.output ? null : item.summary,
      output: item.output,
      href: `/work/${item.taskId}`,
      action: copy.openTask,
      at: item.completedAt,
    }));

    if (filter === "attention") return attentionRows;
    if (filter === "inProgress") return inProgressRows;
    if (filter === "autoCompleted") return completedRows;
    return [...attentionRows, ...inProgressRows, ...completedRows];
  }, [attention, completed, copy, filter, inProgress]);

  return (
    <Card className="overflow-hidden shadow-sm">
      <CardHeader className="gap-3 border-b bg-muted/20 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base">{copy.taskStream.title}</CardTitle>
          <CardDescription>{copy.taskStream.description}</CardDescription>
        </div>
        <Tabs value={filter} onValueChange={(value) => setFilter(value as StreamFilter)}>
          <TabsList className="flex-wrap rounded-full">
            {STREAM_FILTERS.map((key) => (
              <TabsTrigger key={key} value={key} className="rounded-full">
                {copy.taskStream.filters[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <InboxIcon className="size-6 text-muted-foreground/50" aria-hidden />
            <p className="text-sm text-muted-foreground">{copy.taskStream.empty}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => {
              const Icon = LANE_ICON[row.lane];
              const tone = LANE_BADGE[row.lane];
              return (
                <li key={`${row.lane}-${row.taskId}`} className="flex items-start justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        tone === "warning"
                          ? "text-amber-500"
                          : tone === "info"
                            ? "animate-spin text-sky-500"
                            : "text-emerald-500",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          variant={tone === "success" ? "secondary" : "outline"}
                          className={cn(
                            "shrink-0",
                            tone === "warning" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
                            tone === "info" && "border-sky-500/40 text-sky-600 dark:text-sky-400",
                          )}
                        >
                          {copy.taskStream.lane[row.lane]}
                        </Badge>
                        <span className="truncate text-sm font-medium">{row.title}</span>
                      </div>
                      {row.output ? (
                        <OutputLink output={row.output} />
                      ) : row.detail ? (
                        <p className="truncate text-xs text-muted-foreground">{row.detail}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.at ? (
                      <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                        {formatRelative(row.at, copy.time)}
                      </span>
                    ) : null}
                    <Button asChild size="sm" variant={row.lane === "attention" ? "outline" : "ghost"}>
                      <LocalizedLink href={row.href}>{row.action}</LocalizedLink>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export function DashboardPage({ data, copy, workspaceId = data.workspaceId }: DashboardPageProps) {
  const { focusTask, needsAttention, inProgress, autoCompleted, totalAutoCompleted, recentEvents } = data;
  const { regenerate } = useDashboardAiBriefGeneration({ workspaceId, aiBrief: data.aiBrief });

  const completedToday = useMemo(() => {
    const dayStart = startOfToday();
    return autoCompleted.filter(
      (item) => item.completedAt && new Date(item.completedAt).getTime() >= dayStart,
    ).length;
  }, [autoCompleted]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <HeadlineBanner
        copy={copy}
        completedToday={completedToday}
        attentionCount={needsAttention.length}
        inProgressCount={inProgress.length}
        totalAutoCompleted={totalAutoCompleted}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="min-w-0 space-y-5">
          <DigestModule
            copy={copy}
            completed={autoCompleted}
            totalAutoCompleted={totalAutoCompleted}
            aiBrief={data.aiBrief}
            onRegenerate={regenerate}
          />
          <TaskStreamCard
            copy={copy}
            attention={needsAttention}
            inProgress={inProgress}
            completed={autoCompleted}
          />
        </div>

        <aside className="min-w-0 space-y-5 xl:sticky xl:top-6 xl:self-start">
          <FocusCard task={focusTask} copy={copy} />
          <NeedsYouCard copy={copy} items={needsAttention} />
          <InProgressCard copy={copy} items={inProgress} />
          <ActivityFeedCard copy={copy} events={recentEvents} />
        </aside>
      </div>
    </div>
  );
}
