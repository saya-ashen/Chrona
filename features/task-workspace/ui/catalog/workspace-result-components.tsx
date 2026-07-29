import { useState } from "react";
import { Badge, Button, cn } from "@shared/ui";
import { useI18n } from "@chrona/i18n";
import { BookOpenText, Check, Clock3, Copy, Sparkles, TriangleAlert } from "lucide-react";
import { stringField, stringProp } from "./workspace-registry-utilities";
import { CollapsibleBlock } from "./workspace-collapse";

export function ResultSummary({
  props,
}: {
  props: { text?: string | null; copyText?: string | null };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const [copied, setCopied] = useState(false);
  const text = typeof props.text === "string" ? props.text.trim() : "";
  const copyText =
    typeof props.copyText === "string" && props.copyText.trim()
      ? props.copyText
      : text;
  if (!text) return null;

  const copyLabel = copied
    ? (copy.resultSummaryCopied ?? "Copied")
    : (copy.copyResultSummary ?? "Copy summary");

  return (
    <section
      aria-label={copy.resultSummaryLabel ?? "Result summary"}
      className="space-y-2.5 border-b border-border/70 pb-3.5 text-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary ring-1 ring-primary/20">
            <Check className="size-3.5" aria-hidden="true" />
          </span>
          <h2 className="font-heading text-[1.05rem] font-semibold leading-none tracking-[-0.01em] text-foreground sm:text-lg">
            {copy.resultSummaryLabel ?? "Result summary"}
          </h2>
        </div>
        {copyText ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              void navigator.clipboard?.writeText(copyText).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              });
            }}
          >
            <Copy className="size-3.5" aria-hidden="true" />
            {copyLabel}
          </Button>
        ) : null}
      </div>
      <p className="max-w-3xl text-[15px] font-normal leading-7 text-foreground/80 tracking-[-0.005em]">
        {text}
      </p>
    </section>
  );
}

type ResultMetric = { label: string; value: string };
type ResultActionPhase = {
  timeframe: "now" | "this_week" | "later";
  title: string;
  actions: string[];
};

const readinessPresentation = {
  ready: {
    messageKey: "resultReadinessReady",
    fallback: "Ready",
    className:
      "border-success/30 bg-success/10 text-success dark:text-success-foreground",
    iconClassName: "bg-success/15 text-success",
  },
  ready_with_caveats: {
    messageKey: "resultReadinessReadyWithCaveats",
    fallback: "Ready with caveats",
    className:
      "border-warning/35 bg-warning/10 text-warning dark:text-warning-foreground",
    iconClassName: "bg-warning/15 text-warning",
  },
  partial: {
    messageKey: "resultReadinessPartial",
    fallback: "Partially ready",
    className: "border-info/30 bg-info/10 text-info dark:text-info-foreground",
    iconClassName: "bg-info/15 text-info",
  },
  blocked: {
    messageKey: "resultReadinessBlocked",
    fallback: "Blocked",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    iconClassName: "bg-destructive/10 text-destructive",
  },
} as const;

