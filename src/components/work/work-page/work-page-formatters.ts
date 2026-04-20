export function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

export function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

export function isOverdueScheduleStatus(status: string | null | undefined) {
  return status === "AtRisk" || status === "Overdue";
}

export function getScheduleStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "AtRisk":
      return "At risk";
    case "Overdue":
      return "Overdue";
    case "OnTrack":
      return "On track";
    case "Unscheduled":
      return "Unscheduled";
    case "Completed":
      return "Completed";
    default:
      return status || "N/A";
  }
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

export function getApprovalStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "Pending":
      return "Pending";
    case "Approved":
      return "Approved";
    case "Rejected":
      return "Rejected";
    case "Cancelled":
      return "Cancelled";
    default:
      return status || "N/A";
  }
}

export function getTaskLifecycleLabel(status: string | null | undefined) {
  switch (status) {
    case "Ready":
      return "Pending";
    case "Running":
    case "InProgress":
      return "In progress";
    case "Blocked":
      return "Blocked";
    case "Done":
    case "Completed":
      return "Completed";
    case "Cancelled":
      return "Cancelled";
    default:
      return status || "N/A";
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

export function getArtifactTypeLabel(type: string | null | undefined) {
  switch (type) {
    case "document":
      return "Document";
    case "file":
      return "File";
    case "link":
      return "Link";
    case "image":
      return "Image";
    default:
      return type || "N/A";
  }
}

export function getToolCallStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "completed":
    case "success":
      return "Completed";
    case "running":
    case "pending":
      return "In progress";
    case "failed":
    case "error":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status || "N/A";
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
export function isSafeExternalHref(href: string) {
  try {
    const protocol = new URL(href).protocol;
    return (
      protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:" ||
      protocol === "tel:"
    );
  } catch {
    return false;
  }
}

export function isInternalAppHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}
import type { WorkbenchCopy } from "./work-page-types";
