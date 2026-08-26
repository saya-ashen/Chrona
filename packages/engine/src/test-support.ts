export {
  appendCanonicalEvent,
  appendRawEventLog,
} from "./modules/events";
export {
  analyzeConflicts,
  analyzeConflictsSmart,
  detectDependencyConflicts,
  detectFragmentation,
  detectOverload,
  detectTimeOverlaps,
  aiChat,
  dispatchStream,
  extractJSON,
  llmCall,
  runProviderRequest,
} from "./modules/ai";
export type { EngineAiClient } from "./modules/ai";
export {
  archiveExpiredEventRecords,
  readEventRetentionConfig,
} from "./modules/events";
export {
  DEFAULT_WORKSPACE_ID,
  getDefaultWorkspace,
} from "./modules/workspaces";
export { DefaultWorkspaceError } from "./modules/workspaces";
export {
  acceptTaskResult,
  createTask,
  getTaskHeaderSpec,
  getTaskPage,
  markTaskDone,
  reopenTask,
  updateTask,
} from "./modules/tasks";
export {
  requireTaskId,
  requireWorkspaceId,
} from "./modules/agent-tools/input-guards";
export {
  applySchedule,
  clearSchedule,
  decideScheduleProposal,
  moveWorkBlock,
  proposeSchedule,
} from "./modules/scheduling";
export {
  buildDefaultTaskSessionKey,
  buildLegacyPlanExecutionTaskSessionKey,
  buildPlanExecutionTaskSessionKey,
  buildPlanGenerationTaskSessionKey,
  buildWorkBlockPlanTaskSessionKey,
  buildWorkBlockTaskSessionKey,
} from "./modules/execution-runtime";
export {
  getActionCenter,
  getMemoryConsole,
} from "./modules/pages";
export {
  runGoalReviewDueWorker,
  runRecurringWorkBlockExpansionWorker,
} from "./modules/orchestration";
export {
  getLatestCompiledPlan,
  saveCompiledPlan,
} from "./modules/plan-execution/persistence/compiled-plan-store";
export {
  getLatestTaskPlanReadModel,
} from "./modules/plans/task-plan-read-model";
export {
  LEGACY_CHECKPOINT_RESULT_ERROR,
  assertNoLegacyCheckpointResultError,
} from "./modules/plan-execution/checkpoint-regression-assertions";
export {
  AiRuntimeInvoker,
  evaluateConditionNodeCapability,
  executeTaskNodeCapability,
  reviewCheckpointNodeCapability,
} from "./modules/plan-execution";
export { isTaskPlanGenerationRunning } from "./modules/plans/task-plan-generation-registry";
export { getCurrentExecution } from "./modules/plan-execution/use-cases/get-current-execution";
