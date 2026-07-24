export {
  STRUCTURED_RESULT_FORMAT,
  STRUCTURED_RESULT_SCHEMA_VERSION,
  isStructuredResultAssetContent,
  type StructuredResultArtifactRef,
  type StructuredResultAssetContent,
} from "./goal-structured-result";

// AI plan contracts — new architecture
export type {
  CalendarAutomationPolicy,
  CalendarEventStatus,
  CalendarSourceLifecycleState,
  CalendarSourceSummary,
  CalendarSourceSyncPolicy,
  CalendarSourceType,
  CalendarSourceListResponse,
  CalendarSourceResponse,
  CalendarSyncStatus,
  CalendarValidationErrorCode,
  CreateCalendarSourceRequest,
  RefreshCalendarSourceRequest,
  ImportedCalendarEventSummary,
  ImportedCalendarEventListResponse,
  UpdateCalendarSourceRequest,
  ValidateCalendarSourceResponse,
} from "./external-calendar";

export {
  calendarEventStatusSchema,
  calendarAutomationPolicySchema,
  calendarSourceDeleteResponseSchema,
  calendarSourceLifecycleStateSchema,
  calendarSourceListResponseSchema,
  calendarSourceResponseSchema,
  calendarSourceSummarySchema,
  calendarSourceSyncPolicySchema,
  calendarSourceTypeSchema,
  calendarSyncStatusSchema,
  calendarValidationErrorCodeSchema,
  createCalendarSourceRequestSchema,
  refreshCalendarSourceRequestSchema,
  importedCalendarEventListResponseSchema,
  importedCalendarEventSummarySchema,
  updateCalendarSourceRequestSchema,
  validateCalendarSourceFailureSchema,
  validateCalendarSourceRequestSchema,
  validateCalendarSourceResponseSchema,
  validateCalendarSourceSuccessSchema,
} from "./external-calendar";

export type {
  AssistantActionRequest,
  AssistantActionResult,
  AssistantPreviewSurface,
  AssistantProposalRoute,
  AssistantQuickAction,
  AssistantQuickActionId,
  AssistantQuickActionKind,
  AssistantStatusSummary,
  AssistantSurfacePageType,
  AssistantSurfaceSeverity,
  AssistantSurfaceState,
} from "./assistant-surface";

export type {
  AiProposalConfirmability,
  AiProposalPreview,
  AiSidebarCapabilityId,
  AiSidebarConfirmationDecision,
  AiSidebarContextType,
  AiSidebarHighlight,
  AiSidebarMessage,
  AiSidebarPageContextSummary,
  AiSidebarQuickAction,
  AiSidebarQuickActionKind,
  AiSidebarScheduleContextSummary,
  AiSidebarTaskContextSummary,
  AiSidebarUnsupportedContextSummary,
  ScheduleGhostBlockPreview,
  ScheduleGhostPlacement,
  TaskChangePreview,
} from "./ai-sidebar";

export type {
  CreateTaskInput,
  TaskCore,
  TaskPriority,
  TaskReadModel,
  TaskRuntimeFields,
  TaskScheduleFields,
  TaskStatus,
  UpdateTaskInput,
} from "./task";

export { TASK_PRIORITIES, TASK_STATUSES } from "./task";

export type { AutomationTimingPreset } from "./automation-timing";

export type {
  StateModel as TaskWorkspaceStateModel,
  TaskWorkspaceStateSnapshotEvent,
  TaskWorkspaceStateUpdateEvent,
} from "./task-workspace-state";

export {
  AUTOMATION_TIMING_PRESETS,
  DEFAULT_AUTOMATION_TIMING,
  automationTimingOffsetMs,
  automationTimingSchema,
  normalizeAutomationTiming,
  resolveAutomationTriggerAt,
} from "./automation-timing";

export type {
  GraphMutationOperation as TaskOrchestratorGraphMutationOperation,
  GraphMutationRequest as TaskOrchestratorGraphMutationRequest,
  GraphMutationResponse as TaskOrchestratorGraphMutationResponse,
  GraphNodeState,
  ReconciliationResult,
  TaskAction,
  TaskExecutionState,
  TaskExecutionSummary,
  TaskNodeState,
} from "./task-orchestrator";

