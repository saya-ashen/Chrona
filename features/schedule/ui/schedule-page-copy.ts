export const TIMELINE_SLOT_MINUTES = 30;
export const DEFAULT_SCHEDULE_BLOCK_MINUTES = 60;
export const TIMELINE_COMPOSER_HEIGHT = 356;
export const TIMELINE_COMPOSER_MARGIN = 12;

export const DEFAULT_SCHEDULE_PAGE_COPY = {
  planPrefix: "Plan",
  runPrefix: "Run",
  approvalsPrefix: "Approvals",
  blockSingular: "block",
  blockPlural: "blocks",
  proposalSingular: "proposal",
  proposalPlural: "proposals",
  noScheduledStart: "No scheduled start",
  errorPrefix: "Error",
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
  quickCreateTitleLabel: "Title",
  quickCreateTitlePlaceholder: "What needs to happen?",
  quickCreateQueueTitlePlaceholder: "Add a task to the queue",
  quickCreateStartLabel: "Start",
  quickCreateStartNowLabel: "Now",
  currentTimeLabel: "Current time",
  quickCreateStartMorningLabel: "Morning",
  quickCreateStartAfternoonLabel: "Afternoon",
  quickCreateStartEveningLabel: "Evening",
  quickCreateDurationLabel: "Duration",
  quickCreateDurationMinutesLabel: "min",
  quickCreateDurationHoursLabel: "hours",
  quickCreatePriorityLabel: "Priority",
  quickCreateQueueSubmit: "Add to queue",
  quickCreateQueueHint:
    "Create a lightweight task first, then drag it onto the timeline when you are ready to place it.",
  dropOntoLane: "Drop work onto the lane",
  clickOrDrag: "Click any slot or drag to adjust",
  timelineCompressedPrefix: "Timeline compressed: 24h shown as",
  emptyDayLane: "Empty day lane",
  emptyDayLaneDescription:
    "Drop a queued task anywhere on this lane to create the first block.",
  dropToSchedule: "Drop to schedule",
  dropToMoveBlock: "Drop to move block",
  overdue: "Overdue",
  approvalPending: "Approval pending",
  conflictPreviewLabel:
    "Conflict — resolve overlap before committing this block.",
  resizePreviewLabel: "Resize block",
  adjustBlock: "Adjust block",
  resizeHandleLabel: "Resize",
  quickCreatePlaceholder: "Task title, @ 14:30, for 90m, !high",
  quickCreateSubmit: "Add block",
  quickCreateHint:
    "Examples: 'Write weekly report @ 14:30 for 90m !high' or just type a title for the next open slot.",
  quickCreateUnsafeAiInput:
    "AI could not safely interpret this input. Add a clearer task description and try again. Local parser fallback was not used.",
  closeTaskDetails: "Close task details",
  taskDetails: "Task Details",
  taskDetailsDescription:
    "Review the selected block in a floating panel, then return to the timeline.",
  taskDetailsEyebrow: "Task cockpit",
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
  scheduledWindow: "Scheduled window",
  placeOnTimeline: "Place on timeline",
  scheduleTask: "Schedule Task",
  schedulingUpdating: "Scheduling is updating.",
  dragHint:
    "Drag to the timeline or expand for details and fallback scheduling.",
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
  openActionCenter: "Open Action Center",
  pageTitle: "Schedule",
  cockpitSummary:
    "See today’s load, what is still waiting, and where the next decision should happen.",
  cockpitTodayLoad: "Today load",
  cockpitTodayLoadHint: "Committed work on the active day.",
  cockpitQueueHint: "Tasks that are ready to be placed next.",
  cockpitRisksHint: "Items that need review before the plan feels safe.",
  cockpitSuggestions: "AI suggestions",
  cockpitSuggestionsHint:
    "Automation and proposal opportunities waiting for review.",
  automationTitle: "Automation",
  automationDescription: "Backend-capable execution and scheduling actions.",
  automationEmpty: "No automation candidates right now.",
  automationRunNow: "Run now",
  automationUnsupportedRuntime:
    "This runtime cannot be auto-executed from Chrona.",
  automationBackendOnlyHint:
    "Chrona only sends execution requests to backend-managed runtimes.",
  cockpitReviewSuggestions: "Review suggestions",
  cockpitReviewSuggestionsHint:
    "Switch to the list view to triage tasks and pending proposals.",
  cockpitCreateTask: "Create task",
  cockpitCreateTaskHint:
    "Add the first task or time block directly from Schedule.",
  cockpitConnectAi: "Connect AI",
  cockpitConnectAiHint:
    "Open AI Clients and connect a provider to unlock planning and execution.",
  cockpitSummaryTemplate:
    "{scheduled} scheduled · {queue} queued next · {risks} risks to review · {automation} automation candidates",
  cockpitViewsLabel: "Views",
  cockpitActionsLabel: "Actions",
  insightsTitle: "Insights",
  insightsDescription: "Task distribution and risk signals",
  selectedDay: "Selected day",
  scheduledItems: "Scheduled items",
  riskItems: "Risk items",
  queueTab: "Queue",
  calendarTab: "Calendar",
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
  agenda: "Agenda",
  previousDay: "Previous day",
  nextDay: "Next day",
  scheduleTaskAction: "Schedule task",
  dayWorkspaceTitle: "Day schedule",
  dayEmptyTitle: "Nothing scheduled for this day",
  dayEmptyWithQueueDescription:
    "Choose a ready task or create a new scheduled block.",
  dayEmptyDescription:
    "Create a task block when you are ready to plan this day.",
  dayScheduledSummaryTemplate: "{count} scheduled · {duration}",
  dayPlanningSummaryTemplate:
    "{queue} ready to schedule · {risks} needing attention",
  planningDrawerLabel: "Planning drawer",
  readyToSchedule: "Ready to schedule",
  readyToScheduleDescription:
    "Choose a task to place on the selected day. Dragging remains available for precise placement.",
  needsAttentionTab: "Needs attention",
  scheduleAction: "Schedule",
  scheduleTaskHint:
    "Choose a suggested time or open task details to adjust duration and timing.",
  noAttentionItems: "No scheduling risks need attention.",
  attentionDescription:
    "Resolve work that may make this day unsafe or incomplete.",
  openTask: "Open task",
  noAgendaItems: "No scheduled items for this day.",
  selectedDayAgenda: "Selected day agenda",
  scheduledTimelineDescription: "",
  dropMode: "Drop mode",
  planningSurface: "Planning surface",
  conflictsTitle: "Overdue Risks",
  conflictsDescription: "",
  conflictDetectionTitle: "AI Schedule Review",
  conflictDetectionEmpty: "No schedule issues detected.",
  noScheduleRisks:
    "No schedule risks detected. Blocked, overdue, or interrupted work will surface here.",
  aiProposalsTitle: "AI Proposals",
  aiProposalsDescription: "",
  noAiProposals:
    "No pending AI proposals. When planner automation suggests a new block, it will appear here for review.",
  openTaskCenter: "Open Task Center",
  weekOverview: "Week Overview",
  noTimelineDay: "No timeline day is available right now.",
  unscheduledQueue: "Unscheduled Queue",
  unscheduledQueueDescription:
    "Compact task cards stay ready to drag. Open details for task status, config, and plan context.",
  noUnscheduledWork:
    "No unscheduled work. New tasks that lose their plan or need initial placement will appear here.",
  dateSwitcher: "Date",
  todayFocus: "Today Focus",
  todayFocusEmpty:
    "Nothing urgent is blocking today. Use the queue to place the next meaningful block.",
  firstRunTitle: "Start with Chrona in three steps",
  firstRunDescription:
    "Connect AI, capture a real task, then review the plan before anything runs.",
  firstRunConnectAi: "Connect AI",
  firstRunCreateTask: "Create first task",
  firstRunOpenCreatedTask: "Open created task",
  firstRunStepConnectAiTitle: "Connect AI",
  firstRunStepConnectAi:
    "Add Claude Code or Codex as the AI client Chrona will use.",
  firstRunStepConnectAiDone: "AI client connected. Next, create a real task.",
  firstRunStepCreateTaskTitle: "Create a task",
  firstRunStepCreateTask:
    "Describe the goal, constraints, and context in one task.",
  firstRunStepReviewPlanTitle: "Review the plan",
  firstRunStepReviewPlan:
    "Chrona previews AI suggestions first; you decide what to accept or run.",
  focusOverdue: "Overdue",
  focusAtRisk: "At risk",
  focusWaitingForInput: "Waiting for input",
  focusWaitingForApproval: "Waiting for approval",
  focusReadyToday: "Ready to start today",
  todayBlocks: "Today blocks",
  queueReady: "Queue ready",
  needsAttention: "Needs attention",
  aiProposalsCompactEmpty: "No pending AI proposals.",
  taskPlanLabel: "Task Plan",
  loadingTaskPlan: "Loading task plan…",
  childTasksLabel: "Child Tasks",
  childTaskReopen: "Reopen",
  childTaskMarkDone: "Mark done",
  autoStartNotScheduled: "Not on a schedule block yet",
  autoStartNotDue: "Scheduled, not due yet",
  autoStartAlreadyRunning: "Already running",
  autoStartInvalidTaskStatus: "Prepare this task before it can start",
  autoStartNoRuntimeConfig: "Connect an execution runtime",
  autoStartNoAcceptedPlan: "Review and approve a plan",
  autoStartRequiresHumanInput: "Input needed before this can start",
  autoStartRequiresApproval: "Approval needed before this can start",
  autoStartRuntimeUnsupported: "Choose a runtime that supports automatic start",
  autoStartReasonLabel: "Cannot start automatically",
  selectedBlockOverview: "Block overview",
  selectedBlockSourceCalendar: "External calendar",
  selectedBlockSourceAi: "AI scheduled",
  selectedBlockSourceHuman: "Manually scheduled",
  selectedBlockAutomationPolicy: "Automation",
  selectedBlockAutomationManual: "Manual",
  selectedBlockAutomationPlan: "Auto-plan",
  selectedBlockAutomationExecute: "Auto-execute",
  selectedBlockProvider: "Provider",
  selectedBlockRuntime: "Runtime",
  selectedBlockDefaultProvider: "Use default AI provider",
  selectedBlockProviderUnconfigured: "AI provider not configured",
  selectedBlockExecutionStatus: "Execution status",
  selectedBlockRecovery: "Recovery",
  selectedBlockOpenWorkspace: "Open task workspace to recover this run.",
  selectedBlockReadOnlyCalendar: "Read-only calendar block",
} as const;

