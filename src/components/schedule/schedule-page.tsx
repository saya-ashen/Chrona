"use client";

import { useRouter } from "next/navigation";
import { ChevronDown, GripVertical, Move, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import type { Prisma } from "@/generated/prisma/client";
import {
  acceptScheduleProposal,
  applySchedule,
  createTaskFromSchedule,
  rejectScheduleProposal,
  updateTaskConfigFromSchedule,
} from "@/app/actions/task-actions";
import { ScheduleEditorForm } from "@/components/schedule/schedule-editor-form";
import { ScheduleTaskList, type ScheduleTaskListItem } from "@/components/schedule/schedule-task-list";
import {
  TaskConfigForm,
  type TaskConfigFormInput,
  type TaskConfigPreset,
  type TaskConfigRuntimeAdapter,
} from "@/components/schedule/task-config-form";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/ui/task-context-links";
import { useI18n, useLocale } from "@/i18n/client";
import { localizeHref } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

type SchedulePageProps = {
  workspaceId: string;
  data: {
    defaultRuntimeAdapterKey: string;
    runtimeAdapters: TaskConfigRuntimeAdapter[];
    summary: {
      scheduledCount: number;
      unscheduledCount: number;
      proposalCount: number;
      riskCount: number;
    };
    scheduled: Array<ScheduleRecord>;
    unscheduled: Array<ScheduleRecord>;
    proposals: Array<{
      proposalId: string;
      taskId: string;
      workspaceId: string;
      title: string;
      priority: string;
      ownerType: string;
      assigneeAgentId: string | null;
      source: string;
      proposedBy: string;
      summary: string;
      dueAt: Date | null;
      scheduledStartAt: Date | null;
      scheduledEndAt: Date | null;
    }>;
    risks: Array<ScheduleRecord>;
    listItems: ScheduleTaskListItem[];
  };
};

type ScheduleRuntimeFields = {
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
  isRunnable: boolean;
  runnabilityState: string;
  runnabilitySummary: string;
};

type ScheduleRecord = {
  taskId: string;
  workspaceId: string;
  title: string;
  description: string | null;
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  persistedStatus: string;
  displayState: string | null;
  actionRequired: string | null;
  approvalPendingCount: number;
  scheduleStatus: string | null;
  scheduleSource: string | null;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  latestRunStatus: string | null;
  scheduleProposalCount: number;
  lastActivityAt: Date | null;
} & ScheduleRuntimeFields;

type ScheduleCardItem = {
  taskId: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  persistedStatus?: string;
  scheduleStatus?: string | null;
  scheduleSource?: string | null;
  actionRequired?: string | null;
  approvalPendingCount?: number;
  latestRunStatus?: string | null;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  runtimeAdapterKey?: string | null;
  runtimeInput?: unknown;
  runtimeInputVersion?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: unknown;
  isRunnable?: boolean;
  runnabilityState?: string;
  runnabilitySummary?: string;
};

type SchedulePageData = SchedulePageProps["data"];
type ScheduledItem = SchedulePageProps["data"]["scheduled"][number];
type UnscheduledItem = SchedulePageProps["data"]["unscheduled"][number];
type ListItem = SchedulePageProps["data"]["listItems"][number];
type ScheduleViewMode = "timeline" | "list";

type TodayFocusItem = {
  taskId: string;
  workspaceId: string;
  title: string;
  reason: string;
  tone: "neutral" | "info" | "warning" | "critical" | "success";
};

type ScheduledDayGroup = {
  key: string;
  date: Date;
  label: string;
  items: ScheduledItem[];
  proposalCount: number;
  riskCount: number;
};

type CompressedTimelineHour = {
  hour: number;
  startMinute: number;
  endMinute: number;
  visualStart: number;
  visualHeight: number;
  active: boolean;
};

type DragPreview = {
  top: number;
  height: number;
  startMinute: number;
  endMinute: number;
  startAt: Date;
  endAt: Date;
};

type TimelineDragItem = {
  kind: "queue" | "scheduled";
  taskId: string;
  title: string;
  dueAt: Date | null | undefined;
  durationMinutes: number;
};

type TimelineCreateInput = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  runtimeAdapterKey: string;
  runtimeInput: Prisma.InputJsonObject;
  runtimeInputVersion: string;
  runtimeModel: string | null;
  prompt: string | null;
  dueAt: Date | null;
  runtimeConfig?: Prisma.InputJsonObject | null;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
};

const TIMELINE_SLOT_MINUTES = 30;
const DEFAULT_SCHEDULE_BLOCK_MINUTES = 60;
const TIMELINE_COMPOSER_HEIGHT = 356;
const TIMELINE_COMPOSER_MARGIN = 12;

const TASK_CONFIG_PRESETS: TaskConfigPreset[] = [
  {
    id: "requirements-brief",
    label: "Requirements brief",
    description: "Clarify goals, constraints, and the first execution plan.",
    values: {
      priority: "Medium",
      runtimeAdapterKey: "openclaw",
      runtimeInput: {
        model: "gpt-5.4",
        prompt: "Clarify the task, capture constraints, and produce a short execution plan with the next concrete step.",
        temperature: 0.2,
      },
    },
  },
  {
    id: "bug-investigation",
    label: "Bug investigation",
    description: "Reproduce the issue, identify root cause, and propose the safest fix.",
    values: {
      priority: "High",
      runtimeAdapterKey: "openclaw",
      runtimeInput: {
        model: "gpt-5.4",
        prompt:
          "Reproduce the issue, identify the root cause, describe the impact, and suggest the safest fix before making broader changes.",
        temperature: 0.1,
      },
    },
  },
  {
    id: "shipping-pass",
    label: "Shipping pass",
    description: "Complete the change, verify it, and summarize what shipped.",
    values: {
      priority: "Medium",
      runtimeAdapterKey: "openclaw",
      runtimeInput: {
        model: "gpt-5.4",
        prompt:
          "Implement the change, verify the result with the smallest reliable test loop, and summarize the final outcome and any follow-up.",
        temperature: 0.2,
      },
    },
  },
];

const DEFAULT_COPY = {
  planPrefix: "Plan",
  runPrefix: "Run",
  approvalsPrefix: "Approvals",
  blockSingular: "block",
  blockPlural: "blocks",
  proposalSingular: "proposal",
  proposalPlural: "proposals",
  noScheduledStart: "No scheduled start",
  agentAssigned: "Agent-assigned",
  agentPrefix: "Agent",
  humanOwned: "Human-owned",
  timeNotSet: "Time not set",
  unscheduled: "Unscheduled",
  dayOpenSuffix: "is open for new blocks",
  riskDay: "Risk day",
  createTaskBlock: "Create Task Block",
  cancel: "Cancel",
  createAndSchedule: "Create and schedule",
  creating: "Creating…",
  dropOntoLane: "Drop work onto the lane",
  clickOrDrag: "Click any slot or drag to adjust",
  timelineCompressedPrefix: "Timeline compressed: 24h shown as",
  quietHoursCompressedSuffix: "quiet hours compressed",
  emptyDayLane: "Empty day lane",
  emptyDayLaneDescription: "Drop a queued task anywhere on this lane to create the first block.",
  dropToSchedule: "Drop to schedule",
  dropToMoveBlock: "Drop to move block",
  overdue: "Overdue",
  approvalPending: "Approval pending",
  closeTaskDetails: "Close task details",
  taskDetails: "Task Details",
  taskDetailsDescription: "Review the selected block in a floating panel, then return to the timeline.",
  close: "Close",
  due: "Due",
  currentPlan: "Current plan",
  latestRun: "Latest run",
  nextAction: "Next action",
  noActiveRun: "No active run",
  stayOnPlan: "Stay on plan",
  taskConfig: "Task config",
  saveTaskConfig: "Save task config",
  saving: "Saving…",
  adjustBlock: "Adjust block",
  placeOnTimeline: "Place on timeline",
  scheduleTask: "Schedule Task",
  schedulingUpdating: "Scheduling is updating.",
  dragHint: "Drag to the timeline or expand for details and fallback scheduling.",
  pendingProposals: "Pending proposals",
  runnable: "Runnable",
  model: "Model",
  proposedBy: "Proposed by",
  candidateBlock: "Candidate block",
  dueImpact: "Due impact",
  source: "Source",
  acceptProposal: "Accept Proposal",
  rejectProposal: "Reject Proposal",
  risk: "Risk",
  action: "Action",
  needsReview: "Needs review",
  reviewScheduleImpact: "Review schedule impact",
  plannedWindow: "Planned window",
  openInbox: "Open Inbox",
  pageTitle: "Schedule",
  pageDescription: "Use Schedule as the global planning workbench for the default workspace: place unscheduled work, review AI suggestions, and resolve schedule risks before execution drifts.",
  today: "Today",
  tomorrow: "Tomorrow",
  currentPlanButton: "Current Plan",
  timeline: "Timeline",
  list: "List",
  scheduledMetric: "Scheduled",
  scheduledMetricHint: "Committed blocks on the current plan.",
  queueMetric: "Queue",
  queueMetricHint: "Tasks still waiting to enter the timeline.",
  aiProposalsMetric: "AI Proposals",
  aiProposalsMetricHint: "Pending suggestions that need a decision.",
  risksMetric: "Risks",
  risksMetricHint: "At-risk, overdue, or interrupted work.",
  scheduledTimeline: "Scheduled Timeline",
  scheduledTimelineDescription: "This is the main planning surface: create tasks, place queued work, and drag existing blocks to adjust time.",
  dropMode: "Drop mode",
  planningSurface: "Planning surface",
  conflictsTitle: "Conflicts / Overdue Risks",
  conflictsDescription: "Keep recovery work visible without crowding the queue rail.",
  noScheduleRisks: "No schedule risks detected. Blocked, overdue, or interrupted work will surface here.",
  aiProposalsTitle: "AI Proposals",
  aiProposalsDescription: "Review suggestions near the timeline, not inside the queue rail.",
  noAiProposals: "No pending AI proposals. When planner automation suggests a new block, it will appear here for review.",
  planningGuide: "Planning Guide",
  guideStep1: "1. Clear the highest-risk items first.",
  guideStep2: "2. Drag queue items into concrete blocks or click a free slot to create work inline.",
  guideStep3: "3. Review proposals as suggestions, not automatic truth.",
  openTaskCenter: "Open Task Center",
  weekOverview: "Week Overview",
  noTimelineDay: "No timeline day is available right now.",
  unscheduledQueue: "Unscheduled Queue",
  unscheduledQueueDescription: "Collapsed task cards stay in the side rail. Expand only when needed, or drag them directly into the timeline.",
  noUnscheduledWork: "No unscheduled work. New tasks that lose their plan or need initial placement will appear here.",
  dateSwitcher: "Date",
  todayFocus: "Today Focus",
  todayFocusDescription: "Clear the items that can block today before you keep reshaping the timeline.",
  todayFocusEmpty: "Nothing urgent is blocking today. Use the queue to place the next meaningful block.",
  focusOverdue: "Overdue",
  focusAtRisk: "At risk",
  focusWaitingForInput: "Waiting for input",
  focusWaitingForApproval: "Waiting for approval",
  focusReadyToday: "Ready to start today",
  todayBlocks: "Today blocks",
  queueReady: "Queue ready",
  needsAttention: "Needs attention",
  secondaryPlanning: "Secondary planning info",
  secondaryPlanningDescription: "Use this area for proposals, week context, and planning help after today's work is clear.",
  aiProposalsCompactEmpty: "No pending AI proposals.",
} as const;

