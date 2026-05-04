export {
  aiAnalyzeConflicts,
  aiChat,
  aiGeneratePlan,
  aiGeneratePlanStream,
  aiSuggestStream,
  aiSuggestTimeslots,
  getAIClientInfo,
  isAIAvailable,
} from "./modules/ai/ai-service";
export type {
  ScheduleHealthSnapshot,
  TaskSnapshot,
} from "./modules/ai/ai-service";

export { analyzeConflictsSmart } from "./modules/ai/conflict-analyzer";
export { suggestAutomationSmart } from "./modules/ai/automation-suggester";
export {
  buildTaskWorkspaceSystemPrompt,
  suggestTimeslots,
  deriveTaskRunnability,
} from "@chrona/shared";

export { appendCanonicalEvent } from "./modules/events/append-canonical-event";

export {
  acceptTaskResult,
} from "./modules/commands/accept-task-result";
export { applySchedule } from "./modules/commands/apply-schedule";
export { clearSchedule } from "./modules/commands/clear-schedule";
export { createFollowUpTask } from "./modules/commands/create-follow-up-task";
export { createTask } from "./modules/commands/create-task";
export { decideScheduleProposal } from "./modules/commands/decide-schedule-proposal";
export { dispatchNextTaskAction } from "./modules/commands/dispatch-next-task-action";
export { generateTaskPlanForTask } from "./modules/commands/generate-task-plan-for-task";
export { invalidateMemory } from "./modules/commands/invalidate-memory";
export { markTaskDone } from "./modules/commands/mark-task-done";
export { materializeTaskPlan } from "./modules/commands/materialize-task-plan";
export { proposeSchedule } from "./modules/commands/propose-schedule";
export { provideInput } from "./modules/commands/provide-input";
export { reopenTask } from "./modules/commands/reopen-task";
export { resolveApproval } from "./modules/commands/resolve-approval";
export { resumeRun } from "./modules/commands/resume-run";
export { retryRun } from "./modules/commands/retry-run";
export { sendOperatorMessage } from "./modules/commands/send-operator-message";
export { startRun } from "./modules/commands/start-run";
export {
  isTaskPlanGenerationRunning,
  startTaskPlanGeneration,
  stopTaskPlanGeneration,
  TASK_PLAN_GENERATION_IN_FLIGHT_CODE,
  TaskPlanGenerationInFlightError,
} from "./modules/commands/task-plan-generation-registry";
export { updateTask } from "./modules/commands/update-task";

export {
  advancePlanExecution,
  continuePlanExecution,
  executePlanNode,
  settlePlanNodeFromRun,
  startPlanExecution,
} from "./modules/plan-execution";

export { getInbox } from "./modules/queries/get-inbox";
export { getMemoryConsole } from "./modules/queries/get-memory-console";
export { getSchedulePage } from "./modules/queries/get-schedule-page";
export { getTaskPage } from "./modules/queries/get-task-page";
export { getWorkspaceOverview } from "./modules/queries/get-workspace-overview";
export { getWorkspaces } from "./modules/queries/get-workspaces";
export {
  getWorkPage,
  WorkPageTaskNotFoundError,
} from "./modules/queries/work-page";

export { startAutoStartScheduler } from "./modules/scheduler/auto-start-runner";

export { overrideRuntimeExecutionAdapter } from "./modules/task-execution/execution-registry";
export { ensureDefaultTaskSession } from "./modules/task-execution/task-sessions";

export {
  acceptTaskPlanGraph,
  enrichPlanGraphNodes,
  getAcceptedTaskPlanGraph,
  getLatestTaskPlanGraph,
  saveTaskPlanGraph,
} from "./modules/tasks/task-plan-graph-store";
export { compilePlanBlueprint } from "./modules/tasks/plan-blueprint-compiler";

export { getDefaultWorkspace } from "./modules/workspaces/get-default-workspace";