export {
  graphMutationOperationSchema,
  graphMutationRequestSchema,
  graphMutationResponseSchema,
  graphMutationStatusSchema,
  graphNodeStateSchema,
  reconciliationIssueSchema,
  reconciliationResultSchema,
  taskActionSchema,
  taskExecutionStateSchema,
  taskExecutionSummarySchema,
  taskNodeStateSchema,
  taskPrimaryActionTypeSchema,
  taskProgressSchema,
  taskRecoveryActionTypeSchema,
} from "./task-orchestrator";

export type {
  ChronaToolExpectedState,
  ChronaToolIdempotencyStatus,
  ChronaToolInput,
  ChronaToolName,
  ChronaToolOperation,
  ChronaToolReasonCode,
  ChronaToolRecovery,
  ChronaToolRegistry,
  ChronaToolResult,
  AgentControlActionBody,
  AgentControlActionKind,
} from "./api/mcp-task-tools.schema";

export {
  CHRONA_PLAN_OUTPUT_TOOL_DESCRIPTION,
  agentControlActionBodySchema,
  agentControlActionKindSchema,
  agentControlActionPayloadSchemas,
  chronaPublicToolPayloadSchemas,
  goalResultsReadPayloadSchema,
  chronaToolAffectedSchema,
  chronaToolContextSchema,
  chronaToolExpectedStateSchema,
  chronaToolIdempotencyStatusSchema,
  chronaToolInputSchema,
  chronaToolInputSchemaFor,
  chronaToolNameSchema,
  chronaToolNames,
  chronaToolOperationSchema,
  chronaToolPayloadSchemas,
  chronaToolReasonCodeSchema,
  chronaToolRecoverySchema,
  chronaToolRegistryItemSchema,
  chronaToolRegistrySchema,
  chronaToolResultSchema,
  chronaToolStatusSchema,
  isChronaToolMutating,
  describeChronaPlanOutputPublicTool,
  parseChronaToolPayload,
} from "./api/mcp-task-tools.schema";

export { autoCompleteBodySchema } from "./api/ai.schema";

export {
  scheduleProjectionQuerySchema,
} from "./api/projections.schema";
export {
  actionCenterItemSchema,
  actionCenterProjectionSchema,
  workCommandBodySchema,
  type ActionCenterItem,
  type ActionCenterProjection,
} from "./api/projections.schema";
export {
  applyGoalReviewProposalBodySchema,
  generateGoalReviewBodySchema,
  goalReviewResultSchema,
  rejectGoalReviewProposalBodySchema,
} from "./api/goals.schema";
export type {
  CreateGoalTaskRequest,
  ApplyGoalReviewRequest,
  ApplyGoalReviewProposalRequest,
  GenerateGoalReviewRequest,
  GoalReviewEvidenceRef,
  GoalReviewProposalItemDecision,
  GoalReviewProposalItemKind,
  GoalReviewProposalStatus,
  GoalReviewResult,
  RejectGoalReviewProposalRequest,
  ConfirmGoalCriterionRequest,
  CreateGoalRequest,
  CreateGoalWithFirstTaskRequest,
  ProcessGoalResultRequest,
  GoalActionRequest,
  GoalOperationalBrief,
  GoalStatus,
  GoalSuccessCriterion,
  PromoteTaskToGoalRequest,
  ReviewGoalCriterionRequest,
} from "./api/goals.schema";
export {
  clearScheduleParamSchema,
  scheduleBodySchema,
  scheduleParamSchema,
  scheduleProposalBodySchema,
  scheduleProposalDecisionBodySchema,
  scheduleProposalParamSchema,
  workBlockScheduleBodySchema,
  workBlockScheduleParamSchema,
} from "./api/execution.schema";
export type { AutomationSuggestion, ScheduleSlot } from "./ai-shared-types";
export type { ExecutionCheckpoint } from "./plan-runtime/_leaf";
export type { NodeConfig } from "./plan-runtime/node";

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
  UserInteractionLevel,
  CheckpointSchemaSource,
  CheckpointType,
  InputFieldType,
  GeneratePlanBlueprintToolPayload,
  ConditionEvaluator,
  WaitTimeoutAction,
  PlanCompileIssue,
  CompiledPlanCompletionPolicy,
  PlanBlueprintNode,
  PlanBlueprintTaskNode,
  PlanBlueprintCheckpointNode,
  PlanBlueprintConditionNode,
  PlanBlueprintWaitNode,
  PlanBlueprintEdge,
  PlanBlueprint,
  AIPlanCompletionPolicy,
} from "./ai-plan-blueprint";

