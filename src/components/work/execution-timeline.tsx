"use client";

import { useI18n } from "@/i18n/client";

type ExecutionTimelineProps = {
  title?: string;
  events: Array<{
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
  }>;
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
} as const;

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

export function ExecutionTimeline({ events, title = DEFAULT_COPY.title }: ExecutionTimelineProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.executionTimeline ?? {}) };
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <h3 className="text-sm font-semibold text-foreground">{title === DEFAULT_COPY.title ? copy.title : title}</h3>
      <div className="space-y-3 border-l border-border/70 pl-4">
        {events.length === 0 ? (
          <p>{copy.noEventsYet}</p>
        ) : (
          events.map((event) => (
              <div key={event.id} className="relative rounded-2xl border border-border/70 bg-background/90 px-4 py-3 shadow-sm">
                <span className="absolute -left-[1.35rem] top-5 size-2.5 rounded-full border border-background bg-primary" />
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-1 text-[11px] ${getBadgeClass(event.kind)}`}>
                      {event.badge ?? copy.progress}
                    </span>
                    <p className="font-medium text-foreground">{event.title ?? event.eventType}</p>
                  </div>
                  <p className="text-xs font-mono">{formatDate(event.runtimeTs)}</p>
                </div>
                <p className="mt-2 text-xs leading-5">{event.summary ?? summarizePayload(event.payload, copy)}</p>
                {event.whyItMatters ? <p className="mt-2 text-xs text-muted-foreground/90">{event.whyItMatters}</p> : null}
                {event.linkedEvidenceLabel ? <p className="mt-2 text-[11px] text-muted-foreground">关联信息：{event.linkedEvidenceLabel}</p> : null}
                <details className="mt-3 rounded-xl border border-border/60 bg-card/70 px-3 py-2">
                  <summary className="cursor-pointer list-none text-xs font-medium text-foreground">{copy.rawPayload}</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
                    {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