const AUTO_START_REASON_COPY_KEYS = {
  not_scheduled: "autoStartNotScheduled",
  not_due: "autoStartNotDue",
  already_running: "autoStartAlreadyRunning",
  invalid_task_status: "autoStartInvalidTaskStatus",
  no_runtime_config: "autoStartNoRuntimeConfig",
  no_accepted_plan: "autoStartNoAcceptedPlan",
  requires_human_input: "autoStartRequiresHumanInput",
  requires_approval: "autoStartRequiresApproval",
  runtime_unsupported: "autoStartRuntimeUnsupported",
} as const;

/**
 * Maps an auto-start eligibility reason code to short plain-language copy.
 * Returns null for unknown codes so the surface can omit the badge safely.
 */
export function getAutoStartReasonCopy(
  copy: SchedulePageCopy,
  reason: string | null | undefined,
): string | null {
  if (!reason || !(reason in AUTO_START_REASON_COPY_KEYS)) {
    return null;
  }
  const key =
    AUTO_START_REASON_COPY_KEYS[
      reason as keyof typeof AUTO_START_REASON_COPY_KEYS
    ];
  return copy[key];
}

export type SchedulePageCopy = Record<
  keyof typeof DEFAULT_SCHEDULE_PAGE_COPY,
  string
>;

export function getSchedulePageCopy(
  messages?: Partial<SchedulePageCopy> | null,
): SchedulePageCopy {
  return {
    ...DEFAULT_SCHEDULE_PAGE_COPY,
    ...(messages ?? {}),
  };
}
