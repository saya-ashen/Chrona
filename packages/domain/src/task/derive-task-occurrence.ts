import type {
  TaskDefinitionStatus,
  TaskOccurrenceStatus,
} from "@chrona/contracts/api";

export type OccurrenceProjectionInput = {
  id: string;
  status: TaskOccurrenceStatus;
  eligibleAt: string;
  materializedAt: string;
};

const ACTIVE = new Set<TaskOccurrenceStatus>(["Running", "WaitingForInput", "WaitingForApproval"]);
const ACTIONABLE = new Set<TaskOccurrenceStatus>(["WaitingForInput", "WaitingForApproval", "Blocked", "Failed", "Ready"]);
const TERMINAL = new Set<TaskOccurrenceStatus>(["Completed", "Cancelled", "Ignored"]);

export function isTerminalOccurrenceStatus(status: TaskOccurrenceStatus) {
  return TERMINAL.has(status);
}

export function deriveTaskDefinitionStatus(input: {
  current: TaskDefinitionStatus;
  executionMode: "single" | "series";
  occurrences: OccurrenceProjectionInput[];
  hasAcceptedResult: boolean;
}): TaskDefinitionStatus {
  if (["Paused", "Stopped"].includes(input.current)) return input.current;
  if (input.executionMode === "single" && input.hasAcceptedResult) return "Completed";
  return input.current === "Draft" ? "Draft" : "Active";
}

export function selectFocusedOccurrence(occurrences: OccurrenceProjectionInput[]) {
  const ordered = [...occurrences].sort((a, b) => {
    const eligible = Date.parse(b.eligibleAt) - Date.parse(a.eligibleAt);
    return eligible || Date.parse(b.materializedAt) - Date.parse(a.materializedAt) || b.id.localeCompare(a.id);
  });
  return ordered.find((item) => ACTIVE.has(item.status))
    ?? ordered.find((item) => ACTIONABLE.has(item.status))
    ?? ordered.at(0)
    ?? null;
}

export function deriveOccurrenceNextAction(status: TaskOccurrenceStatus | null) {
  switch (status) {
    case "WaitingForInput": return "provide_input" as const;
    case "WaitingForApproval": return "review_approval" as const;
    case "Blocked": return "resolve_block" as const;
    case "Failed": return "retry" as const;
    case "Ready": return "start" as const;
    case "Running": return "inspect_progress" as const;
    case "Scheduled": return "inspect_schedule" as const;
    case "Completed": return "review_result" as const;
    default: return "none" as const;
  }
}

export function assertOccurrenceTransition(from: TaskOccurrenceStatus, to: TaskOccurrenceStatus) {
  if (from === to) return;
  if (TERMINAL.has(from)) throw new Error(`Terminal occurrence ${from} cannot transition to ${to}`);
  const allowed: Record<TaskOccurrenceStatus, TaskOccurrenceStatus[]> = {
    Scheduled: ["Ready", "Cancelled", "Ignored"],
    Ready: ["Running", "Cancelled", "Ignored"],
    Running: ["WaitingForInput", "WaitingForApproval", "Blocked", "Failed", "Completed", "Cancelled"],
    WaitingForInput: ["Running", "Failed", "Cancelled"],
    WaitingForApproval: ["Running", "Failed", "Cancelled"],
    Blocked: ["Ready", "Running", "Failed", "Cancelled"],
    Failed: ["Ready", "Running", "Cancelled"],
    Completed: [],
    Cancelled: [],
    Ignored: [],
  };
  if (!allowed[from].includes(to)) throw new Error(`Invalid occurrence transition ${from} -> ${to}`);
}
