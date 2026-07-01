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
  DashboardData,
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
          <LocalizedLink href={`/tasks/${task.taskId}`}>
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
  const visibleItems = items.slice(0, 5);

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
        {visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-6 text-emerald-500/70" aria-hidden />
            <p className="text-sm text-muted-foreground">{copy.attention.empty}</p>
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
                        <Badge variant="outline" className="shrink-0">{copy.attention.kind[item.kind]}</Badge>
                      </div>
                      {item.reason ? <p className="line-clamp-2 text-xs text-muted-foreground">{item.reason}</p> : null}
                      {item.latestOutput ? <OutputLink output={item.latestOutput} /> : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pl-6">
                    <span className="text-xs tabular-nums text-muted-foreground">{formatRelative(item.updatedAt, copy.time)}</span>
                    <Button asChild size="sm" variant="default" className="shrink-0 shadow-sm">
                      <LocalizedLink href={`/tasks/${item.taskId}`}>
                        {copy.nextStep[item.nextStep]}
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
    if (input.aiBrief?.status === "dirty" && input.aiBrief.canGenerate) {
      void generate(false);
    }
  }, [input.aiBrief?.status, input.aiBrief?.canGenerate, input.aiBrief?.inputFingerprint, input.workspaceId]);

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
      <UiSurfaceFrame kind="ai-authored" label={copy.digest.title} className="overflow-hidden p-0" bodyClassName="min-w-0">
        <CardHeader className="gap-4 border-b bg-muted/20 pb-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="size-5 text-primary" aria-hidden />
              {copy.digest.title}
            </CardTitle>
            <CardDescription>{copy.digest.description}</CardDescription>
          </div>
          <DashboardAiBriefStatus aiBrief={aiBrief} copy={copy.digest.aiBrief} onRegenerate={onRegenerate} />
        </CardHeader>
        <CardContent className="p-5">
          <SpecRenderer spec={aiBrief.spec as UiDocument} fallback={null} />
        </CardContent>
      </UiSurfaceFrame>
    );
  }

  return (
    <Card className="overflow-hidden border-dashed bg-muted/20">
      <CardHeader className="gap-3 pb-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="size-5 text-primary" aria-hidden />
            {copy.digest.title}
          </CardTitle>
          <CardDescription>{copy.digest.description}</CardDescription>
        </div>
        <DashboardAiBriefStatus aiBrief={aiBrief} copy={copy.digest.aiBrief} onRegenerate={onRegenerate} />
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center gap-2 px-5 pb-8 pt-2 text-center">
        {isGenerating ? (
          <>
            <Loader2 className="size-7 animate-spin text-primary" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">{copy.digest.aiBrief.generating}</p>
          </>
        ) : (
          <>
            <Sparkles className="size-7 text-muted-foreground/50" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">{copy.digest.empty}</p>
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


/* ── Page ─────────────────────────────────────────────────────────────────── */
export function DashboardPage({ data, copy, workspaceId = data.workspaceId }: DashboardPageProps) {
  const { focusTask, needsAttention, inProgress, autoCompleted, totalAutoCompleted } = data;
  const { isGenerating, regenerate } = useDashboardAiBriefGeneration({ workspaceId, aiBrief: data.aiBrief });

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
            aiBrief={data.aiBrief}
            onRegenerate={regenerate}
            isGenerating={isGenerating}
          />
        </div>

        <aside className="min-w-0 space-y-5 xl:sticky xl:top-6 xl:self-start">
          <FocusCard task={focusTask} copy={copy} />
          <NeedsYouCard copy={copy} items={needsAttention} />
          <InProgressCard copy={copy} items={inProgress} />
        </aside>
      </div>
    </div>
  );
}
