import type { ScheduleGhostBlockPreview } from "@chrona/contracts";

export function ScheduleGhostBlockLayer({
  preview,
  mapMinuteToY,
}: {
  preview: ScheduleGhostBlockPreview | null;
  mapMinuteToY: (minute: number) => number;
}) {
  if (!preview) return null;

  return (
    <div className="pointer-events-none absolute inset-x-2 z-10" aria-hidden="true">
      {preview.placements.map((placement) => {
        const start = new Date(placement.startAt);
        const end = new Date(placement.endAt);
        const startMinute = start.getHours() * 60 + start.getMinutes();
        const endMinute = end.getHours() * 60 + end.getMinutes();
        const top = mapMinuteToY(startMinute);
        const height = Math.max(mapMinuteToY(endMinute) - top, 48);

        return (
          <div
            key={`${placement.taskId}-${placement.startAt}`}
            className="absolute inset-x-3 rounded-2xl border border-dashed border-primary/60 bg-primary/10 px-3 py-2 text-sm text-primary shadow-[0_12px_32px_rgba(99,88,233,0.14)]"
            style={{ top, height }}
          >
            <p className="font-semibold">{placement.title}</p>
            <p className="text-xs">Ghost preview</p>
          </div>
        );
      })}
    </div>
  );
}
