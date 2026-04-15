"use client";

import { useMemo, useState } from "react";

import { useI18n } from "@/i18n/client";

type ExecutionEvent = {
  id: string;
  eventType: string;
  title?: string;
  summary?: string;
  kind?: string;
  badge?: string;
  whyItMatters?: string;
  linkedEvidenceLabel?: string | null;
  payload: Record<string, unknown>;
  runtimeTs?: string | null;
  runId?: string | null;
};

type ExecutionTimelineProps = {
  title?: string;
  events: ExecutionEvent[];
  currentRunId?: string | null;
};

type ExecutionGroup = {
  key: string;
  label: string | null;
  events: ExecutionEvent[];
};

const DEFAULT_COPY = {
  title: "最近任务记录",
  noEventsYet: "还没有任务记录。启动任务或出现新的关键进展后，这里会更新。",
  progress: "任务记录",
  rawPayload: "查看原始记录",
  noStructuredPayload: "当前没有结构化记录。",
  itemSingular: "项",
  itemPlural: "项",
  details: "详情",
  prioritizedSection: "需要优先查看",
  backgroundSection: "背景记录",
  latestActivity: "最新活动",
  keyMilestones: "关键节点",
  attentionNeeded: "待处理",
  expandBackground: "展开其余 {count} 条背景记录",
  collapseBackground: "收起背景记录",
  backgroundHint: "这些记录主要用于追查上下文，默认先收起，避免淹没真正关键的节点。",
  linkedEvidence: "关联信息",
  currentRunGroup: "当前运行",
  previousRunGroupPrefix: "历史运行",
  taskContextGroup: "任务上下文",
  runGroupLatest: "最近一条",
  runGroupCount: "记录数",
} as const;

const KEY_MILESTONE_KINDS = ["approval", "input", "failure", "result", "output"] as const;
const ATTENTION_KINDS = ["approval", "input", "failure"] as const;

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

