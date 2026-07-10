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
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  type LucideProps,
} from "lucide-react";

import type { Dictionary } from "@/pages";
import { useRevalidator } from "react-router-dom";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { apiJson } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UiSurfaceFrame } from "@/components/ai-surface/ui-surface-frame";
import { SpecRenderer } from "@/components/tasks/workspace/catalog/spec-renderer";
import type { UiDocument } from "@chrona/ui-protocol";
import { cn } from "@/lib/utils";
import type {
  DashboardAttentionItem,
  DashboardCompletedItem,
  DashboardData,
  DashboardEvent,
  DashboardInProgressItem,
  DashboardOutput,
} from "./dashboard-types";
type DashboardUpcomingItem = NonNullable<DashboardData["upcomingToday"]>[number];

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
      href={`/tasks/${output.taskId}`}
      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border bg-background px-2 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
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
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-2xl border bg-background/80 px-4 py-3 backdrop-blur transition-colors",
        value === 0 ? "shadow-none opacity-70" : "shadow-sm",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          value === 0 && "bg-muted text-muted-foreground",
          value > 0 && tone === "primary" && "bg-primary/10 text-primary",
          value > 0 && tone === "warning" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          value > 0 && tone === "success" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          value > 0 && tone === "info" && "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className={cn("font-semibold tabular-nums tracking-tight", value === 0 ? "text-xl text-muted-foreground" : "text-2xl")}>{value}</p>
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