type SchedulePageCopy = Record<keyof typeof DEFAULT_COPY, string>;

function formatDateTime(value: Date | null | undefined, locale: string) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatTime(value: Date | null | undefined, locale: string) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatDayHeading(value: Date | null | undefined, locale = "en", copy: SchedulePageCopy = DEFAULT_COPY) {
  if (!value) {
    return copy.noScheduledStart;
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value);
}

function describeOwner(ownerType: string, assigneeAgentId: string | null, copy: SchedulePageCopy) {
  if (ownerType === "agent") {
    return assigneeAgentId ? `${copy.agentPrefix} · ${assigneeAgentId}` : copy.agentAssigned;
  }

  return copy.humanOwned;
}

function formatTimeRange(start: Date | null | undefined, end: Date | null | undefined, locale: string, copy: SchedulePageCopy) {
  if (!start && !end) {
    return copy.timeNotSet;
  }

  return `${formatTime(start, locale)} → ${formatTime(end, locale)}`;
}

function getPriorityAccent(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-amber-500";
    case "medium":
      return "bg-sky-500";
    default:
      return "bg-emerald-500";
  }
}

function getPriorityTone(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return "critical" as const;
    case "high":
      return "warning" as const;
    case "medium":
      return "info" as const;
    default:
      return "success" as const;
  }
}

function getScheduleTone(status: string | null | undefined) {
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

function getRunTone(status: string | null | undefined) {
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

function getRunnabilityTone(isRunnable: boolean | undefined) {
  return isRunnable ? ("success" as const) : ("warning" as const);
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateKeyParts(year: number, month: number, day: number) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function getDayKey(value: Date | null | undefined) {
  return value
    ? formatLocalDateKeyParts(value.getFullYear(), value.getMonth() + 1, value.getDate())
    : "unspecified";
}

function formatShortDay(value: Date | null | undefined, locale: string, copy: SchedulePageCopy) {
  if (!value) {
    return copy.unscheduled;
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    weekday: "short",
    day: "numeric",
  }).format(value);
}

function formatDateKey(value: Date) {
  return formatLocalDateKeyParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(value: Date) {
  const day = value.getDay();
  const offset = (day + 6) % 7;
  return addDays(startOfDay(value), -offset);
}

function parseDayKey(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parts = value.split("-").map((part) => Number(part));

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  return startOfDay(new Date(parts[0], parts[1] - 1, parts[2]));
}

function toDateForDay(dayKey: string, minute: number) {
  const date = parseDayKey(dayKey) ?? startOfDay(new Date());
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return date;
}

function getTodayKey() {
  return formatDateKey(startOfDay(new Date()));
}

function formatDurationMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function snapMinuteToGrid(minute: number) {
  return Math.round(minute / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES;
}

function clampScheduledStartMinute(minute: number) {
  return Math.min(Math.max(minute, 0), 24 * 60 - DEFAULT_SCHEDULE_BLOCK_MINUTES);
}

function getBlockDurationMinutes(item: { scheduledStartAt?: Date | null; scheduledEndAt?: Date | null }) {
  const start = item.scheduledStartAt ? item.scheduledStartAt.getTime() : null;
  const end = item.scheduledEndAt ? item.scheduledEndAt.getTime() : null;

  if (start === null || end === null) {
    return DEFAULT_SCHEDULE_BLOCK_MINUTES;
  }

  return Math.max(Math.round((end - start) / 60000), TIMELINE_SLOT_MINUTES);
}

function buildCompressedTimeline(items: ScheduledItem[]) {
  const activeHourHeight = 72;
  const idleHourHeight = 22;
  const dayStartMinute = 0;
  const dayEndMinute = 24 * 60;
  const hourActivity = Array.from({ length: 24 }, () => false);

  for (const item of items) {
    const start = item.scheduledStartAt
      ? item.scheduledStartAt.getHours() * 60 + item.scheduledStartAt.getMinutes()
      : null;
    const end = item.scheduledEndAt
      ? item.scheduledEndAt.getHours() * 60 + item.scheduledEndAt.getMinutes()
      : null;

    if (start === null) {
      continue;
    }

    const safeEnd = Math.max(end ?? start + 60, start + 45);
    const firstHour = Math.floor(start / 60);
    const lastHour = Math.min(23, Math.floor((safeEnd - 1) / 60));

    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      hourActivity[hour] = true;
    }
  }

  const hours: CompressedTimelineHour[] = [];
  let visualCursor = 0;

  for (let hour = 0; hour < 24; hour += 1) {
    const visualHeight = hourActivity[hour] ? activeHourHeight : idleHourHeight;
    hours.push({
      hour,
      startMinute: hour * 60,
      endMinute: (hour + 1) * 60,
      visualStart: visualCursor,
      visualHeight,
      active: hourActivity[hour],
    });
    visualCursor += visualHeight;
  }

  const compressedGapCount = hourActivity.filter((active) => !active).length;
  const visualMinutes = (visualCursor / activeHourHeight) * 60;

  function mapMinuteToY(minute: number) {
    const safeMinute = Math.min(Math.max(minute, dayStartMinute), dayEndMinute);

    if (safeMinute === dayEndMinute) {
      return visualCursor;
    }

    const hourIndex = Math.min(23, Math.floor(safeMinute / 60));
    const hour = hours[hourIndex];
    const minuteWithinHour = safeMinute - hour.startMinute;
    return hour.visualStart + (minuteWithinHour / 60) * hour.visualHeight;
  }

  function mapYToMinute(y: number) {
    const safeY = Math.min(Math.max(y, 0), visualCursor);

    if (safeY === visualCursor) {
      return dayEndMinute;
    }

    const hour =
      hours.find(
        (candidate) => safeY >= candidate.visualStart && safeY < candidate.visualStart + candidate.visualHeight,
      ) ?? hours[hours.length - 1];

    const relativeY = safeY - hour.visualStart;
    return hour.startMinute + (relativeY / hour.visualHeight) * 60;
  }

  return {
    hours,
    totalVisualHeight: Math.max(visualCursor, 320),
    compressedGapCount,
    visualMinutes,
    mapMinuteToY,
    mapYToMinute,
  };
}

function buildWeekGroups(
  items: SchedulePageProps["data"]["scheduled"],
  proposals: SchedulePageProps["data"]["proposals"],
  risks: SchedulePageProps["data"]["risks"],
  referenceDay: string | undefined,
) {
  const anchorDate = parseDayKey(referenceDay) ?? startOfDay(new Date());
  const weekStart = startOfWeek(anchorDate);
  const groups: ScheduledDayGroup[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);

    return {
      key: formatDateKey(date),
      date,
      label: formatDayHeading(date),
      items: [],
      proposalCount: 0,
      riskCount: 0,
    };
  });

  const groupMap = new Map(groups.map((group) => [group.key, group]));

  for (const proposal of proposals) {
    const group = groupMap.get(getDayKey(proposal.scheduledStartAt));
    if (group) {
      group.proposalCount += 1;
    }
  }

  for (const risk of risks) {
    const group = groupMap.get(getDayKey(risk.scheduledStartAt));
    if (group) {
      group.riskCount += 1;
    }
  }

  for (const item of items) {
    const group = groupMap.get(getDayKey(item.scheduledStartAt));
    if (group) {
      group.items.push(item);
    }
  }

  return groups.map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => {
      const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }),
  }));
}

