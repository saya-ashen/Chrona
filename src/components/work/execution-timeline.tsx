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

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

function summarizePayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).slice(0, 3);

  if (entries.length === 0) {
    return "No structured payload recorded.";
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
        return `${key}: ${value.length} item${value.length === 1 ? "" : "s"}`;
      }

      if (value && typeof value === "object") {
        return `${key}: details`;
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

export function ExecutionTimeline({ events, title = "Execution Timeline" }: ExecutionTimelineProps) {
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-3">
        {events.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="rounded-lg border bg-background px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-1 text-[11px] ${getBadgeClass(event.kind)}`}>
                    {event.badge ?? "Progress"}
                  </span>
                  <p className="font-medium text-foreground">{event.title ?? event.eventType}</p>
                </div>
                <p className="text-xs">{formatDate(event.runtimeTs)}</p>
              </div>
              <p className="mt-2 text-xs">{event.summary ?? summarizePayload(event.payload)}</p>
              {event.whyItMatters ? <p className="mt-2 text-xs text-muted-foreground/90">{event.whyItMatters}</p> : null}
              {event.linkedEvidenceLabel ? <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">{event.linkedEvidenceLabel}</p> : null}
              <details className="mt-3 rounded-md border bg-card px-3 py-2">
                <summary className="cursor-pointer list-none text-xs font-medium text-foreground">Raw payload</summary>
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