export {
  AI_PLAN_NODE_TYPES,
  AI_TASK_EXECUTORS,
  AI_TASK_MODES,
  AI_USER_INTERACTION_LEVELS,
  AI_CHECKPOINT_SCHEMA_SOURCES,
  AI_CHECKPOINT_TYPES,
  AI_INPUT_FIELD_TYPES,
  AI_CONDITION_EVALUATORS,
  AI_WAIT_TIMEOUT_ACTIONS,
  PlanCompileError,
  editableEdgeSchema,
  editableNodeSchema,
  editablePlanSchema,
  planBlueprintSchema,
  planBlueprintTaskNodeSchema,
  planBlueprintCheckpointNodeSchema,
  planBlueprintConditionNodeSchema,
  planBlueprintWaitNodeSchema,
  planBlueprintNodeSchema,
  planBlueprintEdgeSchema,
  planPatchOperationSchema,
  planPatchSchema,
  upgradeBlueprintToEditable,
} from "./ai-plan-blueprint";
export type { PlanGenerateToolPayload } from "./plan-generate-tool";

export {
  CHRONA_PLAN_GENERATE_CLAUDE_CODE_TOOL_NAME,
  CHRONA_PLAN_GENERATE_INTERNAL_TOOL_NAME,
  CHRONA_PLAN_GENERATE_TOOL_DESCRIPTION,
  CHRONA_PLAN_GENERATE_TOOL_NAME,
  CHRONA_PLAN_GENERATE_TOOL_TITLE,
  acceptedPlanGenerateToolResult,
  isChronaPlanGenerateToolName,
  parsePlanGenerateToolPayload,
  planGenerateToolPayloadSchema,
  safeParsePlanGenerateToolPayload,
} from "./plan-generate-tool";


// Runtime / compiled types
export type {
  CompiledPlan,
  CompiledNode,
  CompiledEdge,
  PlanGraph,
  PlanGraphStatus,
  PlanNode,
  NodeLayer,
  NodeLayerType,
  NodeDefinition,
  NodeDefinitionLayer,
  NodeInvalidationLayer,
  NodeCancellationLayer,
  PlanEdge,
  PlanEdgeType,
  GraphMutation,
  GraphMutationOperation,
  TaskConfig,
  CheckpointConfig,
  ConditionConfig,
  WaitConfig,
  PlanRun,
  PlanRunStatus,
  NodeRuntimeState,
  NodeRuntimeStatus,
  RuntimeProgressStatus,
  ExecutionSessionLifecycleStatus,
  TaskExecutionAggregateStatus,
  WebPlanNodeStatus,
  NodeExecutionAttempt,
  CheckpointResponse,
  CheckpointFieldValue,
  CheckpointInputFields,
  CheckpointActionKind,
  SubmitCheckpointActionInput,
  ArtifactRef,
  NodeResultEvidence,
  PlanOutputPatch,
  PlanOutputRevision,
  PlanOutputState,
  ExecutionContextSnapshot,
  NodeAttempt,
  RuntimeCommand,
  // Overlay model (Phase 0)
  PlanOverlayLayer,
  StructuralLayer,
  StructuralOperation,
  RuntimeLayer,
  ResultLayer,
  NodeResult,
  AiVisibleRefKind,
  AiVisibleRefPublic,
  AiVisibleRefBinding,
  SemanticRefHistory,
  NodeRuntimeInput,
  LayerSource,
  EffectivePlanGraph,
  EffectivePlanNode,
  EffectivePlanEdge,
  ResolveEffectivePlanGraphInput,
  ExecutionActionType,
  ExecutionActionInput,
  PlanExecutionStatus,
  PlanExecutionResult,
  PlanExecutionSSEEvent,
  GraphMutationRequest,
  TaskPlanReadModel,
  TaskPlanGenerationSessionReadModel,
  GeneratePlanStatusPhase,
  GeneratePlanStatusEvent,
  GeneratePlanPartialEvent,
  GeneratePlanToolCallEvent,
  GeneratePlanResultEvent,
  GeneratePlanErrorCode,
  GeneratePlanErrorEvent,
  GeneratePlanDoneEvent,
  GeneratePlanSSEEvent,
  GenerateTaskPlanApiRequest,
  WaitKind,
} from "./plan-runtime";

