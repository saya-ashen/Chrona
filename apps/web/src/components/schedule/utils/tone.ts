export function getPriorityAccent(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-amber-500";
    case "medium":
      return "bg-amber-400";
    default:
      return "bg-emerald-500";
  }
}

export function getPriorityTone(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "critical" as const;
    case "high":
      return "warning" as const;
    case "medium":
      return "warning" as const;
    default:
      return "success" as const;
  }
}

export function getScheduleTone(status: string | null | undefined) {
  if (!status) {
    return "neutral" as const;
  }

  switch (status.toLowerCase()) {
    case "overdue":
    case "blocked":
      return "critical" as const;
    case "atrisk":
    case "at risk":
      return "warning" as const;
    case "scheduled":
    case "inprogress":
      return "info" as const;
    default:
      return "neutral" as const;
  }
}

export function getRunTone(status: string | null | undefined) {
  if (!status) {
    return "neutral" as const;
  }

  switch (status.toLowerCase()) {
    case "completed":
      return "success" as const;
    case "waitingforapproval":
    case "waitingforinput":
      return "warning" as const;
    case "failed":
    case "cancelled":
      return "critical" as const;
    default:
      return "info" as const;
  }
}

export function getRunnabilityTone(isRunnable: boolean | undefined) {
  return isRunnable ? ("success" as const) : ("warning" as const);
}
