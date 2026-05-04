// AI plan contracts — new architecture
export type {
  EditablePlan,
  EditableNode,
  EditableTaskNode,
  EditableCheckpointNode,
  EditableConditionNode,
  EditableWaitNode,
  EditableEdge,
  PlanPatch,
  PlanPatchOperation,
  ValidationError,
  ValidationWarning,
  ValidationResult,
  PlanNodeType,
  TaskExecutor,
  TaskMode,
  CheckpointType,
  ConditionEvaluator,
  WaitTimeoutAction,
  PlanCompileIssue,
  CompiledPlanCompletionPolicy,
  PlanBlueprint,
  PlanBlueprintNode,
  PlanBlueprintTaskNode,
  PlanBlueprintCheckpointNode,
  PlanBlueprintConditionNode,
  PlanBlueprintWaitNode,
  PlanBlueprintEdge,
  AIPlanNode,
  AIPlanNodeType,
  AITaskNode,
  AICheckpointNode,
  AIConditionNode,
  AIWaitNode,
  AIPlanEdge,
  AIPlanOutput,
  AIPlanValidationResult,
  AIPlanCompletionPolicy,
} from "./ai-plan-blueprint";

export {
  PlanCompileError,
  upgradeBlueprintToEditable,
} from "./ai-plan-blueprint";

// Runtime / compiled types
export type {
  CompiledPlan,
  CompiledNode,
  CompiledEdge,
  TaskConfig,
  CheckpointConfig,
  ConditionConfig,
  WaitConfig,
  PlanRun,
  PlanRunStatus,
  NodeRuntimeState,
  NodeRuntimeStatus,
  NodeExecutionAttempt,
  CheckpointResponse,
  ArtifactRef,
  RuntimeCommand,
  // Legacy (deprecated)
  TaskPlanGraph,
  TaskPlanNode,
  TaskPlanEdge,
  TaskPlanStatus,
  TaskPlanNodeType,
  TaskPlanNodeStatus,
  TaskPlanEdgeType,
  TaskPlanNodeExecutionMode,
  TaskPlanNodeBlockingReason,
  SavedTaskPlanGraph,
  TaskPlanGraphResponse,
  PlanUpdatePatch,
} from "./ai-plan-runtime";

// AI feature specs
export type {
  StructuredAiFeature,
  PreparedAiFeatureSpec,
  EditPlanFeatureInput,
} from "./ai-feature-specs";

export type {
  AiFeatureToolSpec,
} from "./ai-feature-specs";

export type {
  StructuredSuggestion,
} from "./ai-shared-types";

// AI feature request/response contracts
export type {
  TaskWorkspaceChatRequest,
  TaskWorkspaceChatResponse,
  TaskWorkspaceUpdateProposal,
} from "./ai-plan-runtime";

export type {
  ConflictAnalysisResult,
  TimeslotSuggestionResult,
} from "./ai-shared-types";

export {
  ANALYZE_SCHEDULE_CONFLICTS_TOOL_NAME,
  CONFLICTS_SYSTEM_PROMPT,
  DISPATCH_NEXT_TASK_ACTION_TOOL_NAME,
  DISPATCH_TASK_SYSTEM_PROMPT,
  GENERATE_PLAN_SYSTEM_PROMPT,
  EDIT_PLAN_PATCH_SYSTEM_PROMPT,
  SUGGEST_SYSTEM_PROMPT,
  SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
  SUGGEST_TASK_TIMESLOTS_TOOL_NAME,
  TIMESLOTS_SYSTEM_PROMPT,
  EDIT_PLAN_PATCH_TOOL_NAME,
  EDIT_PLAN_PATCH_TOOL_DESCRIPTION,
  editPlanPatchToolSpec,
  buildEditPlanPatchFeatureInputText,
  buildEditPlanPatchFeatureSpec,
  analyzeScheduleConflictsToolSpec,
  buildAnalyzeConflictsFeatureSpec,
  buildDispatchTaskFeatureSpec,
  GENERATE_TASK_PLAN_GRAPH_TOOL_DESCRIPTION,
  GENERATE_TASK_PLAN_GRAPH_TOOL_NAME,
  buildGeneratePlanFeatureInputText,
  buildGeneratePlanFeatureSpec,
  buildSuggestFeatureSpec,
  buildSuggestTimeslotsFeatureSpec,
  dispatchNextTaskActionToolSpec,
  generateTaskPlanGraphToolPayloadSchema,
  generateTaskPlanGraphToolSpec,
  suggestTaskCompletionsToolSpec,
  suggestTaskTimeslotsToolSpec,
  validateAIPlanOutput,
  validatePreparedFeaturePayload,
} from "./ai";

export type {
  AiClientRecord,
  AiClientType,
  AiFeature,
  LLMClientConfig,
  OpenClawClientConfig,
  SmartSuggestRequest,
  SmartSuggestion,
  SmartSuggestResponse,
  ScheduleHealthSnapshot,
  TaskSnapshot,
  GenerateTaskPlanRequest,
  GenerateTaskPlanResponse,
  AnalyzeConflictsRequest,
  AnalyzeConflictsResponse,
  ConflictInfo,
  ResolutionSuggestion,
  SuggestTimeslotRequest,
  SuggestTimeslotResponse,
  TimeslotOption,
  ChatRequest,
  ChatResponse,
  ChatMessage,
  DispatchTaskInput,
  DispatchTaskOutput,
  ExecutionContextStats,
  LinkedPlanTaskSummary,
  RuntimeRunSummary,
  TaskEventSummary,
  ApprovalSummary,
  BlockerSummary,
  StreamEvent,
  StructuredDebugInfo,
  StructuredResponseMeta,
} from "./ai-feature-types";

export { AiClientError } from "./ai-feature-types";

export type {
  TaskDispatchAction,
  TaskDispatchDecision,
  DispatchDecisionParseIssue,
  ParseResult,
  TaskDispatchPolicy,
  TaskPlanPatch,
} from "./ai-dispatch-types";

export {
  isAutoExecutableDispatchDecision,
  parseTaskDispatchDecision,
} from "./ai-dispatch-types";