export function ResultHero({
  props,
}: {
  props: {
    title: string;
    summary: string;
    readiness: keyof typeof readinessPresentation;
    readinessSummary: string;
    metrics?: ResultMetric[];
  };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const presentation = readinessPresentation[props.readiness];
  const readinessLabel = {
    ready: copy.resultReadinessReady ?? "Ready",
    ready_with_caveats:
      copy.resultReadinessReadyWithCaveats ?? "Ready with caveats",
    partial: copy.resultReadinessPartial ?? "Partially ready",
    blocked: copy.resultReadinessBlocked ?? "Blocked",
  }[props.readiness];
  const metrics = Array.isArray(props.metrics) ? props.metrics.slice(0, 4) : [];
  return (
    <section
      aria-label={copy.resultOverviewLabel ?? "Result overview"}
      className="min-w-0 overflow-hidden rounded-2xl border border-primary/15 bg-primary-soft/25 p-5 shadow-sm sm:p-6"
    >
      <div className="min-w-0">
        <Badge
          variant="outline"
          className={cn(
            "mb-4 gap-1.5 rounded-full px-2.5 py-1 text-xs",
            presentation.className,
          )}
        >
          <Check className="size-3.5" aria-hidden />
          {readinessLabel}
        </Badge>
        <h2 className="w-full font-heading text-2xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-[1.75rem]">
          {props.title}
        </h2>
        <p className="mt-3 w-full text-sm leading-6 text-foreground/75 sm:text-[15px] sm:leading-7">
          {props.summary}
        </p>
        <div className="mt-5 flex flex-col gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                presentation.iconClassName,
              )}
            >
              {props.readiness === "blocked" ? (
                <TriangleAlert className="size-4" aria-hidden />
              ) : (
                <Check className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {copy.resultReadinessLabel ?? "Readiness"}
              </p>
              <p className="mt-1 text-sm leading-6 text-foreground/80">
                {props.readinessSummary}
              </p>
            </div>
          </div>
          {metrics.length > 0 ? (
            <dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-3 sm:max-w-xl sm:grid-cols-4">
              {metrics.map((metric) => (
                <div
                  key={`${metric.label}:${metric.value}`}
                  className="min-w-0"
                >
                  <dd className="truncate font-heading text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {metric.value}
                  </dd>
                  <dt className="mt-0.5 text-xs leading-4 text-muted-foreground">
                    {metric.label}
                  </dt>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  );
}


export function ResultInsight({
  props,
}: {
  props: {
    title: string;
    summary: string;
    emphasis?: "lead" | "supporting";
    points?: string[];
  };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const lead = props.emphasis === "lead";
  if (lead) {
    return (
      <article
        data-result-insight-emphasis="lead"
        className="min-w-0 overflow-hidden rounded-2xl border border-info/30 bg-info/10"
      >
        <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)]">
          <div className="min-w-0 p-5 sm:p-7 lg:border-r lg:border-info/20">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-info">
              <span className="flex size-7 items-center justify-center rounded-full bg-info/15">
                <Sparkles className="size-3.5" aria-hidden />
              </span>
              {copy.resultKeyStrategy ?? "Key strategy"}
            </p>
            <h2 className="mt-5 font-heading text-2xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-[1.75rem]">
              {props.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-foreground/75 sm:text-[15px] sm:leading-7">
              {props.summary}
            </p>
          </div>
          {props.points?.length ? (
            <ol className="grid content-center gap-0 border-t border-info/20 px-5 py-3 sm:px-7 lg:border-t-0">
              {props.points.slice(0, 4).map((point, index) => (
                <li
                  key={point}
                  className="flex gap-3 border-t border-info/20 py-3.5 text-sm leading-6 text-foreground/80 first:border-t-0"
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-info/30 bg-background/70 text-[11px] font-semibold text-info">
                    {index + 1}
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </article>
    );
  }
  return (
    <article className="min-w-0 rounded-xl border border-border/70 bg-background p-4 sm:p-5">
      <h3 className="font-heading text-base font-semibold leading-snug tracking-[-0.015em] text-foreground">
        {props.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-foreground/70">
        {props.summary}
      </p>
      {props.points?.length ? (
        <ul className="mt-4 space-y-2 text-xs leading-5 text-foreground/75">
          {props.points.slice(0, 4).map((point) => (
            <li key={point} className="flex gap-2">
              <Check
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function ResultActionPlan({
  props,
}: {
  props: { title?: string; summary?: string; phases: ResultActionPhase[] };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const timeframeLabels = {
    now: copy.resultTimeframeNow ?? "Now",
    this_week: copy.resultTimeframeThisWeek ?? "This week",
    later: copy.resultTimeframeLater ?? "Later",
  };
  return (
    <section
      aria-label={props.title ?? copy.resultActionPlan ?? "Action plan"}
      className="min-w-0"
    >
      {props.title ? (
        <h2 className="font-heading text-xl font-semibold tracking-[-0.02em] text-foreground">
          {props.title}
        </h2>
      ) : null}
      {props.summary ? (
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {props.summary}
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {props.phases.slice(0, 3).map((phase, index) => (
          <article
            key={phase.timeframe}
            className="rounded-xl border border-border/70 bg-background p-4"
          >
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-primary">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-[11px]">
                {index + 1}
              </span>
              {timeframeLabels[phase.timeframe]}
            </p>
            <h3 className="mt-3 font-heading text-base font-semibold text-foreground">
              {phase.title}
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-foreground/75">
              {phase.actions.slice(0, 5).map((action) => (
                <li key={action} className="flex gap-2">
                  <Clock3
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ResultCaveats({
  props,
}: {
  props: { title?: string; items: string[] };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const title = props.title ?? copy.resultCaveats ?? "Before accepting";
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-warning/30 bg-warning/10 p-4 sm:flex-row sm:items-start"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
        <TriangleAlert className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="font-heading text-base font-semibold text-foreground">
          {title}
        </h2>
        <ul className="mt-2 grid gap-1.5 text-sm leading-5 text-foreground/80 sm:grid-cols-2 lg:grid-cols-3">
          {props.items.slice(0, 3).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ResultEvidence({
  props,
}: {
  props: {
    title?: string;
    summary?: string;
    items: string[];
    defaultCollapsed?: boolean;
  };
}) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  return (
    <div data-result-evidence-footnote className="text-muted-foreground">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
        <BookOpenText className="size-3.5" aria-hidden />
        {copy.resultEvidenceFootnote ?? "Result notes"}
      </div>
      <CollapsibleBlock
        title={
          props.title ??
          copy.resultEvidenceAndSources ??
          "Evidence and source boundaries"
        }
        summary={props.summary}
        defaultCollapsed={props.defaultCollapsed ?? true}
        subtle
      >
        <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
          {props.items.map((item) => (
            <li key={item} className="flex gap-2">
              <span
                aria-hidden
                className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-muted-foreground/60"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CollapsibleBlock>
    </div>
  );
}

export function ResultOverview({ props }: { props: Record<string, unknown> }) {
  const metrics = Array.isArray(props.metrics)
    ? props.metrics.filter(
        (item): item is { label: string; value: string } =>
          stringField(item, "label") !== undefined &&
          stringField(item, "value") !== undefined,
      )
    : [];
  return (
    <section
      className="min-w-0 rounded-2xl border border-border/70 bg-background px-5 py-6 sm:px-7"
      aria-label="Result overview"
    >
      {typeof props.eyebrow === "string" ? (
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          {props.eyebrow}
        </p>
      ) : null}
      <h2 className="mt-1 font-heading text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
        {stringProp(props.title) ?? "Result"}
      </h2>
      <p className="mt-3 max-w-4xl text-sm leading-6 text-foreground/75 sm:text-base">
        {stringProp(props.summary)}
      </p>
      {metrics.length > 0 ? (
        <dl className="mt-5 grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={`${metric.label}:${metric.value}`}>
              <dd className="font-heading text-lg font-semibold text-foreground">
                {metric.value}
              </dd>
              <dt className="mt-0.5 text-xs text-muted-foreground">
                {metric.label}
              </dt>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

export function ResultReadiness({ props }: { props: Record<string, unknown> }) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace as Record<string, string>;
  const status = (stringProp(props.status) ??
    "partial") as keyof typeof readinessPresentation;
  const presentation =
    readinessPresentation[status] ?? readinessPresentation.partial;
  const label = copy[presentation.messageKey] ?? presentation.fallback;
  const items = Array.isArray(props.items)
    ? props.items
        .filter((item): item is string => typeof item === "string")
        .slice(0, 3)
    : [];
  return (
    <aside
      className={cn(
        "min-w-0 rounded-xl border px-4 py-3",
        presentation.className,
      )}
      data-result-readiness={status}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
            presentation.iconClassName,
          )}
        >
          <Check className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em]">
            {label}
          </p>
          <p className="mt-1 text-sm leading-5 text-foreground/80">
            {stringProp(props.summary)}
          </p>
        </div>
      </div>
      {items.length > 0 ? (
        <ul className="mt-3 grid gap-1.5 text-sm text-foreground/80 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
