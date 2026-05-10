import type { EvidenceItem, WorkPageCopy } from "./types";

export function isMissingRecordError(error: unknown) {
  return error instanceof Error && error.message.includes("No record was found for a query");
}

export function makeEvidence(item: EvidenceItem) {
  return item;
}

export function toIsoString(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function summarizeValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }

  if (value && typeof value === "object") {
    return "details";
  }

  return "-";
}

export function summarizePayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).slice(0, 3);

  if (entries.length === 0) {
    return "No structured payload recorded.";
  }

  return entries.map(([key, value]) => `${key}: ${summarizeValue(value)}`).join(" · ");
}

export function formatEventTitle(eventType: string) {
  return eventType
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function classifyWorkstreamItem(eventType: string, copy: WorkPageCopy) {
  if (/approval/i.test(eventType)) {
    return {
      kind: "approval",
      badge: copy.needsApproval,
      whyItMatters: copy.humanApprovalMatters,
      linkedEvidenceLabel: copy.linkedToNextAction,
    } as const;
  }

  if (/input/i.test(eventType)) {
    return {
      kind: "input",
      badge: copy.needsInput,
      whyItMatters: copy.waitingForGuidance,
      linkedEvidenceLabel: copy.linkedToNextAction,
    } as const;
  }

  if (/fail|error|blocked|reject/i.test(eventType)) {
    return {
      kind: "failure",
      badge: copy.needsRecovery,
      whyItMatters: "This event likely explains why the run stalled or needs a retry path.",
      linkedEvidenceLabel: copy.recoveryEvidence,
    } as const;
  }

  if (/complete|finish/i.test(eventType)) {
    return {
      kind: "result",
      badge: copy.result,
      whyItMatters: "This milestone helps explain the latest outcome and what follow-up may be needed.",
      linkedEvidenceLabel: copy.feedsSharedOutput,
    } as const;
  }

  if (/artifact|memory|output/i.test(eventType)) {
    return {
      kind: "output",
      badge: copy.output,
      whyItMatters: "This event produced material that can guide the next decision or handoff.",
      linkedEvidenceLabel: copy.feedsSharedOutput,
    } as const;
  }

  return {
    kind: "progress",
    badge: copy.progress,
    whyItMatters: "This shows the latest execution progress without demanding immediate action.",
    linkedEvidenceLabel: null,
  } as const;
}
