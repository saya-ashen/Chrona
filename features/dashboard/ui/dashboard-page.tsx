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
  Sparkles,
  type LucideProps,
} from "lucide-react";
import { deriveAttentionDescriptor } from "@chrona/domain";

import type { Messages } from "@chrona/i18n";
import { useRevalidator } from "react-router-dom";
import { LocalizedLink } from "./localized-link";
import { apiJson } from "@shared/http"
import { Badge } from "@shared/ui"
import { Button } from "@shared/ui"
import { Card,
CardContent,
CardDescription,
CardHeader,
CardTitle, } from "@shared/ui"
import { PageFrame } from "@shared/ui"
import { PageHeader } from "@shared/ui"
import { UiSurfaceFrame } from "@shared/ui"
import { SpecRenderer } from "@features/task-workspace";
import type { UiDocument } from "@chrona/ui-protocol";
import { cn } from "@shared/ui"
import type {
  DashboardAttentionItem,
  DashboardCompletedItem,
  DashboardData,
  DashboardEvent,
  DashboardInProgressItem,
  DashboardOutput,
} from "../model/dashboard-types";
type DashboardUpcomingItem = NonNullable<
  DashboardData["upcomingToday"]
>[number];

type DashboardCopy = Messages["pages"]["dashboard"];

type DashboardPageProps = {
  data: DashboardData;
  copy: DashboardCopy;
  workspaceId?: string;
};

function attentionDescriptor(item: DashboardAttentionItem) {
  return deriveAttentionDescriptor({
    stateView: item.stateView,
    itemKind: item.kind === "schedule_risk" ? "task_due_soon" : item.kind,
    riskLevel: item.kind === "schedule_risk" ? "medium" : undefined,
  });
}


function attentionIcon(
  item: DashboardAttentionItem,
): ComponentType<LucideProps> {
  if (item.kind === "schedule_risk") return Clock;
  if (item.stateView.state === "waiting_for_approval") return CircleAlert;
  if (item.stateView.state === "waiting_for_input") return MessageSquare;
  return AlertTriangle;
}

function isDashboardAttention(item: DashboardAttentionItem): boolean {
  return attentionDescriptor(item).attentionRequired;
}

function stateToneClass(
  tone: DashboardAttentionItem["stateView"]["tone"],
): string {
  if (tone === "danger") return "text-destructive";
  if (tone === "warning") return "text-amber-500";
  if (tone === "success") return "text-emerald-500";
  if (tone === "info") return "text-sky-500";
  return "text-muted-foreground";
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
    template,
  );
}

