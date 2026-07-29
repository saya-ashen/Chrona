import { resolveLocale, type Locale } from "./locale-core";

export {
  defaultLocale,
  getPreferredLocale,
  hasLocale,
  locales,
  resolveLocale,
} from "./locale-core";
export type { Locale } from "./locale-core";

const assistantSurfaceMessages = {
  en: {
    title: "Chrona AI",
    primaryObjectLabel: "Chrona",
    statusLabel: "Status",
    noActiveContext: "No active assistant context",
    askAboutPage: "Ask about this page",
    informationalGuidance: "Get informational guidance for this page.",
    nonMutatingGuidance: "Get non-mutating guidance for the current page.",
    scheduleUnavailable: "Schedule state is supplied by the active page projection.",
    taskUnavailable: "Task state is supplied by the active workspace projection.",
    workbenchUnavailable: "Workbench result actions are available from execution result context.",
    unsupportedUnavailable: "This page does not expose assistant actions yet.",
    actionRequestDescription: "Assistant action request",
    actionQueued: "Assistant action queued for page context.",
    proposalCreated: "Proposal route created. Confirm changes on the owning page.",
    proposalTitle: "Assistant proposal",
    schedulePreviewReason: "Preview only. Confirm from the schedule page.",
    dropdownProposalExplanation: "Proposal created by the dropdown. Page preview owns confirmation.",
    suggestedFollowUp: "Assistant suggested follow-up",
    previewRouteSummary: "Preview route created. No task changes applied from dropdown.",
    openOwningPagePreview: "open owning page preview to confirm.",
    generalPage: "General page",
    modeLabel: "Mode",
    informationalMode: "Informational",
    taskPlanArea: "Task plan",
    activeNodeArea: "Active node",
    taskProposalExplanation: "Preview task changes before routing confirmation through task apply ownership.",
    guardedFollowUpStep: "Add a guarded follow-up step",
    proposedChangesUnapplied: "Proposed changes remain unapplied until confirmed.",
    scheduleTimelineArea: "Schedule timeline",
    unscheduledQueueArea: "Unscheduled queue",
    scheduleProposalExplanation: "Preview ghost blocks before applying changes to the schedule.",
    nextQueuedTask: "Next queued task",
    focusBlock: "Focus block",
    largestOpeningReason: "Largest available opening in the current day.",
    remainingQueue: "Remaining queue",
    needsLargerOpening: "Needs a larger opening.",
    previewResolvesConflict: "Preview resolves one detected conflict.",
    conflictsNeedReview: "Some conflicts need manual review.",
    explainOrRefine: "I can explain context or replace the current preview with a refined proposal.",
    applyFailed: "Apply failed",
    refinedSummary: "{summary} (refined)",
  },
  zh: {
    title: "Chrona AI",
    primaryObjectLabel: "Chrona",
    statusLabel: "状态",
    noActiveContext: "暂无可用的助手上下文",
    askAboutPage: "询问当前页面",
    informationalGuidance: "获取当前页面的信息性指导。",
    nonMutatingGuidance: "获取当前页面的非变更性指导。",
    scheduleUnavailable: "日程状态由当前页面投影提供。",
    taskUnavailable: "任务状态由当前工作区投影提供。",
    workbenchUnavailable: "执行结果操作可在执行结果上下文中使用。",
    unsupportedUnavailable: "当前页面尚未开放助手操作。",
    actionRequestDescription: "助手操作请求",
    actionQueued: "助手操作已加入当前页面上下文队列。",
    proposalCreated: "已创建建议入口。请在所属页面确认更改。",
    proposalTitle: "助手建议",
    schedulePreviewReason: "仅预览。请在日程页面确认。",
    dropdownProposalExplanation: "建议由下拉菜单创建，页面预览负责确认。",
    suggestedFollowUp: "助手建议的后续步骤",
    previewRouteSummary: "已创建预览入口。下拉菜单未直接更改任务。",
    openOwningPagePreview: "打开所属页面预览以确认。",
    generalPage: "通用页面",
    modeLabel: "模式",
    informationalMode: "信息说明",
    taskPlanArea: "任务计划",
    activeNodeArea: "当前节点",
    taskProposalExplanation: "预览任务更改，再通过任务页面的应用流程确认。",
    guardedFollowUpStep: "添加受保护的后续步骤",
    proposedChangesUnapplied: "建议更改会在确认前保持未应用。",
    scheduleTimelineArea: "日程时间线",
    unscheduledQueueArea: "未安排队列",
    scheduleProposalExplanation: "在应用到日程前预览幽灵区块。",
    nextQueuedTask: "下一个队列任务",
    focusBlock: "专注区块",
    largestOpeningReason: "当前日期中最大的可用空档。",
    remainingQueue: "剩余队列",
    needsLargerOpening: "需要更大的空档。",
    previewResolvesConflict: "预览将解决一个已检测到的冲突。",
    conflictsNeedReview: "部分冲突需要人工检查。",
    explainOrRefine: "我可以解释上下文，或用细化后的建议替换当前预览。",
    applyFailed: "应用失败",
    refinedSummary: "{summary}（已细化）",
  },
} as const;

export type AssistantSurfaceMessages = (typeof assistantSurfaceMessages)[Locale];

export function getAssistantSurfaceMessages(locale?: string | null): AssistantSurfaceMessages {
  return assistantSurfaceMessages[resolveLocale(locale)];
}

const apiMessages = {
  en: {
    unauthorized: "Unauthorized",
    notFound: "Not found",
    internalServerError: "Internal server error",
    malformedJson: "Malformed JSON request body",
    invalidLimit: "limit must be a valid integer",
    invalidDateField: "{field} must be a valid date string",
    planGenerationInFlight: "A task plan generation job is already running. Stop the current generation before starting a new one.",
    failedGenerateTaskPlan: "Failed to generate task plan",
  },
  zh: {
    unauthorized: "未授权",
    notFound: "未找到",
    internalServerError: "服务器内部错误",
    malformedJson: "请求体 JSON 格式错误",
    invalidLimit: "limit 必须是有效整数",
    invalidDateField: "{field} 必须是有效日期字符串",
    planGenerationInFlight: "任务计划生成任务已在运行。请先停止当前生成，再启动新的生成。",
    failedGenerateTaskPlan: "任务计划生成失败",
  },
} as const;

export type ApiMessages = (typeof apiMessages)[Locale];

export function getApiMessages(locale?: string | null): ApiMessages {
  return apiMessages[resolveLocale(locale)];
}

export type { Messages } from "./messages";
export { fallbackMessages } from "./messages";
export { getDictionary } from "./get-dictionary";
export { localizeHref, stripLocalePrefix } from "./routing";
export { externalCalendarMessages } from "./external-calendar-messages";
