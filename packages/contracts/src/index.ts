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

export type { ControlPlaneMode } from "./ai-feature-types";

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
  agentControlActionBodySchema,
  agentControlActionKindSchema,
  agentControlActionPayloadSchemas,
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
  parseChronaToolPayload,
} from "./api/mcp-task-tools.schema";

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
  PlanCompileError,
  editableEdgeSchema,
  editableNodeSchema,
  editablePlanSchema,
  planBlueprintSchema,
  planPatchOperationSchema,
  planPatchSchema,
  upgradeBlueprintToEditable,
} from "./ai-plan-blueprint";

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
  ArtifactRef,
  NodeResultEvidence,
  NodeResultOutput,
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

export type { StructuredSuggestion } from "./ai-shared-types";

// AI feature request/response contracts
export type {
  TaskWorkspaceChatRequest,
  TaskWorkspaceChatResponse,
  TaskWorkspaceUpdateProposal,
} from "./plan-runtime";

export type {
  ConflictAnalysisResult,
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

export { AiClientError, DEFAULT_AGENT_PROVIDER_MODEL } from "./ai-feature-types";

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
