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
      return "有风险";
    case "Overdue":
      return "已超时";
    case "OnTrack":
      return "按计划进行";
    case "Unscheduled":
      return "未安排";
    case "Completed":
      return "已完成";
    default:
      return status || "暂无";
  }
}

export function getRunStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "Running":
      return "执行中";
    case "WaitingForApproval":
      return "等待审批";
    case "WaitingForInput":
      return "等待补充说明";
    case "Completed":
      return "已完成";
    case "Failed":
      return "执行中断";
    case "Cancelled":
      return "已取消";
    default:
      return "暂无运行";
  }
}

export function getApprovalStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "Pending":
      return "待处理";
    case "Approved":
      return "已批准";
    case "Rejected":
      return "已拒绝";
    case "Cancelled":
      return "已取消";
    default:
      return status || "暂无";
  }
}

export function getTaskLifecycleLabel(status: string | null | undefined) {
  switch (status) {
    case "Ready":
      return "待开始";
    case "Running":
    case "InProgress":
      return "进行中";
    case "Blocked":
      return "阻塞";
    case "Done":
    case "Completed":
      return "已完成";
    case "Cancelled":
      return "已取消";
    default:
      return status || "暂无";
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
      return "文档";
    case "file":
      return "文件";
    case "link":
      return "链接";
    case "image":
      return "图片";
    default:
      return type || "暂无";
  }
}

export function getToolCallStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "completed":
    case "success":
      return "已完成";
    case "running":
    case "pending":
      return "进行中";
    case "failed":
    case "error":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status || "暂无";
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