function NeedsYouCard({
  copy,
  items,
}: {
  copy: DashboardCopy;
  items: DashboardAttentionItem[];
}) {
  const visibleItems = items.slice(0, 5);
  const hasItems = visibleItems.length > 0;

  return (
    <Card className={cn("shadow-sm", hasItems ? "border-amber-500/40 bg-amber-500/[0.04]" : "bg-background")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className={cn("size-4", hasItems ? "text-amber-500" : "text-muted-foreground")} aria-hidden />
              {copy.attention.title}
            </CardTitle>
            <CardDescription>
              {hasItems ? copy.summary.pending.replace("{n}", String(items.length)) : copy.summary.none}
            </CardDescription>
          </div>
          <Badge variant={hasItems ? "default" : "secondary"}>{copy.summary.title}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {!hasItems ? (
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-500/70" aria-hidden />
            <span>{copy.attention.empty}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {visibleItems.map((item) => {
              const Icon = ATTENTION_ICON[item.kind];
              const tone = ATTENTION_TONE[item.kind];
              return (
                <li key={item.taskId} className="flex flex-col gap-2 py-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        tone === "danger" ? "text-destructive" : tone === "warning" ? "text-amber-500" : "text-sky-500",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        <Badge variant="outline" className="shrink-0">{item.stateView.label}</Badge>
                      </div>
                      {item.reason ? <p className="line-clamp-2 text-xs text-muted-foreground">{item.reason}</p> : null}
                      {item.latestOutput ? <OutputLink output={item.latestOutput} /> : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pl-6">
                    <span className="text-xs tabular-nums text-muted-foreground">{formatRelative(item.updatedAt, copy.time)}</span>
                    <Button asChild size="sm" variant="default" className="shrink-0 shadow-sm">
                      <LocalizedLink href={`/tasks/${item.taskId}`}>
                        {item.stateView.nextActionLabel}
                        <ArrowRight className="size-4" aria-hidden />
                      </LocalizedLink>
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

/* ── AI dashboard summary ─────────────────────────────────────────────────── */
function DashboardAiBriefStatus({
  aiBrief,
  copy,
}: {
  aiBrief: DashboardData["aiBrief"];
  copy: DashboardCopy["digest"]["aiBrief"];
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
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
      {aiBrief.status === "generating" ? <Loader2 className="size-3 animate-spin text-primary" aria-hidden /> : null}
      <span className="truncate font-medium text-foreground/80">{label}</span>
      {aiBrief.errorMessage ? <span className="truncate"> · {aiBrief.errorMessage}</span> : null}
    </span>
  );
}

function DashboardAiBriefGenerateButton({
  aiBrief,
  copy,
  onRegenerate,
  isGenerating,
}: {
  aiBrief: DashboardData["aiBrief"];
  copy: DashboardCopy["digest"]["aiBrief"];
  onRegenerate: () => void;
  isGenerating: boolean;
}) {
  if (!aiBrief?.canGenerate) return null;

  return (
    <Button size="sm" variant="outline" onClick={onRegenerate} disabled={isGenerating} className="h-8 rounded-full bg-background/80 px-3 shadow-sm">
      {isGenerating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
      {copy.regenerate}
    </Button>
  );
}

function useDashboardAiBriefGeneration(input: {
  workspaceId: string;
  aiBrief: DashboardData["aiBrief"];
}) {
  const enabled = input.aiBrief?.status !== "disabled";

  const revalidator = useRevalidator();
  const inFlightKeyRef = useRef<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = async (force = false) => {
    const key = force ? `force:${input.aiBrief?.inputFingerprint ?? "unknown"}` : input.aiBrief?.inputFingerprint;
    if (!key || inFlightKeyRef.current === key) return;
    inFlightKeyRef.current = key;
    setIsGenerating(true);
    try {
      await apiJson(`/api/pages/dashboard/ai-brief/generate?workspaceId=${encodeURIComponent(input.workspaceId)}`, {
        method: "POST",
        body: JSON.stringify({ force }),
      });
      void revalidator.revalidate();
    } finally {
      inFlightKeyRef.current = null;
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (enabled && input.aiBrief?.status === "dirty" && input.aiBrief.canGenerate) {
      void generate(false);
    }
  }, [enabled, input.aiBrief?.status, input.aiBrief?.canGenerate, input.aiBrief?.inputFingerprint, input.workspaceId]);

  return { isGenerating: isGenerating || input.aiBrief?.status === "generating", regenerate: () => void generate(true) };
}



function DigestModule({
  copy,
  aiBrief,
  onRegenerate,
  isGenerating,
}: {
  copy: DashboardCopy;
  aiBrief: DashboardData["aiBrief"];
  onRegenerate: () => void;
  isGenerating: boolean;
}) {
  if (aiBrief?.spec) {
    return (
      <UiSurfaceFrame kind="ai-authored" label={copy.digest.title} className="overflow-hidden border-violet-200/70 bg-gradient-to-br from-background via-background to-violet-50/45 p-0 shadow-sm dark:border-violet-400/25 dark:to-violet-950/10" bodyClassName="min-w-0">
        <CardHeader className="flex flex-col gap-3 border-b border-border/50 bg-background/60 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <CardTitle className="text-base font-semibold tracking-tight sm:text-lg">{copy.digest.title}</CardTitle>
              <DashboardAiBriefStatus aiBrief={aiBrief} copy={copy.digest.aiBrief} />
            </div>
            <CardDescription className="max-w-2xl text-sm leading-relaxed">{copy.digest.description}</CardDescription>
          </div>
          <DashboardAiBriefGenerateButton aiBrief={aiBrief} copy={copy.digest.aiBrief} onRegenerate={onRegenerate} isGenerating={isGenerating} />
        </CardHeader>
        <CardContent className="bg-background/45 p-4 sm:p-5">
          <SpecRenderer spec={aiBrief.spec as UiDocument} fallback={null} />
        </CardContent>
      </UiSurfaceFrame>
    );
  }

  return (
    <Card className="overflow-hidden border-dashed bg-gradient-to-br from-muted/20 via-background to-primary/5 shadow-sm">
      <CardHeader className="flex flex-col gap-3 border-b border-border/50 bg-background/55 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <CardTitle className="text-base font-semibold tracking-tight sm:text-lg">{copy.digest.title}</CardTitle>
            <DashboardAiBriefStatus aiBrief={aiBrief} copy={copy.digest.aiBrief} />
          </div>
          <CardDescription className="max-w-2xl text-sm leading-relaxed">{copy.digest.description}</CardDescription>
        </div>
        <DashboardAiBriefGenerateButton aiBrief={aiBrief} copy={copy.digest.aiBrief} onRegenerate={onRegenerate} isGenerating={isGenerating} />
      </CardHeader>
      <CardContent className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-5 py-8 text-center">
        {isGenerating ? (
          <>
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Loader2 className="size-6 animate-spin" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">{copy.digest.aiBrief.generating}</p>
          </>
        ) : (
          <>
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground/70">
              <Sparkles className="size-6" aria-hidden />
            </span>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{copy.digest.empty}</p>
          </>
        )}
      </CardContent>
    </Card>
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
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <Clock className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
            <span>{copy.inProgress.empty}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.taskId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Loader2 className="size-4 shrink-0 animate-spin text-sky-500" aria-hidden />
                  <span className="truncate text-sm font-medium">{item.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.stateView.label}{item.stage ? ` · ${item.stage}` : ""}</span>
                </div>
                <Button asChild size="sm" variant="ghost" className="shrink-0">
                  <LocalizedLink href={`/tasks/${item.taskId}`}>{copy.openTask}</LocalizedLink>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentCompletionsCard({
  copy,
  items,
}: {
  copy: DashboardCopy;
  items: DashboardCompletedItem[];
}) {
  const visibleItems = items.slice(0, 5);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
          {copy.completed.title}
        </CardTitle>
        <CardDescription>{copy.completed.totalLabel.replace("{n}", String(items.length))}</CardDescription>
      </CardHeader>
      <CardContent>
        {visibleItems.length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <Sparkles className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
            <span>{copy.completed.empty}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {visibleItems.map((item) => (
              <li key={item.taskId} className="space-y-1 py-2.5">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{item.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatRelative(item.completedAt, copy.time)}</span>
                </div>
                {item.summary ? <p className="line-clamp-2 text-xs text-muted-foreground">{item.summary}</p> : null}
                {item.output ? <OutputLink output={item.output} /> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function UpcomingTodayCard({ copy, items }: { copy: DashboardCopy; items: DashboardUpcomingItem[] }) {
  const visibleItems = items.slice(0, 5);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-sky-500" aria-hidden />
          {copy.upcomingToday.title}
        </CardTitle>
        <CardDescription>{copy.upcomingToday.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {visibleItems.length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-500/70" aria-hidden />
            <span>{copy.upcomingToday.empty}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {visibleItems.map((item) => (
              <li key={item.taskId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.stateView.label}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="tabular-nums">
                    {formatTime(item.scheduledStartAt ?? item.dueAt)}
                  </Badge>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <LocalizedLink href={`/tasks/${item.taskId}`}>{copy.upcomingToday.open}</LocalizedLink>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
function feedCategoryLabel(copy: DashboardCopy, category: DashboardEvent["category"]) {
  return typeof category === "string" && category in copy.feed.category
    ? copy.feed.category[category as keyof DashboardCopy["feed"]["category"]]
    : category;
}

function RecentActivitySection({ copy, events }: { copy: DashboardCopy; events: DashboardEvent[] }) {
  const visibleEvents = events.slice(0, 8);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{copy.feed.title}</CardTitle>
        <CardDescription>{copy.feed.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {visibleEvents.length === 0 ? (
          <div className="rounded-2xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{copy.feed.empty}</div>
        ) : (
          <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-2 before:top-3 before:w-px before:bg-border">
            {visibleEvents.map((event) => (
              <li key={event.id} className="relative flex gap-3 pl-6">
                <span className="absolute left-0 top-1.5 size-4 rounded-full border-2 border-background bg-primary" aria-hidden />
                <div className="min-w-0 flex-1 rounded-2xl border bg-background px-3 py-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="outline">{feedCategoryLabel(copy, event.category)}</Badge>
                    <LocalizedLink href={`/tasks/${event.taskId}`} className="min-w-0 truncate text-sm font-medium hover:text-primary">
                      {event.taskTitle}
                    </LocalizedLink>
                    <span className="text-xs tabular-nums text-muted-foreground">{formatRelative(event.at, copy.time)}</span>
                  </div>
                  {event.summary ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{event.summary}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}


/* ── Page ─────────────────────────────────────────────────────────────────── */
export function DashboardPage({ data, copy, workspaceId = data.workspaceId }: DashboardPageProps) {
  const { needsAttention, inProgress, upcomingToday, autoCompleted, recentEvents, totalAutoCompleted } = data;
  const { isGenerating, regenerate } = useDashboardAiBriefGeneration({ workspaceId, aiBrief: data.aiBrief });

  const completedToday = useMemo(() => {
    const dayStart = startOfToday();
    return autoCompleted.filter(
      (item) => item.completedAt && new Date(item.completedAt).getTime() >= dayStart,
    ).length;
  }, [autoCompleted]);

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-[2rem] border border-border bg-surface-soft/80 p-3 sm:p-4">
      <div className="mx-auto w-full max-w-[1280px] space-y-6">
        <HeadlineBanner
          copy={copy}
          completedToday={completedToday}
          attentionCount={needsAttention.length}
          inProgressCount={inProgress.length}
          totalAutoCompleted={totalAutoCompleted}
        />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="min-w-0 space-y-5">
          {data.aiBrief?.status !== "disabled" ? (
            <DigestModule
              copy={copy}
              aiBrief={data.aiBrief}
              onRegenerate={regenerate}
              isGenerating={isGenerating}
            />
          ) : null}
          <RecentActivitySection copy={copy} events={recentEvents} />
        </div>

        <aside className="min-w-0 space-y-5 xl:sticky xl:top-6 xl:self-start">
          <NeedsYouCard copy={copy} items={needsAttention} />
          <UpcomingTodayCard copy={copy} items={upcomingToday} />
          <InProgressCard copy={copy} items={inProgress} />
          <RecentCompletionsCard copy={copy} items={autoCompleted} />
        </aside>
      </div>
    </div>
    </div>
  );
}