// AI feature specs
export type {
  AiFeatureStructuredOutputSchema,
  StructuredAiFeature,
  PreparedAiFeatureSpec,
} from "./ai-feature-specs";

export type { AiFeatureToolSpec } from "./ai-feature-specs";
export { buildGoalAssetOwnershipFeatureSpec } from "./ai-feature-specs";

export type { StructuredSuggestion } from "./ai-shared-types";

// AI feature request/response contracts
export type {
  TaskWorkspaceChatRequest,
  TaskWorkspaceChatResponse,
  TaskWorkspaceUpdateProposal,
} from "./plan-runtime";

export type {
  ConflictAnalysisResult,
  TimeslotOptions,
  TimeslotSuggestion,
  TimeslotSuggestionInput,
  TimeslotSuggestionResult,
} from "./ai-shared-types";

export {
  GENERATE_PLAN_SYSTEM_PROMPT,
  SUGGEST_SYSTEM_PROMPT,
  SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
  GENERATE_PLAN_BLUEPRINT_TOOL_DESCRIPTION,
  GENERATE_PLAN_BLUEPRINT_TOOL_NAME,
  buildGeneratePlanFeatureInputText,
  buildGeneratePlanFeatureSpec,
  buildSuggestFeatureSpec,
  suggestTaskCompletionsToolSpec,
  validatePreparedFeaturePayload,
} from "./ai";

export type {
  AiClientRecord,
  AiClientType,
  AiFeature,
  DebugProviderProfile,
  HermesClientConfig,
  DebugClientConfig,
  ClaudeCodeClientConfig,
  CodexClientConfig,
  OmpClientConfig,
  LLMClientConfig,
  AgentProviderClientConfig,
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

export { AI_FEATURES, AiClientError, DEFAULT_AGENT_PROVIDER_MODEL } from "./ai-feature-types";

export type {
  TaskDispatchAction,
  TaskDispatchDecision,
  DispatchDecisionParseIssue,
  ParseResult,
  TaskDispatchPolicy,
  TaskPlanPatch,
} from "./ai-dispatch-types";

export {
  TASK_DISPATCH_ACTIONS,
  isAutoExecutableDispatchDecision,
  parseTaskDispatchDecision,
  taskDispatchActionSchema,
  taskDispatchDecisionSchema,
  taskPlanPatchSchema,
} from "./ai-dispatch-types";

export {
  runtimeProgressStatusForWaitKind,
  runtimeProgressStatusForNodes,
  planRunStatusForRuntimeProgress,
  planGraphStatusForRuntimeProgress,
  executionSessionStatusForRuntimeProgress,
  taskStatusForRuntimeProgress,
  webPlanNodeStatusForRuntimeStatus,
} from "./plan-runtime";
export * from "./provider-capability-matrix";

export type {
  ApplyGoalAssetOwnershipRequest,
  CreateAssetModificationTaskRequest,
  CreateGoalAssetJobRequest,
  GenerateGoalAssetOwnershipRequest,
  GoalAssetOwnershipCandidate,
  GoalAssetOwnershipDecision,
  GoalAssetOwnershipProposalStatus,
  GoalAssetOwnershipResult,
  CreateGoalFormSubmissionRequest,
  ResolveGoalInboxCandidateRequest,
  SaveGoalAssetDraftRequest,
  SubmitGoalAssetDraftRequest,
} from "./api/goal-workbench.schema";
export {
  applyGoalAssetOwnershipBodySchema,
  generateGoalAssetOwnershipBodySchema,
  goalAssetOwnershipCandidateSchema,
  goalAssetOwnershipDecisionSchema,
  goalAssetOwnershipProposalParamSchema,
  goalAssetOwnershipProposalStatusSchema,
  goalAssetOwnershipResultSchema,
} from "./api/goal-workbench.schema";