function formatRelative(
  value: string | null,
  copy: DashboardCopy["time"],
): string {
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
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
        "flex min-w-0 items-center gap-2 border-r border-border/70 px-3 py-1.5 last:border-r-0 sm:px-4",
        value === 0 && "opacity-60",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md",
          value === 0 && "bg-muted text-muted-foreground",
          value > 0 && tone === "primary" && "bg-primary/10 text-primary",
          value > 0 &&
            tone === "warning" &&
            "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          value > 0 &&
            tone === "success" &&
            "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          value > 0 &&
            tone === "info" &&
            "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "font-semibold tabular-nums tracking-tight",
            value === 0 ? "text-xl text-muted-foreground" : "text-2xl",
          )}
        >
          {value}
        </p>
        <p className="text-xs leading-tight text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function HeadlineBanner({
  copy,
  completedToday,
  attentionCount,
  inProgressCount,
}: {
  copy: DashboardCopy;
  completedToday: number;
  attentionCount: number;
  inProgressCount: number;
}) {
  let sentence: string;
  if (completedToday > 0 && attentionCount > 0) {
    sentence = fillTemplate(copy.headline.both, {
      completed: completedToday,
      completedTaskLabel:
        completedToday === 1
          ? copy.headline.completedTask
          : copy.headline.completedTasks,
      attentionSubject:
        attentionCount === 1
          ? copy.headline.attentionTask
          : copy.headline.attentionTasks,
    });
  } else if (completedToday > 0) {
    sentence = fillTemplate(copy.headline.completedOnly, {
      completed: completedToday,
      completedTaskLabel:
        completedToday === 1
          ? copy.headline.completedTask
          : copy.headline.completedTasks,
    });
  } else if (attentionCount > 0) {
    sentence = fillTemplate(copy.headline.attentionOnly, {
      attention: attentionCount,
      attentionSubject:
        attentionCount === 1
          ? copy.headline.attentionTask
          : copy.headline.attentionTasks,
    });
  } else {
    sentence = copy.headline.idle;
  }

  return (
    <PageHeader
      eyebrow={copy.subtitle}
      title={copy.title}
      description={sentence}
      actions={
        <div className="grid shrink-0 grid-cols-3 overflow-hidden rounded-lg border bg-panel py-1">
          <MetricPill
            icon={AlertTriangle}
            label={copy.summary.title}
            value={attentionCount}
            tone="warning"
          />
          <MetricPill
            icon={Loader2}
            label={copy.inProgress.title}
            value={inProgressCount}
            tone="info"
          />
          <MetricPill
            icon={CheckCircle2}
            label={copy.headline.completedToday}
            value={completedToday}
            tone="success"
          />
        </div>
      }
    />
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
    <Card
      className={cn(
        hasItems ? "border-amber-500/40 bg-amber-500/[0.04]" : "bg-background",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle
                className={cn(
                  "size-4",
                  hasItems ? "text-amber-500" : "text-muted-foreground",
                )}
                aria-hidden
              />
              {copy.attention.title}
            </CardTitle>
            <CardDescription>
              {hasItems
                ? copy.summary.pending.replace("{n}", String(items.length))
                : copy.summary.none}
            </CardDescription>
          </div>
          <Badge variant={hasItems ? "default" : "secondary"}>
            {copy.summary.title}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {!hasItems ? (
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <CheckCircle2
              className="size-4 shrink-0 text-emerald-500/70"
              aria-hidden
            />
            <span>{copy.attention.empty}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {visibleItems.map((item) => {
              const actionLabel =
                item.kind === "approval"
                  ? copy.nextStep.approve_or_edit
                  : item.kind === "input"
                    ? copy.nextStep.provide_input
                    : item.kind === "blocked" || item.kind === "failed"
                      ? copy.nextStep.resolve_block
                      : copy.openTask
              const Icon = attentionIcon(item);
              const descriptor = attentionDescriptor(item);
              const tone = descriptor.tone;
              return (
                <li key={item.taskId} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        stateToneClass(tone),
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 text-sm font-medium">
                          {item.title}
                        </span>
                        <Badge variant="outline" className="shrink-0">
                          {descriptor.label}
                        </Badge>
                      </div>
                      {item.reason ? (
                        <p className="line-clamp-2 max-w-3xl break-words text-sm leading-5 text-muted-foreground">
                          {item.reason}
                        </p>
                      ) : null}
                      {item.latestOutput ? (
                        <OutputLink output={item.latestOutput} />
                      ) : null}
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-3 pl-6 sm:flex-col sm:items-end sm:justify-center sm:pl-0">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatRelative(item.updatedAt, copy.time)}
                    </span>
                    <Button asChild size="sm" variant="default" className="min-h-10 shrink-0">
                      <LocalizedLink href={`/tasks/${item.taskId}`}>
                        {actionLabel}
                        <ArrowRight className="size-4 shrink-0" aria-hidden />
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
      {aiBrief.status === "generating" ? (
        <Loader2 className="size-3 animate-spin text-primary" aria-hidden />
      ) : null}
      <span className="truncate font-medium text-foreground/80">{label}</span>
      {aiBrief.errorMessage ? (
        <span className="truncate"> · {aiBrief.errorMessage}</span>
      ) : null}
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
    <Button
      size="sm"
      variant="outline"
      onClick={onRegenerate}
      disabled={isGenerating}
      className="h-8 rounded-full bg-background/80 px-3 shadow-sm"
    >
      {isGenerating ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="size-3.5" aria-hidden />
      )}
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
    const key = force
      ? `force:${input.aiBrief?.inputFingerprint ?? "unknown"}`
      : input.aiBrief?.inputFingerprint;
    if (!key || inFlightKeyRef.current === key) return;
    inFlightKeyRef.current = key;
    setIsGenerating(true);
    try {
      await apiJson(
        `/api/pages/dashboard/ai-brief/generate?workspaceId=${encodeURIComponent(input.workspaceId)}`,
        {
          method: "POST",
          body: JSON.stringify({ force }),
        },
      );
      void revalidator.revalidate();
    } finally {
      inFlightKeyRef.current = null;
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (
      enabled &&
      input.aiBrief?.status === "dirty" &&
      input.aiBrief.canGenerate
    ) {
      void generate(false);
    }
  }, [
    enabled,
    input.aiBrief?.status,
    input.aiBrief?.canGenerate,
    input.aiBrief?.inputFingerprint,
    input.workspaceId,
  ]);

  return {
    isGenerating: isGenerating || input.aiBrief?.status === "generating",
    regenerate: () => void generate(true),
  };
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
      <UiSurfaceFrame
        kind="ai-authored"
        label={copy.digest.title}
        className="overflow-hidden border-violet-200/70 bg-gradient-to-br from-background via-background to-violet-50/45 p-0 shadow-sm dark:border-violet-400/25 dark:to-violet-950/10"
        bodyClassName="min-w-0"
      >
        <CardHeader className="flex flex-col gap-3 border-b border-border/50 bg-background/60 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <CardTitle className="text-base font-semibold tracking-tight sm:text-lg">
                {copy.digest.title}
              </CardTitle>
              <DashboardAiBriefStatus
                aiBrief={aiBrief}
                copy={copy.digest.aiBrief}
              />
            </div>
            <CardDescription className="max-w-2xl text-sm leading-relaxed">
              {copy.digest.description}
            </CardDescription>
          </div>
          <DashboardAiBriefGenerateButton
            aiBrief={aiBrief}
            copy={copy.digest.aiBrief}
            onRegenerate={onRegenerate}
            isGenerating={isGenerating}
          />
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
            <CardTitle className="text-base font-semibold tracking-tight sm:text-lg">
              {copy.digest.title}
            </CardTitle>
            <DashboardAiBriefStatus
              aiBrief={aiBrief}
              copy={copy.digest.aiBrief}
            />
          </div>
          <CardDescription className="max-w-2xl text-sm leading-relaxed">
            {copy.digest.description}
          </CardDescription>
        </div>
        <DashboardAiBriefGenerateButton
          aiBrief={aiBrief}
          copy={copy.digest.aiBrief}
          onRegenerate={onRegenerate}
          isGenerating={isGenerating}
        />
      </CardHeader>
      <CardContent className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-5 py-8 text-center">
        {isGenerating ? (
          <>
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Loader2 className="size-6 animate-spin" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              {copy.digest.aiBrief.generating}
            </p>
          </>
        ) : (
          <>
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground/70">
              <Sparkles className="size-6" aria-hidden />
            </span>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              {copy.digest.empty}
            </p>
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
    <Card size="sm" className="bg-panel shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Loader2 className="size-4 text-sky-500" aria-hidden />
          {copy.inProgress.title}
        </CardTitle>
        <CardDescription>{copy.inProgress.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
            <Clock
              className="size-4 shrink-0 text-muted-foreground/70"
              aria-hidden
            />
            <span>{copy.inProgress.empty}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li
                key={item.taskId}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Loader2
                    className="size-4 shrink-0 animate-spin text-sky-500"
                    aria-hidden
                  />
                  <span className="truncate text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.stateView.label}
                    {item.stage ? ` · ${item.stage}` : ""}
                  </span>
                </div>
                <Button asChild size="sm" variant="ghost" className="shrink-0">
                  <LocalizedLink href={`/tasks/${item.taskId}`}>
                    {copy.openTask}
                  </LocalizedLink>
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
    <Card size="sm" className="bg-panel shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
          {copy.completed.title}
        </CardTitle>
        <CardDescription>
          {copy.completed.totalLabel.replace("{n}", String(items.length))}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {visibleItems.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
            <Sparkles
              className="size-4 shrink-0 text-muted-foreground/70"
              aria-hidden
            />
            <span>{copy.completed.empty}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {visibleItems.map((item) => (
              <li key={item.taskId} className="space-y-1 py-2.5">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatRelative(item.completedAt, copy.time)}
                  </span>
                </div>
                {item.summary ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {item.summary}
                  </p>
                ) : null}
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
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UpcomingTodayCard({
  copy,
  items,
}: {
  copy: DashboardCopy;
  items: DashboardUpcomingItem[];
}) {
  const visibleItems = items.slice(0, 5);

  return (
    <Card size="sm" className="bg-panel shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-sky-500" aria-hidden />
          {copy.upcomingToday.title}
        </CardTitle>
        <CardDescription>{copy.upcomingToday.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {visibleItems.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
            <CheckCircle2
              className="size-4 shrink-0 text-emerald-500/70"
              aria-hidden
            />
            <span>{copy.upcomingToday.empty}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {visibleItems.map((item) => (
              <li
                key={item.taskId}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.stateView.label}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="tabular-nums">
                    {formatTime(item.scheduledStartAt ?? item.dueAt)}
                  </Badge>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                  >
                    <LocalizedLink href={`/tasks/${item.taskId}`}>
                      {copy.upcomingToday.open}
                    </LocalizedLink>
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
function feedCategoryLabel(
  copy: DashboardCopy,
  category: DashboardEvent["category"],
) {
  return typeof category === "string" && category in copy.feed.category
    ? copy.feed.category[category as keyof DashboardCopy["feed"]["category"]]
    : category;
}

function RecentActivitySection({
  copy,
  events,
}: {
  copy: DashboardCopy;
  events: DashboardEvent[];
}) {
  const visibleEvents = events.slice(0, 8);

  return (
    <Card className="bg-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{copy.feed.title}</CardTitle>
        <CardDescription>{copy.feed.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {visibleEvents.length === 0 ? (
          <div className="border-t px-1 py-3 text-sm text-muted-foreground">
            {copy.feed.empty}
          </div>
        ) : (
          <ol className="divide-y border-t">
            {visibleEvents.map((event) => (
              <li key={event.id} className="grid gap-1 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start sm:gap-3">
                <Badge variant="outline" className="w-fit">
                  {feedCategoryLabel(copy, event.category)}
                </Badge>
                <div className="min-w-0">
                  <LocalizedLink
                    href={`/tasks/${event.taskId}`}
                    className="block min-w-0 truncate text-sm font-medium hover:text-primary"
                  >
                    {event.taskTitle}
                  </LocalizedLink>
                  {event.summary ? (
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                      {event.summary}
                    </p>
                  ) : null}
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatRelative(event.at, copy.time)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export function DashboardPage({
  data,
  copy,
  workspaceId = data.workspaceId,
}: DashboardPageProps) {
  const { upcomingToday, autoCompleted, recentEvents } = data;
  const needsAttention = useMemo(
    () => data.needsAttention.filter(isDashboardAttention),
    [data.needsAttention],
  );
  const inProgress = useMemo(
    () => data.inProgress.filter((item) => item.stateView.showLiveProgress),
    [data.inProgress],
  );
  const { isGenerating, regenerate } = useDashboardAiBriefGeneration({
    workspaceId,
    aiBrief: data.aiBrief,
  });

  const completedToday = useMemo(() => {
    const dayStart = startOfToday();
    return autoCompleted.filter(
      (item) =>
        item.completedAt && new Date(item.completedAt).getTime() >= dayStart,
    ).length;
  }, [autoCompleted]);

  return (
    <PageFrame mode="overview" data-domain="dashboard" className="p-1 sm:p-2">
      <div className="w-full space-y-4 sm:space-y-5">
        <HeadlineBanner
          copy={copy}
          completedToday={completedToday}
          attentionCount={needsAttention.length}
          inProgressCount={inProgress.length}
        />

        {needsAttention.length > 0 ? (
          <NeedsYouCard copy={copy} items={needsAttention} />
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <InProgressCard copy={copy} items={inProgress} />
          <UpcomingTodayCard copy={copy} items={upcomingToday} />
          <RecentCompletionsCard copy={copy} items={autoCompleted} />
        </div>

        <div className={`grid grid-cols-1 gap-4 ${data.aiBrief?.status !== "disabled" ? "xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]" : ""}`}>
          <RecentActivitySection copy={copy} events={recentEvents} />
          {data.aiBrief?.status !== "disabled" ? (
            <DigestModule
              copy={copy}
              aiBrief={data.aiBrief}
              onRegenerate={regenerate}
              isGenerating={isGenerating}
            />
          ) : null}
        </div>
      </div>
    </PageFrame>
  );
}