function sortScheduledItems(items: ScheduledItem[]) {
  return [...items].sort((a, b) => {
    const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function createScheduledItemFromQueueItem(item: UnscheduledItem, startAt: Date, endAt: Date): ScheduledItem {
  return {
    taskId: item.taskId,
    workspaceId: item.workspaceId,
    title: item.title,
    priority: item.priority,
    ownerType: item.ownerType,
    assigneeAgentId: item.assigneeAgentId,
    persistedStatus: item.persistedStatus,
    displayState: item.displayState,
    actionRequired: item.isRunnable ? null : item.runnabilitySummary,
    approvalPendingCount: item.approvalPendingCount,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    latestRunStatus: item.latestRunStatus,
    scheduleProposalCount: item.scheduleProposalCount,
    lastActivityAt: item.lastActivityAt,
    description: item.description,
    runtimeAdapterKey: item.runtimeAdapterKey,
    runtimeInput: item.runtimeInput,
    runtimeInputVersion: item.runtimeInputVersion,
    runtimeModel: item.runtimeModel,
    prompt: item.prompt,
    runtimeConfig: item.runtimeConfig,
    isRunnable: item.isRunnable,
    runnabilityState: item.runnabilityState,
    runnabilitySummary: item.runnabilitySummary,
  };
}

function createScheduledItemFromCreateInput(
  taskId: string,
  workspaceId: string,
  workspaceDefaultRuntime: string,
  input: TimelineCreateInput,
): ScheduledItem {
  const runnability = deriveTaskRunnability({
    workspaceDefaultRuntime,
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig: input.runtimeConfig,
  });

  return {
    taskId,
    workspaceId,
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    ownerType: "human",
    assigneeAgentId: null,
    persistedStatus: runnability.isRunnable ? "Ready" : "Draft",
    displayState: null,
    actionRequired: runnability.isRunnable ? null : runnability.summary,
    approvalPendingCount: 0,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    dueAt: input.dueAt,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
    latestRunStatus: null,
    scheduleProposalCount: 0,
    lastActivityAt: new Date(),
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeInputVersion: input.runtimeInputVersion,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig: input.runtimeConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
  };
}

function createListItemFromScheduledItem(item: ScheduledItem): ListItem {
  return {
    ...item,
    displayState: item.displayState,
    scheduleProposalCount: item.scheduleProposalCount,
    lastActivityAt: item.lastActivityAt,
  };
}

function applyScheduleToListItem(item: ListItem, startAt: Date, endAt: Date): ListItem {
  return {
    ...item,
    dueAt: item.dueAt,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    scheduleStatus: "Scheduled",
    scheduleSource: "human",
    actionRequired: item.isRunnable ? null : item.runnabilitySummary,
  };
}

function applyTaskConfigToItem<T extends ScheduledItem | UnscheduledItem | ListItem | SchedulePageProps["data"]["risks"][number]>(
  item: T,
  input: TaskConfigFormInput,
): T {
  const runtimeConfig = input.runtimeConfig ?? null;
  const runnability = deriveTaskRunnability({
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig,
  });

  return {
    ...item,
    title: input.title,
    description: input.description || null,
    priority: input.priority,
    dueAt: input.dueAt,
    runtimeAdapterKey: input.runtimeAdapterKey,
    runtimeInput: input.runtimeInput,
    runtimeInputVersion: input.runtimeInputVersion,
    runtimeModel: input.runtimeModel,
    prompt: input.prompt,
    runtimeConfig,
    isRunnable: runnability.isRunnable,
    runnabilityState: runnability.state,
    runnabilitySummary: runnability.summary,
    persistedStatus:
      item.persistedStatus === "Draft" || item.persistedStatus === "Ready"
        ? runnability.isRunnable
          ? "Ready"
          : "Draft"
        : item.persistedStatus,
    actionRequired: runnability.isRunnable ? item.actionRequired : runnability.summary,
  };
}

function MetricCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <SurfaceCard variant="inset" padding="sm" className="rounded-2xl">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </SurfaceCard>
  );
}

function buildTodayFocusItems(
  data: SchedulePageData,
  activeGroup: ScheduledDayGroup | null,
  copy: SchedulePageCopy,
): TodayFocusItem[] {
  const focus = new Map<string, TodayFocusItem>();

  function push(item: ScheduleCardItem, reason: string, tone: TodayFocusItem["tone"]) {
    if (focus.has(item.taskId)) {
      return;
    }

    focus.set(item.taskId, {
      taskId: item.taskId,
      workspaceId: item.workspaceId,
      title: item.title,
      reason,
      tone,
    });
  }

  for (const item of data.risks) {
    if (item.scheduleStatus === "Overdue") {
      push(item, copy.focusOverdue, "critical");
      continue;
    }

    if (item.latestRunStatus === "WaitingForInput" || item.displayState === "WaitingForInput") {
      push(item, copy.focusWaitingForInput, "warning");
      continue;
    }

    if (item.latestRunStatus === "WaitingForApproval" || item.displayState === "WaitingForApproval") {
      push(item, copy.focusWaitingForApproval, "warning");
      continue;
    }

    push(item, copy.focusAtRisk, "warning");
  }

  for (const item of activeGroup?.items ?? []) {
    const isHighPriority = item.priority === "High" || item.priority === "Urgent";
    const hasStarted = Boolean(item.latestRunStatus && item.latestRunStatus !== "Pending");

    if (!hasStarted && isHighPriority) {
      push(item, copy.focusReadyToday, "info");
    }
  }

  return Array.from(focus.values()).slice(0, 5);
}

function TodayFocusCard({
  items,
  copy,
}: {
  items: TodayFocusItem[];
  copy: SchedulePageCopy;
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>{copy.todayFocus}</SurfaceCardTitle>
        <SurfaceCardDescription>{copy.todayFocusDescription}</SurfaceCardDescription>
      </SurfaceCardHeader>

      {items.length === 0 ? (
        <EmptyState>{copy.todayFocusEmpty}</EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <SurfaceCard as="div" key={item.taskId} variant="inset" padding="sm" className="rounded-2xl">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={item.tone}>{item.reason}</StatusBadge>
                </div>
                <LocalizedLink
                  href={`/workspaces/${item.workspaceId}/work/${item.taskId}`}
                  className="line-clamp-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
                >
                  {item.title}
                </LocalizedLink>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

function ItemMeta({ item }: { item: ScheduleCardItem }) {
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone={getPriorityTone(item.priority)}>{item.priority}</StatusBadge>
      <StatusBadge>{describeOwner(item.ownerType, item.assigneeAgentId, copy)}</StatusBadge>
      {item.runnabilitySummary ? (
        <StatusBadge tone={getRunnabilityTone(item.isRunnable)}>{item.runnabilitySummary}</StatusBadge>
      ) : null}
      {item.scheduleStatus ? (
        <StatusBadge tone={getScheduleTone(item.scheduleStatus)}>{copy.planPrefix}: {item.scheduleStatus}</StatusBadge>
      ) : null}
      {item.latestRunStatus ? <StatusBadge tone={getRunTone(item.latestRunStatus)}>{copy.runPrefix}: {item.latestRunStatus}</StatusBadge> : null}
      {item.approvalPendingCount ? <StatusBadge tone="warning">{copy.approvalsPrefix}: {item.approvalPendingCount}</StatusBadge> : null}
    </div>
  );
}

function DetailGrid({
  items,
}: {
  items: Array<{ label: string; value: string | null | undefined }>;
}) {
  return (
    <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-sm text-foreground">{item.value ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function DayTimelineSummary({ items, dayDate }: { items: ScheduledItem[]; dayDate: Date }) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  const starts = items
    .map((item) => item.scheduledStartAt?.getTime())
    .filter((value): value is number => value !== undefined);
  const ends = items.map((item) => item.scheduledEndAt?.getTime()).filter((value): value is number => value !== undefined);

  if (starts.length === 0 || ends.length === 0) {
    return <span>{formatShortDay(dayDate, locale, copy)} {copy.dayOpenSuffix}</span>;
  }

  const earliest = new Date(Math.min(...starts));
  const latest = new Date(Math.max(...ends));

  return <span>{formatTime(earliest, locale)} → {formatTime(latest, locale)}</span>;
}

function buildScheduleHref(day: string, taskId?: string) {
  const params = new URLSearchParams();
  params.set("day", day);

  if (taskId) {
    params.set("task", taskId);
  }

  return `/schedule?${params.toString()}`;
}

function buildScheduleViewHref(day: string, view: ScheduleViewMode, taskId?: string) {
  const params = new URLSearchParams();
  params.set("day", day);

  if (taskId) {
    params.set("task", taskId);
  }

  if (view === "list") {
    params.set("view", view);
  }

  return `/schedule?${params.toString()}`;
}

function normalizeScheduleView(view: string | undefined): ScheduleViewMode {
  return view === "list" ? "list" : "timeline";
}

function toTaskConfigInitialValues(item: {
  title: string;
  description?: string | null;
  priority: string;
  runtimeAdapterKey?: string | null;
  runtimeInput?: unknown;
  runtimeInputVersion?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  dueAt?: Date | null;
  runtimeConfig?: unknown;
}) {
  return {
    title: item.title,
    description: item.description ?? null,
    priority: item.priority as TaskConfigFormInput["priority"],
    runtimeAdapterKey: item.runtimeAdapterKey ?? null,
    runtimeInput: item.runtimeInput,
    runtimeInputVersion: item.runtimeInputVersion ?? null,
    runtimeModel: item.runtimeModel ?? null,
    prompt: item.prompt ?? null,
    dueAt: item.dueAt ?? null,
    runtimeConfig: item.runtimeConfig,
  };
}

function TimelineCreateComposer({
  draft,
  timelineHeight,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onClose,
  onCreate,
}: {
  draft: DragPreview;
  timelineHeight: number;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onClose: () => void;
  onCreate: (input: TimelineCreateInput) => Promise<void>;
}) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  const composerTop = Math.min(
    Math.max(draft.top + draft.height - TIMELINE_COMPOSER_HEIGHT, TIMELINE_COMPOSER_MARGIN),
    Math.max(TIMELINE_COMPOSER_MARGIN, timelineHeight - TIMELINE_COMPOSER_HEIGHT - TIMELINE_COMPOSER_MARGIN),
  );

  return (
    <div
      data-timeline-composer
      className="absolute left-3 z-20 max-h-[356px] w-[min(360px,calc(100%-1.5rem))] overflow-y-auto rounded-2xl border border-primary/30 bg-background/98 p-4 shadow-xl"
      style={{ top: `${composerTop}px` }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{copy.createTaskBlock}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatTimeRange(draft.startAt, draft.endAt, locale, copy)}</p>
        </div>
        <button type="button" disabled={isPending} onClick={onClose} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {copy.cancel}
        </button>
      </div>

      <TaskConfigForm
        runtimeAdapters={runtimeAdapters}
        defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
        isPending={isPending}
        presets={TASK_CONFIG_PRESETS}
        submitLabel={copy.createAndSchedule}
        pendingLabel={copy.creating}
        onSubmitAction={async (input) => {
          await onCreate({
            ...input,
            scheduledStartAt: draft.startAt,
            scheduledEndAt: draft.endAt,
          });
        }}
      />
    </div>
  );
}

function WeekStrip({ groups, selectedDay }: { groups: ScheduledDayGroup[]; selectedDay: string }) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  return (
    <SurfaceCard as="div" variant="inset" padding="sm" className="rounded-2xl">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
        {groups.map((group) => {
          const isActive = group.key === selectedDay;

          return (
            <LocalizedLink
              key={group.key}
              href={buildScheduleHref(group.key)}
              className={cn(
                "rounded-2xl border px-3 py-3 transition-colors hover:border-primary/40 hover:bg-background",
                isActive ? "border-primary/60 bg-primary/5 shadow-sm" : "border-border/60 bg-background/70",
              )}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{formatShortDay(group.date, locale, copy)}</p>
                  {group.riskCount > 0 ? <StatusBadge tone="critical">{copy.riskDay}</StatusBadge> : null}
                </div>
                <p className="text-xs text-muted-foreground">{group.label}</p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge>
                    {group.items.length} {group.items.length === 1 ? copy.blockSingular : copy.blockPlural}
                  </StatusBadge>
                  {group.proposalCount > 0 ? (
                    <StatusBadge tone="info">
                      {group.proposalCount} {group.proposalCount === 1 ? copy.proposalSingular : copy.proposalPlural}
                    </StatusBadge>
                  ) : null}
                </div>
              </div>
            </LocalizedLink>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

function DayTimeline({
  items,
  dayDate,
  selectedDay,
  selectedTaskId,
  draggedItem,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onScheduleDrop,
  onCreateTaskBlock,
  onScheduledDragStart,
  onDragEnd,
}: {
  items: ScheduledItem[];
  dayDate: Date;
  selectedDay: string;
  selectedTaskId?: string;
  draggedItem: TimelineDragItem | null;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onScheduleDrop: (item: TimelineDragItem, startAt: Date, endAt: Date) => Promise<void>;
  onCreateTaskBlock: (input: TimelineCreateInput) => Promise<void>;
  onScheduledDragStart: (item: ScheduledItem) => void;
  onDragEnd: () => void;
}) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  const compressedTimeline = useMemo(() => buildCompressedTimeline(items), [items]);
  const timelineHeight = compressedTimeline.totalVisualHeight;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [composerDraft, setComposerDraft] = useState<DragPreview | null>(null);

  useEffect(() => {
    if (!composerDraft || !scrollContainerRef.current) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    const composerTop = Math.min(
      Math.max(composerDraft.top + composerDraft.height - TIMELINE_COMPOSER_HEIGHT, TIMELINE_COMPOSER_MARGIN),
      Math.max(TIMELINE_COMPOSER_MARGIN, timelineHeight - TIMELINE_COMPOSER_HEIGHT - TIMELINE_COMPOSER_MARGIN),
    );
    const visibleTop = scrollContainer.scrollTop;
    const visibleBottom = visibleTop + scrollContainer.clientHeight;
    const composerBottom = composerTop + TIMELINE_COMPOSER_HEIGHT;

    function setScrollTop(top: number) {
      if (typeof scrollContainer.scrollTo === "function") {
        scrollContainer.scrollTo({ top, behavior: "smooth" });
        return;
      }

      scrollContainer.scrollTop = top;
    }

    if (composerTop < visibleTop + TIMELINE_COMPOSER_MARGIN) {
      setScrollTop(Math.max(composerTop - 16, 0));
      return;
    }

    if (composerBottom > visibleBottom - TIMELINE_COMPOSER_MARGIN) {
      setScrollTop(Math.max(composerBottom - scrollContainer.clientHeight + 16, 0));
    }
  }, [composerDraft, timelineHeight]);

  function getMinuteFromClientY(clientY: number) {
    const timeline = timelineRef.current;

    if (!timeline) {
      return 9 * 60;
    }

    const rect = timeline.getBoundingClientRect();

    if (rect.height <= 0) {
      return 9 * 60;
    }

    return compressedTimeline.mapYToMinute(clientY - rect.top);
  }

  function getDragPreview(clientY: number) {
    const snappedStartMinute = clampScheduledStartMinute(snapMinuteToGrid(getMinuteFromClientY(clientY)));
    const durationMinutes = draggedItem?.durationMinutes ?? DEFAULT_SCHEDULE_BLOCK_MINUTES;
    const endMinute = Math.min(snappedStartMinute + durationMinutes, 24 * 60);
    const top = compressedTimeline.mapMinuteToY(snappedStartMinute);
    const height = Math.max(compressedTimeline.mapMinuteToY(endMinute) - top, 56);

    return {
      top,
      height,
      startMinute: snappedStartMinute,
      endMinute,
      startAt: toDateForDay(selectedDay, snappedStartMinute),
      endAt: toDateForDay(selectedDay, endMinute),
    } satisfies DragPreview;
  }

  function createDraftAtMinute(minute: number) {
    const snappedStartMinute = clampScheduledStartMinute(snapMinuteToGrid(minute));
    const endMinute = Math.min(snappedStartMinute + DEFAULT_SCHEDULE_BLOCK_MINUTES, 24 * 60);
    const top = compressedTimeline.mapMinuteToY(snappedStartMinute);
    const height = Math.max(compressedTimeline.mapMinuteToY(endMinute) - top, 56);

    return {
      top,
      height,
      startMinute: snappedStartMinute,
      endMinute,
      startAt: toDateForDay(selectedDay, snappedStartMinute),
      endAt: toDateForDay(selectedDay, endMinute),
    } satisfies DragPreview;
  }

  function openComposerAtMinute(minute: number) {
    setDragPreview(null);
    setComposerDraft(createDraftAtMinute(minute));
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!draggedItem || isPending) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setComposerDraft(null);
    setDragPreview(getDragPreview(event.clientY));
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setDragPreview(null);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!draggedItem || isPending) {
      return;
    }

    event.preventDefault();
    const preview = getDragPreview(event.clientY) ?? dragPreview;
    setDragPreview(null);

    if (!preview) {
      return;
    }

    await onScheduleDrop(draggedItem, preview.startAt, preview.endAt);
  }

  function handleTimelineClick(event: MouseEvent<HTMLDivElement>) {
    if (draggedItem || isPending) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest("[data-timeline-block]") || target.closest("[data-timeline-composer]")) {
      return;
    }

    openComposerAtMinute(getMinuteFromClientY(event.clientY));
  }

  return (
    <SurfaceCard as="div" variant="inset" className="rounded-2xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{formatDayHeading(dayDate, locale, copy)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            <DayTimelineSummary items={items} dayDate={dayDate} /> · {items.length} {items.length === 1 ? copy.blockSingular : copy.blockPlural}
          </p>
        </div>
        <div className="text-right text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => openComposerAtMinute(9 * 60)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Plus className="size-3.5" />
              {copy.createTaskBlock}
            </button>
          </div>
          <p className="mt-2">{draggedItem ? copy.dropOntoLane : copy.clickOrDrag}</p>
          <p className="mt-1 normal-case tracking-normal">
            {copy.timelineCompressedPrefix} {formatDurationMinutes(Math.round(compressedTimeline.visualMinutes))}
            {compressedTimeline.compressedGapCount > 0
              ? ` · ${compressedTimeline.compressedGapCount} ${copy.quietHoursCompressedSuffix}`
              : ""}
          </p>
        </div>
      </div>

      <div ref={scrollContainerRef} className="max-h-[72vh] overflow-y-auto rounded-2xl border border-border/60 bg-card/40 pr-2">
        <div className="flex gap-3">
          <div className="sticky left-0 top-0 hidden w-16 shrink-0 self-start bg-background/95 py-2 sm:block">
            <div className="relative" style={{ height: `${timelineHeight}px` }}>
              {compressedTimeline.hours.map((hour) => (
                <div key={hour.hour} className="absolute left-0 right-0" style={{ top: `${hour.visualStart}px` }}>
                  <span className="-translate-y-1/2 text-xs text-muted-foreground">
                     {formatTime(new Date(2026, 0, 1, hour.hour, 0), locale)}
                  </span>
                </div>
              ))}
              <div className="absolute left-0 right-0" style={{ top: `${timelineHeight}px` }}>
                <span className="-translate-y-1/2 text-xs text-muted-foreground">11:59 PM</span>
              </div>
            </div>
          </div>

          <div
            ref={timelineRef}
            role="region"
            aria-label={`Schedule drop zone for ${formatDayHeading(dayDate, locale, copy)}`}
            tabIndex={0}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(event) => {
              void handleDrop(event);
            }}
            onClick={handleTimelineClick}
            className={cn(
              "relative flex-1 rounded-2xl border border-border/60 bg-card/60 outline-none transition-colors",
              draggedItem && "border-primary/50 bg-primary/5",
            )}
            style={{ height: `${timelineHeight}px` }}
          >
            {compressedTimeline.hours.map((hour) => (
              <div
                key={hour.hour}
                className="absolute inset-x-0"
                style={{ top: `${hour.visualStart}px`, height: `${hour.visualHeight}px` }}
              >
                <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
                {!hour.active ? <div className="absolute inset-x-3 inset-y-1 rounded-md bg-muted/35" /> : null}
              </div>
            ))}
            <div className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ top: `${timelineHeight}px` }} />

            {items.length === 0 ? (
              <div className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-2xl border border-dashed border-primary/30 bg-background/92 p-4 text-sm text-muted-foreground shadow-sm">
                <p className="font-medium text-foreground">{copy.emptyDayLane}</p>
                <p className="mt-1">{copy.emptyDayLaneDescription}</p>
              </div>
            ) : null}

            {composerDraft ? (
              <TimelineCreateComposer
                draft={composerDraft}
                timelineHeight={timelineHeight}
                runtimeAdapters={runtimeAdapters}
                defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                isPending={isPending}
                onClose={() => setComposerDraft(null)}
                onCreate={async (input) => {
                  await onCreateTaskBlock(input);
                  setComposerDraft(null);
                }}
              />
            ) : null}

            {draggedItem && dragPreview ? (
              <div
                className="pointer-events-none absolute left-3 right-3 rounded-2xl border border-dashed border-primary/50 bg-primary/10 p-3 shadow-sm"
                style={{ top: `${dragPreview.top}px`, minHeight: "56px", height: `${dragPreview.height}px` }}
              >
                <div className="flex h-full gap-3 overflow-hidden">
                  <div className="w-1 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 space-y-1">
                    <p className="line-clamp-1 text-sm font-medium text-foreground">{draggedItem.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTimeRange(dragPreview.startAt, dragPreview.endAt, locale, copy)} · {draggedItem.kind === "queue" ? copy.dropToSchedule : copy.dropToMoveBlock}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {items.map((item) => {
              const accent = getPriorityAccent(item.priority);
              const start = item.scheduledStartAt
                ? item.scheduledStartAt.getHours() * 60 + item.scheduledStartAt.getMinutes()
                : 0;
              const end = item.scheduledEndAt
                ? item.scheduledEndAt.getHours() * 60 + item.scheduledEndAt.getMinutes()
                : start + 60;
              const safeEnd = Math.max(end, start + 45);
              const top = compressedTimeline.mapMinuteToY(start);
              const height = Math.max(compressedTimeline.mapMinuteToY(safeEnd) - top, 56);
              const isSelected = selectedTaskId === item.taskId;

              return (
                <LocalizedLink
                  data-timeline-block
                  key={item.taskId}
                  href={buildScheduleHref(selectedDay, item.taskId)}
                  draggable={!isPending}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.taskId);
                    onScheduledDragStart(item);
                  }}
                  onDragEnd={onDragEnd}
                  className={`absolute left-3 right-3 rounded-2xl border bg-background/95 p-3 shadow-sm transition-colors hover:border-primary/50 ${
                    isSelected ? "border-primary ring-1 ring-primary/30" : "border-border"
                  }`}
                  style={{ top: `${top}px`, minHeight: "56px", height: `${height}px` }}
                >
                  <div className="flex h-full gap-3 overflow-hidden">
                    <div className={`w-1 shrink-0 rounded-full ${accent}`} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Move className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <p className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <StatusBadge tone={getPriorityTone(item.priority)} className="px-2 py-0.5 text-[11px]">
                            {item.priority}
                          </StatusBadge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatTimeRange(item.scheduledStartAt, item.scheduledEndAt, locale, copy)}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {describeOwner(item.ownerType, item.assigneeAgentId, copy)}
                      </p>
                      {item.scheduleStatus === "Overdue" || item.approvalPendingCount ? (
                        <div className="flex flex-wrap gap-1 pt-1 text-[11px] text-muted-foreground">
                          {item.scheduleStatus === "Overdue" ? (
                            <StatusBadge tone="critical" className="px-2 py-0.5 text-[11px]">
                              {copy.overdue}
                            </StatusBadge>
                          ) : null}
                          {item.approvalPendingCount ? (
                            <StatusBadge tone="warning" className="px-2 py-0.5 text-[11px]">
                              {copy.approvalPending}
                            </StatusBadge>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </LocalizedLink>
              );
            })}
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

function SelectedBlockSheet({
  item,
  selectedDay,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onSaveTaskConfigAction,
}: {
  item: ScheduledItem;
  selectedDay: string;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onSaveTaskConfigAction: (taskId: string, input: TaskConfigFormInput) => Promise<void>;
}) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };

  return (
    <>
      <LocalizedLink
        href={buildScheduleHref(selectedDay)}
        aria-label={copy.closeTaskDetails}
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-task-sheet-title"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-3xl border border-border/70 bg-background p-5 shadow-2xl md:inset-y-4 md:right-4 md:left-auto md:w-[min(520px,92vw)] md:max-h-none md:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="space-y-1">
            <h2 id="schedule-task-sheet-title" className="text-sm font-semibold text-foreground">
              {copy.taskDetails}
            </h2>
            <p className="text-sm text-muted-foreground">
              {copy.taskDetailsDescription}
            </p>
          </div>
          <LocalizedLink href={buildScheduleHref(selectedDay)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {copy.close}
          </LocalizedLink>
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto pr-1 text-sm text-muted-foreground md:max-h-[calc(100vh-9rem)]">
          <div className="space-y-2">
            <p className="text-base font-medium text-foreground">{item.title}</p>
            <p>{formatTimeRange(item.scheduledStartAt, item.scheduledEndAt, locale, copy)}</p>
            <ItemMeta item={item} />
          </div>

          <DetailGrid
            items={[
              { label: copy.due, value: formatDateTime(item.dueAt, locale) },
              { label: copy.currentPlan, value: item.scheduleStatus ?? copy.scheduledMetric },
              { label: copy.latestRun, value: item.latestRunStatus ?? copy.noActiveRun },
              { label: copy.nextAction, value: item.actionRequired ?? copy.stayOnPlan },
            ]}
          />

          <SurfaceCard as="div" variant="inset" padding="sm" className="rounded-2xl border-dashed">
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">{copy.taskConfig}</p>
            <TaskConfigForm
              runtimeAdapters={runtimeAdapters}
              defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
              isPending={isPending}
              initialValues={toTaskConfigInitialValues(item)}
              submitLabel={copy.saveTaskConfig}
              pendingLabel={copy.saving}
              onSubmitAction={(input) => onSaveTaskConfigAction(item.taskId, input)}
            />
          </SurfaceCard>

          <TaskContextLinks
            workspaceId={item.workspaceId}
            taskId={item.taskId}
            latestRunStatus={item.latestRunStatus}
            workLabel={t("common.openWorkbench")}
          />

          <SurfaceCard as="div" variant="inset" padding="sm" className="rounded-2xl border-dashed">
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">{copy.adjustBlock}</p>
            <ScheduleEditorForm
              taskId={item.taskId}
              dueAt={item.dueAt}
              scheduledStartAt={item.scheduledStartAt}
              scheduledEndAt={item.scheduledEndAt}
              submitLabel={copy.scheduleTask}
            />
          </SurfaceCard>
        </div>
      </section>
    </>
  );
}

function QueueTaskConfigEditor({
  item,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isPending,
  onSaveTaskConfigAction,
}: {
  item: UnscheduledItem;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isPending: boolean;
  onSaveTaskConfigAction: (taskId: string, input: TaskConfigFormInput) => Promise<void>;
}) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  return (
    <TaskConfigForm
      runtimeAdapters={runtimeAdapters}
      defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
      isPending={isPending}
      initialValues={toTaskConfigInitialValues(item)}
      submitLabel={copy.saveTaskConfig}
      pendingLabel={copy.saving}
      onSubmitAction={(input) => onSaveTaskConfigAction(item.taskId, input)}
    />
  );
}

function QueueCard({
  item,
  runtimeAdapters,
  defaultRuntimeAdapterKey,
  isDragging,
  isPending,
  isExpanded,
  onToggle,
  onSaveTaskConfigAction,
  onDragStart,
  onDragEnd,
}: {
  item: UnscheduledItem;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  defaultRuntimeAdapterKey: string;
  isDragging: boolean;
  isPending: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onSaveTaskConfigAction: (taskId: string, input: TaskConfigFormInput) => Promise<void>;
  onDragStart: (item: UnscheduledItem, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  return (
    <SurfaceCard as="div" variant="inset" className={cn("rounded-2xl p-0", isDragging && "border-primary/40 bg-primary/5") }>
      <div
        draggable={!isPending}
        aria-label={`Drag ${item.title} to the timeline`}
        onDragStart={(event) => onDragStart(item, event)}
        onDragEnd={onDragEnd}
        className={cn(
          "flex cursor-grab items-start gap-3 rounded-2xl px-4 py-3 active:cursor-grabbing",
          isPending && "cursor-not-allowed",
        )}
      >
        <div className="mt-0.5 rounded-xl border border-dashed border-border/70 bg-background/70 p-2 text-muted-foreground">
          <GripVertical className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <LocalizedLink
                href={`/workspaces/${item.workspaceId}/tasks/${item.taskId}`}
                draggable={false}
                className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
              >
                {item.title}
              </LocalizedLink>
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={getPriorityTone(item.priority)}>{item.priority}</StatusBadge>
                <StatusBadge tone={getRunnabilityTone(item.isRunnable)}>{item.runnabilitySummary}</StatusBadge>
                {item.dueAt ? <StatusBadge>{copy.due} {formatDateTime(item.dueAt, locale)}</StatusBadge> : null}
                {item.actionRequired ? <StatusBadge tone="warning">{item.actionRequired}</StatusBadge> : null}
              </div>
            </div>
            <button type="button" onClick={onToggle} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <ChevronDown className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {isPending ? copy.schedulingUpdating : copy.dragHint}
          </p>
        </div>
      </div>

      {isExpanded ? (
        <div className="space-y-3 border-t border-border/60 px-4 py-4">
          <DetailGrid
            items={[
              { label: copy.due, value: formatDateTime(item.dueAt, locale) },
              { label: copy.pendingProposals, value: String(item.scheduleProposalCount) },
              { label: copy.runnable, value: item.runnabilitySummary },
              { label: copy.model, value: item.runtimeModel ?? "-" },
              { label: copy.latestRun, value: item.latestRunStatus ?? copy.noActiveRun },
            ]}
          />

          <SurfaceCard as="div" variant="default" padding="sm" className="rounded-2xl border-dashed">
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">{copy.taskConfig}</p>
              <QueueTaskConfigEditor
                item={item}
                runtimeAdapters={runtimeAdapters}
                defaultRuntimeAdapterKey={defaultRuntimeAdapterKey}
                isPending={isPending}
                onSaveTaskConfigAction={onSaveTaskConfigAction}
              />
          </SurfaceCard>

          <TaskContextLinks
            workspaceId={item.workspaceId}
            taskId={item.taskId}
            latestRunStatus={item.latestRunStatus}
            workLabel={t("common.openWorkbench")}
          />

          <SurfaceCard as="div" variant="default" padding="sm" className="rounded-2xl border-dashed">
            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">{copy.placeOnTimeline}</p>
            <ScheduleEditorForm taskId={item.taskId} dueAt={item.dueAt} allowClear={false} submitLabel={copy.scheduleTask} />
          </SurfaceCard>
        </div>
      ) : null}
    </SurfaceCard>
  );
}

function ProposalCard({
  proposal,
  isPending,
  onAccept,
  onReject,
}: {
  proposal: SchedulePageProps["data"]["proposals"][number];
  isPending: boolean;
  onAccept: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
}) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  return (
    <SurfaceCard key={proposal.proposalId} as="div" variant="inset" className="rounded-2xl">
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="space-y-2">
          <LocalizedLink
            href={`/workspaces/${proposal.workspaceId}/tasks/${proposal.taskId}`}
            className="text-base font-medium text-foreground transition-colors hover:text-primary"
          >
            {proposal.title}
          </LocalizedLink>
          <ItemMeta item={proposal} />
        </div>
        <p>{proposal.summary}</p>
        <DetailGrid
          items={[
              { label: copy.proposedBy, value: proposal.proposedBy },
              {
                label: copy.candidateBlock,
                value: `${formatDateTime(proposal.scheduledStartAt, locale)} → ${formatDateTime(proposal.scheduledEndAt, locale)}`,
              },
              { label: copy.dueImpact, value: formatDateTime(proposal.dueAt, locale) },
              { label: copy.source, value: proposal.source },
            ]}
          />
        <TaskContextLinks workspaceId={proposal.workspaceId} taskId={proposal.taskId} workLabel={t("common.openWorkbench")} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              void onAccept(proposal.proposalId);
            }}
            className={buttonVariants({ variant: "default" })}
          >
            {copy.acceptProposal}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              void onReject(proposal.proposalId);
            }}
            className={buttonVariants({ variant: "outline" })}
          >
            {copy.rejectProposal}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
}

function RiskCard({ item }: { item: SchedulePageProps["data"]["risks"][number] }) {
  const locale = useLocale();
  const { messages, t } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  return (
    <SurfaceCard as="div" variant="inset" className="rounded-2xl">
      <div className="space-y-3 text-sm text-muted-foreground">
        <div className="space-y-2">
          <LocalizedLink
            href={`/workspaces/${item.workspaceId}/work/${item.taskId}`}
            className="text-base font-medium text-foreground transition-colors hover:text-primary"
          >
            {item.title}
          </LocalizedLink>
          <ItemMeta item={item} />
        </div>
        <DetailGrid
          items={[
             { label: copy.risk, value: item.scheduleStatus ?? item.persistedStatus ?? copy.needsReview },
             { label: copy.action, value: item.actionRequired ?? copy.reviewScheduleImpact },
             {
               label: copy.plannedWindow,
               value: `${formatDateTime(item.scheduledStartAt, locale)} → ${formatDateTime(item.scheduledEndAt, locale)}`,
             },
             { label: copy.due, value: formatDateTime(item.dueAt, locale) },
           ]}
         />
        <div className="flex flex-wrap gap-2">
          <TaskContextLinks
            workspaceId={item.workspaceId}
            taskId={item.taskId}
            latestRunStatus={item.latestRunStatus}
            workLabel={t("common.openWorkbench")}
          />
          <LocalizedLink href="/inbox" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {copy.openInbox}
          </LocalizedLink>
        </div>
      </div>
    </SurfaceCard>
  );
}

export function SchedulePage({
  workspaceId,
  data,
  selectedDay,
  selectedTaskId,
  selectedView,
}: SchedulePageProps & { selectedDay?: string; selectedTaskId?: string; selectedView?: string }) {
  const router = useRouter();
  const locale = useLocale();
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.schedulePage ?? {}) };
  const [viewData, setViewData] = useState<SchedulePageData>(data);
  const [draggedTask, setDraggedTask] = useState<{ kind: TimelineDragItem["kind"]; taskId: string } | null>(null);
  const [expandedQueueTaskIds, setExpandedQueueTaskIds] = useState<string[]>([]);
  const [localSelectedTaskId, setLocalSelectedTaskId] = useState<string | undefined>(selectedTaskId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>("");
  const [isPending, setIsPending] = useState(false);
  const activeView = normalizeScheduleView(selectedView);

  useEffect(() => {
    setViewData(data);
  }, [data]);

  useEffect(() => {
    setLocalSelectedTaskId(selectedTaskId);
  }, [selectedTaskId]);

  const scheduledGroups = useMemo(
    () => buildWeekGroups(viewData.scheduled, viewData.proposals, viewData.risks, selectedDay),
    [selectedDay, viewData.proposals, viewData.risks, viewData.scheduled],
  );

  const todayKey = getTodayKey();
  const selectedGroupKey = scheduledGroups.find((group) => group.key === selectedDay)?.key;
  const todayGroupKey = scheduledGroups.find((group) => group.key === todayKey)?.key;
  const todayGroup = scheduledGroups.find((group) => group.key === todayGroupKey) ?? null;
  const firstPopulatedGroup =
    scheduledGroups.find((group) => group.items.length > 0 || group.proposalCount > 0 || group.riskCount > 0)?.key ?? null;
  const activeDay =
    selectedGroupKey ??
    (todayGroup && (todayGroup.items.length > 0 || todayGroup.proposalCount > 0 || todayGroup.riskCount > 0)
      ? todayGroup.key
      : null) ??
    firstPopulatedGroup ??
    scheduledGroups[0]?.key ??
    todayKey;
  const activeGroup = scheduledGroups.find((group) => group.key === activeDay) ?? null;
  const activeSelectedTaskId = localSelectedTaskId ?? selectedTaskId;
  const selectedItem = activeGroup?.items.find((item) => item.taskId === activeSelectedTaskId) ?? null;
  const tomorrowKey = formatDateKey(addDays(startOfDay(new Date()), 1));
  const todayFocusItems = useMemo(() => buildTodayFocusItems(viewData, activeGroup, copy), [activeGroup, copy, viewData]);
  const draggedQueueItem =
    draggedTask?.kind === "queue" ? viewData.unscheduled.find((item) => item.taskId === draggedTask.taskId) ?? null : null;
  const draggedScheduledItem =
    draggedTask?.kind === "scheduled" ? activeGroup?.items.find((item) => item.taskId === draggedTask.taskId) ?? null : null;
  const draggedItem: TimelineDragItem | null = draggedQueueItem
    ? {
        kind: "queue",
        taskId: draggedQueueItem.taskId,
        title: draggedQueueItem.title,
        dueAt: draggedQueueItem.dueAt,
        durationMinutes: DEFAULT_SCHEDULE_BLOCK_MINUTES,
      }
    : draggedScheduledItem
      ? {
          kind: "scheduled",
          taskId: draggedScheduledItem.taskId,
          title: draggedScheduledItem.title,
          dueAt: draggedScheduledItem.dueAt,
          durationMinutes: getBlockDurationMinutes(draggedScheduledItem),
        }
      : null;

  async function runAction(action: () => Promise<void>) {
    try {
      setIsPending(true);
      setErrorMessage(null);
      await action();
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed");
    } finally {
      setIsPending(false);
    }
  }

  function handleQueueDragStart(item: UnscheduledItem, event: DragEvent<HTMLElement>) {
    if (isPending) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.taskId);
    setDraggedTask({ kind: "queue", taskId: item.taskId });
    setErrorMessage(null);
    setAnnouncement(`Picked up ${item.title}. Move it to the timeline to create a block.`);
  }

  function handleQueueDragEnd() {
    setDraggedTask(null);
  }

  function handleScheduledDragStart(item: ScheduledItem) {
    setDraggedTask({ kind: "scheduled", taskId: item.taskId });
    setErrorMessage(null);
    setAnnouncement(`Picked up scheduled block ${item.title}. Drop it on a new slot to move the block.`);
  }

  async function handleScheduleDrop(item: TimelineDragItem, startAt: Date, endAt: Date) {
    setAnnouncement(`Dropped ${item.title} on ${formatDayHeading(startAt, locale, copy)} at ${formatTime(startAt, locale)}.`);

    try {
      setIsPending(true);
      setErrorMessage(null);

        if (item.kind === "queue" && draggedQueueItem) {
          setViewData((current) => ({
            ...current,
          summary: {
            ...current.summary,
            scheduledCount: current.summary.scheduledCount + 1,
            unscheduledCount: Math.max(0, current.summary.unscheduledCount - 1),
            },
            scheduled: sortScheduledItems([...current.scheduled, createScheduledItemFromQueueItem(draggedQueueItem, startAt, endAt)]),
            unscheduled: current.unscheduled.filter((queueItem) => queueItem.taskId !== draggedQueueItem.taskId),
            listItems: current.listItems.map((listItem) =>
              listItem.taskId === draggedQueueItem.taskId ? applyScheduleToListItem(listItem, startAt, endAt) : listItem,
            ),
          }));
          setExpandedQueueTaskIds((current) => current.filter((taskId) => taskId !== draggedQueueItem.taskId));
        }

      if (item.kind === "scheduled") {
        setViewData((current) => ({
          ...current,
          scheduled: sortScheduledItems(
            current.scheduled.map((scheduledItem) =>
              scheduledItem.taskId === item.taskId
                ? {
                    ...scheduledItem,
                    dueAt: item.dueAt ?? scheduledItem.dueAt,
                    scheduledStartAt: startAt,
                    scheduledEndAt: endAt,
                    scheduleStatus: "Scheduled",
                    scheduleSource: "human",
                  }
                : scheduledItem,
            ),
          ),
          listItems: current.listItems.map((listItem) =>
            listItem.taskId === item.taskId ? applyScheduleToListItem(listItem, startAt, endAt) : listItem,
          ),
        }));
        setLocalSelectedTaskId(item.taskId);
      }

      await applySchedule({
        taskId: item.taskId,
        dueAt: item.dueAt ?? null,
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        scheduleSource: "human",
      });

      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed");
      setViewData(data);
    } finally {
      setIsPending(false);
      setDraggedTask(null);
    }
  }

  async function handleCreateTaskBlock(input: TimelineCreateInput) {
    setAnnouncement(`Creating ${input.title} on ${formatDayHeading(input.scheduledStartAt, locale, copy)} at ${formatTime(input.scheduledStartAt, locale)}.`);

    try {
      setIsPending(true);
      setErrorMessage(null);

      const created = await createTaskFromSchedule({
        workspaceId,
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        dueAt: input.dueAt,
        runtimeAdapterKey: input.runtimeAdapterKey,
        runtimeInput: input.runtimeInput,
        runtimeInputVersion: input.runtimeInputVersion,
        runtimeModel: input.runtimeModel,
        prompt: input.prompt,
        runtimeConfig: input.runtimeConfig ?? null,
      });

      await applySchedule({
        taskId: created.taskId,
        dueAt: input.dueAt,
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
        scheduleSource: "human",
      });

      setViewData((current) => ({
        ...current,
        summary: {
          ...current.summary,
          scheduledCount: current.summary.scheduledCount + 1,
        },
        scheduled: sortScheduledItems([
          ...current.scheduled,
          createScheduledItemFromCreateInput(created.taskId, workspaceId, data.defaultRuntimeAdapterKey, input),
        ]),
        listItems: [
          ...current.listItems,
          createListItemFromScheduledItem(
            createScheduledItemFromCreateInput(created.taskId, workspaceId, data.defaultRuntimeAdapterKey, input),
          ),
        ],
      }));
      setLocalSelectedTaskId(created.taskId);
      router.push(localizeHref(locale, buildScheduleViewHref(activeDay, activeView, created.taskId)));
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed");
      setViewData(data);
    } finally {
      setIsPending(false);
    }
  }

  async function handleAcceptProposal(proposalId: string) {
    await runAction(async () => {
      await acceptScheduleProposal(proposalId, "Accepted on schedule page");
    });
  }

  async function handleRejectProposal(proposalId: string) {
    await runAction(async () => {
      await rejectScheduleProposal(proposalId, "Rejected on schedule page");
    });
  }

  function toggleQueueCard(taskId: string) {
    setExpandedQueueTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  }

  async function handleTaskConfigSave(taskId: string, input: TaskConfigFormInput) {
    try {
      setIsPending(true);
      setErrorMessage(null);

      setViewData((current) => ({
        ...current,
        scheduled: current.scheduled.map((item) => (item.taskId === taskId ? applyTaskConfigToItem(item, input) : item)),
        unscheduled: current.unscheduled.map((item) => (item.taskId === taskId ? applyTaskConfigToItem(item, input) : item)),
        risks: current.risks.map((item) => (item.taskId === taskId ? applyTaskConfigToItem(item, input) : item)),
        listItems: current.listItems.map((item) => (item.taskId === taskId ? applyTaskConfigToItem(item, input) : item)),
      }));

      await updateTaskConfigFromSchedule({
        taskId,
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        dueAt: input.dueAt,
        runtimeAdapterKey: input.runtimeAdapterKey,
        runtimeInput: input.runtimeInput,
        runtimeInputVersion: input.runtimeInputVersion,
        runtimeModel: input.runtimeModel,
        prompt: input.prompt,
        runtimeConfig: input.runtimeConfig ?? null,
      });

      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : messages.components?.scheduleEditorForm?.actionFailed ?? "Action failed");
      setViewData(data);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-8">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <div className="space-y-4">
        <SurfaceCard variant="highlight" className="space-y-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">{copy.pageTitle}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {copy.pageDescription}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{copy.dateSwitcher}</span>
              <div className="flex flex-wrap gap-2 rounded-2xl border border-border/60 bg-background/70 p-1">
                <LocalizedLink href={buildScheduleViewHref(todayKey, activeView)} className={buttonVariants({ variant: activeDay === todayKey ? "default" : "ghost", size: "sm" })}>
                  {copy.today}
                </LocalizedLink>
                <LocalizedLink href={buildScheduleViewHref(tomorrowKey, activeView)} className={buttonVariants({ variant: activeDay === tomorrowKey ? "default" : "ghost", size: "sm" })}>
                  {copy.tomorrow}
                </LocalizedLink>
                <LocalizedLink href={buildScheduleViewHref(activeDay, activeView)} className={buttonVariants({ variant: activeDay !== todayKey && activeDay !== tomorrowKey ? "default" : "ghost", size: "sm" })}>
                  {copy.currentPlanButton}
                </LocalizedLink>
              </div>
            </div>

          </div>

          {errorMessage ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <StatusBadge>{copy.todayBlocks}: {activeGroup?.items.length ?? 0}</StatusBadge>
            <StatusBadge tone={viewData.summary.unscheduledCount > 0 ? "info" : "neutral"}>{copy.queueReady}: {viewData.summary.unscheduledCount}</StatusBadge>
            <StatusBadge tone={viewData.summary.riskCount > 0 ? "critical" : "neutral"}>{copy.needsAttention}: {viewData.summary.riskCount}</StatusBadge>
            {viewData.summary.proposalCount > 0 ? (
              <StatusBadge tone="info">{copy.aiProposalsMetric}: {viewData.summary.proposalCount}</StatusBadge>
            ) : null}
          </div>
        </SurfaceCard>
      </div>

      <div className="space-y-4 xl:min-h-[calc(100vh-16rem)]">
        <TodayFocusCard items={todayFocusItems} copy={copy} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2.9fr)_minmax(340px,1fr)] xl:items-start">
          <SurfaceCard variant="highlight">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SurfaceCardHeader>
                <SurfaceCardTitle>{copy.scheduledTimeline}</SurfaceCardTitle>
                <SurfaceCardDescription>
                  {copy.scheduledTimelineDescription}
                </SurfaceCardDescription>
              </SurfaceCardHeader>
              <div className="flex flex-wrap items-center gap-2">
                {draggedItem ? <StatusBadge tone="info">{copy.dropMode}</StatusBadge> : null}
                <StatusBadge>{copy.planningSurface}</StatusBadge>
                <LocalizedLink
                  href={buildScheduleViewHref(activeDay, "timeline", activeSelectedTaskId)}
                  className={buttonVariants({ variant: activeView === "timeline" ? "default" : "outline", size: "sm" })}
                >
                  {copy.timeline}
                </LocalizedLink>
                <LocalizedLink
                  href={buildScheduleViewHref(activeDay, "list", activeSelectedTaskId)}
                  className={buttonVariants({ variant: activeView === "list" ? "default" : "outline", size: "sm" })}
                >
                  {copy.list}
                </LocalizedLink>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {activeView === "timeline" ? (
                activeGroup ? (
                  <DayTimeline
                    items={activeGroup.items}
                    dayDate={activeGroup.date}
                    selectedDay={activeGroup.key}
                    selectedTaskId={selectedTaskId}
                    draggedItem={draggedItem}
                    runtimeAdapters={data.runtimeAdapters}
                    defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                    isPending={isPending}
                    onScheduleDrop={handleScheduleDrop}
                    onCreateTaskBlock={handleCreateTaskBlock}
                    onScheduledDragStart={handleScheduledDragStart}
                    onDragEnd={handleQueueDragEnd}
                  />
                ) : (
                  <EmptyState>{copy.noTimelineDay}</EmptyState>
                )
              ) : (
                  <ScheduleTaskList
                    items={viewData.listItems}
                    runtimeAdapters={data.runtimeAdapters}
                    defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                    onSaveTaskConfigAction={handleTaskConfigSave}
                    isPending={isPending}
                  />
              )}
            </div>
          </SurfaceCard>

          <SurfaceCard className="xl:sticky xl:top-4 xl:self-start">
            <SurfaceCardHeader>
              <SurfaceCardTitle>{copy.unscheduledQueue}</SurfaceCardTitle>
              <SurfaceCardDescription>
                {copy.unscheduledQueueDescription}
              </SurfaceCardDescription>
            </SurfaceCardHeader>

            <div className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-1 text-sm text-muted-foreground">
              {viewData.unscheduled.length === 0 ? (
                <EmptyState>
                  {copy.noUnscheduledWork}
                </EmptyState>
              ) : (
                viewData.unscheduled.map((item) => (
                  <QueueCard
                    key={item.taskId}
                    item={item}
                    runtimeAdapters={data.runtimeAdapters}
                    defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
                    isPending={isPending}
                    isDragging={draggedTask?.kind === "queue" && draggedTask.taskId === item.taskId}
                    isExpanded={expandedQueueTaskIds.includes(item.taskId)}
                    onToggle={() => toggleQueueCard(item.taskId)}
                    onSaveTaskConfigAction={handleTaskConfigSave}
                    onDragStart={handleQueueDragStart}
                    onDragEnd={handleQueueDragEnd}
                  />
                ))
              )}
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard>
            <SurfaceCardHeader>
              <SurfaceCardTitle>{copy.secondaryPlanning}</SurfaceCardTitle>
              <SurfaceCardDescription>{copy.secondaryPlanningDescription}</SurfaceCardDescription>
            </SurfaceCardHeader>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(280px,0.8fr)]">
              <div className="space-y-4">
                <div>
                  <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">{copy.weekOverview}</h3>
                  <WeekStrip groups={scheduledGroups} selectedDay={activeDay} />
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{copy.conflictsTitle}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{copy.conflictsDescription}</p>
                    </div>
                    <StatusBadge tone={viewData.risks.length > 0 ? "critical" : "neutral"}>{viewData.risks.length}</StatusBadge>
                  </div>
                  <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                    {viewData.risks.length === 0 ? (
                      <EmptyState>{copy.noScheduleRisks}</EmptyState>
                    ) : (
                      viewData.risks.slice(0, 2).map((item) => <RiskCard key={item.taskId} item={item} />)
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{copy.aiProposalsTitle}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{copy.aiProposalsDescription}</p>
                  </div>
                  <StatusBadge tone={viewData.proposals.length > 0 ? "info" : "neutral"}>{viewData.proposals.length}</StatusBadge>
                </div>
                <div className="mt-3 space-y-4 text-sm text-muted-foreground">
                  {viewData.proposals.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                      {copy.aiProposalsCompactEmpty}
                    </div>
                  ) : (
                    viewData.proposals.slice(0, 2).map((proposal) => (
                      <ProposalCard
                        key={proposal.proposalId}
                        proposal={proposal}
                        isPending={isPending}
                        onAccept={handleAcceptProposal}
                        onReject={handleRejectProposal}
                      />
                    ))
                  )}
                </div>
              </div>

              <details className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                <summary className="cursor-pointer list-none text-sm font-semibold text-foreground">{copy.planningGuide}</summary>
                <div className="mt-3 space-y-2">
                  <p>{copy.guideStep1}</p>
                  <p>{copy.guideStep2}</p>
                  <p>{copy.guideStep3}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <LocalizedLink href="/tasks" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {copy.openTaskCenter}
                  </LocalizedLink>
                  <LocalizedLink href="/inbox" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Open Inbox
                  </LocalizedLink>
                </div>
              </details>
            </div>
        </SurfaceCard>
      </div>

      {activeView === "timeline" && selectedItem && activeDay ? (
        <SelectedBlockSheet
          item={selectedItem}
          selectedDay={activeDay}
          runtimeAdapters={data.runtimeAdapters}
          defaultRuntimeAdapterKey={data.defaultRuntimeAdapterKey}
          isPending={isPending}
          onSaveTaskConfigAction={handleTaskConfigSave}
        />
      ) : null}
    </div>
  );
}
