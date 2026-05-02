import type { WorkbenchCopy } from "./work-page-types";

export function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

export function isOverdueScheduleStatus(status: string | null | undefined) {
  return status === "AtRisk" || status === "Overdue";
}

export function getRunStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "Running":
      return "Running";
    case "WaitingForApproval":
      return "Waiting for approval";
    case "WaitingForInput":
      return "Waiting for input";
    case "Completed":
      return "Completed";
    case "Failed":
      return "Failed";
    case "Cancelled":
      return "Cancelled";
    default:
      return "No run";
  }
}

export function getSyncStatusLabel(
  status: string | null | undefined,
  copy: Pick<WorkbenchCopy, "healthySync" | "staleSync">,
) {
  switch (status) {
    case "healthy":
      return copy.healthySync;
    case "stale":
    case "delayed":
      return copy.staleSync;
    default:
      return status ?? null;
  }
}

export function parseDateInputForSubmission(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);
  const parsedDate = new Date(
    Date.UTC(parsedYear, parsedMonth - 1, parsedDay, 12),
  );

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getUTCFullYear() !== parsedYear ||
    parsedDate.getUTCMonth() !== parsedMonth - 1 ||
    parsedDate.getUTCDate() !== parsedDay
  ) {
    return null;
  }

  return parsedDate;
}
