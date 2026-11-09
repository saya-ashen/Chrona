import { capacity, conflict } from "./errors";
import { currentSignal, DAY } from "./policy";
import type { Signal, State } from "./types";

export const MAX_STATE_BYTES = 8 * 1024 * 1024;
// A bounded report batch plus resulting assessments/links and interaction settlement.
export const SETTLEMENT_RESERVE_BYTES = 1024 * 1024;
const COMPACTED_PROMPT = "[Terminal reasoning snapshot compacted]";

export function archivedSignal(state: State, moduleId: string, eventId: string, fingerprint: string) {
  const previous = state.signalTombstones?.find(s => s.moduleId === moduleId && s.eventId === eventId);
  if (!previous) return null;
  if (previous.digest !== fingerprint) conflict("Source event-id was reused with different evidence; use a new event-id for a new version");
  return { signalId: previous.signalId, associations: [] as string[], duplicate: true as const };
}

export function archiveSignals(state: State, now: string, incoming?: Signal): void {
  if (state.signals.length < 512) return;
  const protectedIds = new Set([
    ...state.decisions.filter(d => !d.finishedAt || d.id === state.runtime.currentDecisionId).flatMap(d => d.signalIds),
    ...state.proposals.filter(p => p.status === "pending").flatMap(p => p.signalIds),
  ]);
  const clock = Date.parse(now);
  const view = incoming ? { ...state, signals: [...state.signals, incoming] } : state;
  const obsolete = state.signals.find(s => !protectedIds.has(s.id) && (clock - Date.parse(s.occurredAt) > 7 * DAY
    || clock >= Date.parse(s.occurredAt) && !currentSignal(view, s, clock)));
  if (!obsolete) return;
  const tombstones = state.signalTombstones ??= [];
  if (tombstones.length >= 4096) capacity("Mind archived event identity capacity reached; refusing to forget deduplication identities");
  tombstones.push({ moduleId: obsolete.moduleId, eventId: obsolete.eventId, digest: obsolete.digest, signalId: obsolete.id });
  state.signals = state.signals.filter(s => s.id !== obsolete.id);
}

export function pruneTerminalProposals(state: State): void {
  // Receipt results remain immutable snapshots, including original suggest/accept/dismiss replies.
  state.proposals = state.proposals.filter(p => p.status === "pending");
}

/** Compact replay-unneeded prompt bytes only. Never discard a decision identity or effect receipt. */
export function compactTerminalPrompts(state: State, reserveBytes = 0): void {
  let size = Buffer.byteLength(JSON.stringify(state));
  if (size + reserveBytes <= MAX_STATE_BYTES) return;
  for (const decision of state.decisions) {
    if (decision.id === state.runtime.currentDecisionId || !decision.finishedAt || !["completed", "unreported", "failed"].includes(decision.phase)
      || Buffer.byteLength(decision.prompt) <= Buffer.byteLength(COMPACTED_PROMPT)) continue;
    size -= Buffer.byteLength(JSON.stringify(decision.prompt)) - Buffer.byteLength(JSON.stringify(COMPACTED_PROMPT));
    decision.prompt = COMPACTED_PROMPT;
    if (size + reserveBytes <= MAX_STATE_BYTES) return;
  }
  capacity("Mind private state is full; retained identities and pending effects cannot be discarded");
}
