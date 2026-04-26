// Compatibility barrel – re-exports from the split work-page modules.
export {
  WorkPageTaskNotFoundError,
  DEFAULT_COPY,
  isMissingRecordError,
  makeEvidence,
  toIsoString,
  summarizeValue,
  summarizePayload,
  formatEventTitle,
  classifyWorkstreamItem,
  buildScheduleImpact,
  readBlockReason,
  deriveTaskPlanStepStatus,
  buildTaskPlanFromGraph,
  buildCurrentIntervention,
  buildLatestOutput,
  buildReliability,
  buildClosureState,
  buildWorkspaceRail,
  getWorkPage,
} from "./work-page";

export type {
  WorkPageCopy,
  EvidenceItem,
  TaskPlanStepStatus,
  TaskPlanProjectionStep,
  TaskPlanProjection,
} from "./work-page";
