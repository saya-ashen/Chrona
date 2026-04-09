type ExecutionTimelineProps = {
  events: Array<{
    id: string;
    eventType: string;
    payload: Record<string, unknown>;
    runtimeTs?: string | null;
  }>;
};

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

export function ExecutionTimeline({ events }: ExecutionTimelineProps) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Execution Timeline</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">
        {events.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="rounded-lg border bg-background px-3 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium text-foreground">{event.eventType}</p>
                <p className="text-xs">{formatDate(event.runtimeTs)}</p>
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