function summarizePayload(
  payload: Record<string, unknown>,
  copy: {
    noStructuredPayload: string;
    itemSingular: string;
    itemPlural: string;
    details: string;
  },
) {
  const entries = Object.entries(payload).slice(0, 3);

  if (entries.length === 0) {
    return copy.noStructuredPayload;
  }

  return entries
    .map(([key, value]) => {
      if (typeof value === "string") {
        return `${key}: ${value}`;
      }

      if (typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value)}`;
      }

      if (Array.isArray(value)) {
        return `${key}: ${value.length} ${value.length === 1 ? copy.itemSingular : copy.itemPlural}`;
      }

      if (value && typeof value === "object") {
        return `${key}: ${copy.details}`;
      }

      return `${key}: -`;
    })
    .join(" · ");
}

function getBadgeClass(kind: string | undefined) {
  switch (kind) {
    case "approval":
    case "input":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failure":
      return "border-red-200 bg-red-50 text-red-700";
    case "result":
    case "output":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-border bg-card text-muted-foreground";
  }
}

function getCardClass(kind: string | undefined) {
  switch (kind) {
    case "approval":
    case "input":
      return "border-amber-200/70 bg-amber-50/60";
    case "failure":
      return "border-red-200/70 bg-red-50/60";
    case "result":
    case "output":
      return "border-emerald-200/70 bg-emerald-50/60";
    default:
      return "border-border/70 bg-background/90";
  }
}

function isKeyMilestone(event: ExecutionEvent) {
  return KEY_MILESTONE_KINDS.includes((event.kind ?? "") as (typeof KEY_MILESTONE_KINDS)[number]);
}

function sortEvents(events: ExecutionEvent[]) {
  return [...events].sort((left, right) => {
    const leftTs = left.runtimeTs ? new Date(left.runtimeTs).getTime() : Number.NEGATIVE_INFINITY;
    const rightTs = right.runtimeTs ? new Date(right.runtimeTs).getTime() : Number.NEGATIVE_INFINITY;

    if (leftTs !== rightTs) {
      return rightTs - leftTs;
    }

    return right.id.localeCompare(left.id);
  });
}

function groupEventsByRun(
  events: ExecutionEvent[],
  currentRunId: string | null | undefined,
  copy: typeof DEFAULT_COPY,
): ExecutionGroup[] {
  if (!events.some((event) => event.runId)) {
    return [{ key: "all-events", label: null, events }];
  }

  const groups: ExecutionGroup[] = [];
  const nonCurrentRunLabels = new Map<string, number>();

  for (const event of events) {
    if (!event.runId) {
      const existingTaskContext = groups.find((group) => group.key === "task-context");
      if (existingTaskContext) {
        existingTaskContext.events.push(event);
      } else {
        groups.push({ key: "task-context", label: copy.taskContextGroup, events: [event] });
      }
      continue;
    }

    const key = `run:${event.runId}`;
    const existingGroup = groups.find((group) => group.key === key);
    if (existingGroup) {
      existingGroup.events.push(event);
      continue;
    }

    let label = copy.currentRunGroup;
    if (!currentRunId || event.runId !== currentRunId) {
      const nextIndex = nonCurrentRunLabels.size + 1;
      const sequence = nonCurrentRunLabels.get(event.runId) ?? nextIndex;
      nonCurrentRunLabels.set(event.runId, sequence);
      label = `${copy.previousRunGroupPrefix} ${sequence}`;
    }

    groups.push({ key, label, events: [event] });
  }

  return groups;
}

function renderEventCard(
  event: ExecutionEvent,
  copy: typeof DEFAULT_COPY,
) {
  const payloadEntries = Object.entries(event.payload);

  return (
    <article
      key={event.id}
      className={`relative rounded-2xl border px-4 py-3 shadow-sm ${getCardClass(event.kind)}`}
    >
      <span className="absolute -left-[1.35rem] top-5 size-2.5 rounded-full border border-background bg-primary" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-1 text-[11px] ${getBadgeClass(event.kind)}`}>
              {event.badge ?? copy.progress}
            </span>
            <p className="font-medium text-foreground">{event.title ?? event.eventType}</p>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground">{formatDate(event.runtimeTs)}</p>
        </div>
      </div>

      <p className="mt-2 text-xs leading-5 text-foreground/90">
        {event.summary ?? summarizePayload(event.payload, copy)}
      </p>
      {event.whyItMatters ? <p className="mt-2 text-xs text-muted-foreground/90">{event.whyItMatters}</p> : null}
      {event.linkedEvidenceLabel ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{copy.linkedEvidence}：{event.linkedEvidenceLabel}</p>
      ) : null}

      {payloadEntries.length > 0 ? (
        <details className="mt-3 rounded-xl border border-border/60 bg-card/70 px-3 py-2">
          <summary className="cursor-pointer list-none text-xs font-medium text-foreground">
            {copy.rawPayload}
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

function renderEventSections(
  events: ExecutionEvent[],
  copy: typeof DEFAULT_COPY,
  expanded: boolean,
  onToggleExpanded: (expanded: boolean) => void,
) {
  const prioritizedEvents = events.filter((event) => isKeyMilestone(event));
  const backgroundEvents = events.filter((event) => !isKeyMilestone(event));
  const hasPrioritizedSection = prioritizedEvents.length > 0;
  const shouldCollapseBackground = hasPrioritizedSection && backgroundEvents.length > 0;
  const visibleBackgroundEvents = shouldCollapseBackground && !expanded ? [] : backgroundEvents;

  return (
    <div className="space-y-4 border-l border-border/70 pl-4">
      {hasPrioritizedSection ? (
        <section aria-label={copy.prioritizedSection} className="space-y-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-foreground">{copy.prioritizedSection}</h4>
          </div>
          {prioritizedEvents.map((event) => renderEventCard(event, copy))}
        </section>
      ) : null}

      {visibleBackgroundEvents.length > 0 ? (
        <section aria-label={copy.backgroundSection} className="space-y-3">
          {hasPrioritizedSection ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-foreground">{copy.backgroundSection}</h4>
                {shouldCollapseBackground ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-foreground underline decoration-border underline-offset-4"
                    onClick={() => onToggleExpanded(false)}
                  >
                    {copy.collapseBackground}
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground/85">{copy.backgroundHint}</p>
            </div>
          ) : null}
          {visibleBackgroundEvents.map((event) => renderEventCard(event, copy))}
        </section>
      ) : null}

      {shouldCollapseBackground && !expanded ? (
        <button
          type="button"
          className="inline-flex items-center rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-card"
          onClick={() => onToggleExpanded(true)}
        >
          {copy.expandBackground.replace("{count}", String(backgroundEvents.length))}
        </button>
      ) : null}
    </div>
  );
}

export function ExecutionTimeline({
  events,
  title = DEFAULT_COPY.title,
  currentRunId = null,
}: ExecutionTimelineProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.executionTimeline ?? {}) };
  const sortedEvents = useMemo(() => sortEvents(events), [events]);
  const groupedEvents = useMemo(
    () => groupEventsByRun(sortedEvents, currentRunId, copy),
    [copy, currentRunId, sortedEvents],
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  if (events.length === 0) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <h3 className="text-sm font-semibold text-foreground">
          {title === DEFAULT_COPY.title ? copy.title : title}
        </h3>
        <p>{copy.noEventsYet}</p>
      </div>
    );
  }

  const attentionCount = sortedEvents.filter((event) =>
    ATTENTION_KINDS.includes((event.kind ?? "") as (typeof ATTENTION_KINDS)[number]),
  ).length;
  const latestTimestamp = sortedEvents[0]?.runtimeTs;

  return (
    <div className="space-y-4 text-sm text-muted-foreground">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {title === DEFAULT_COPY.title ? copy.title : title}
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-card/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">{copy.latestActivity}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{formatDate(latestTimestamp)}</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">{copy.keyMilestones}</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {sortedEvents.filter((event) => isKeyMilestone(event)).length}
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card/60 px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">{copy.attentionNeeded}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{attentionCount}</p>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {groupedEvents.map((group) => {
          const expanded = expandedGroups[group.key] ?? false;
          const latestGroupTimestamp = group.events[0]?.runtimeTs ?? null;

          if (!group.label) {
            return (
              <div key={group.key}>
                {renderEventSections(group.events, copy, expanded, (nextExpanded) =>
                  setExpandedGroups((current) => ({ ...current, [group.key]: nextExpanded })),
                )}
              </div>
            );
          }

          return (
            <section
              key={group.key}
              aria-label={group.label}
              className="space-y-3 rounded-[24px] border border-border/70 bg-muted/[0.16] p-4 sm:p-5"
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-start">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{group.label}</h4>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 px-3 py-2 text-xs">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
                    {copy.runGroupLatest}
                  </p>
                  <p className="mt-1 font-medium text-foreground">{formatDate(latestGroupTimestamp)}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 px-3 py-2 text-xs">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
                    {copy.runGroupCount}
                  </p>
                  <p className="mt-1 font-medium text-foreground">{group.events.length}</p>
                </div>
              </div>

              {renderEventSections(group.events, copy, expanded, (nextExpanded) =>
                setExpandedGroups((current) => ({ ...current, [group.key]: nextExpanded })),
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
