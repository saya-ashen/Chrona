export type ImportedEventCandidate = {
  externalUid: string;
  recurrenceId?: string | null;
  recurrenceRule?: string | null;
  title?: string | null;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  isAllDay?: boolean;
  status?: "confirmed" | "tentative" | "cancelled";
};

export function normalizeImportedEvents(candidates: ImportedEventCandidate[]) {
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const dedupeKey = [
      candidate.externalUid,
      candidate.recurrenceId ?? "single",
      candidate.startsAt.toISOString(),
    ].join(":");
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);

    return [{
      externalUid: candidate.externalUid,
      recurrenceId: candidate.recurrenceId ?? null,
      recurrenceRule: candidate.recurrenceRule ?? null,
      dedupeKey,
      title: candidate.title?.trim() || "Untitled external event",
      description: candidate.description?.trim() || null,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      isAllDay: Boolean(candidate.isAllDay),
      status: candidate.status ?? "confirmed",
    }];
  });
}
