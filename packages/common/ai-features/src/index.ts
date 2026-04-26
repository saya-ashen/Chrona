/**
 * @chrona/ai-features
 *
 * Canonical public surface for feature-layer AI generation.
 * External consumers should import from this package root only.
 */

export type {
  AiClientType,
  AiFeature,
  AiClientRecord,
  OpenClawClientConfig,
  LLMClientConfig,
  StructuredDebugInfo,
  StructuredResponseMeta,
  TaskSnapshot,
  ScheduleHealthSnapshot,
  SmartSuggestRequest,
  SmartSuggestion,
  SmartSuggestResponse,
  GenerateTaskPlanRequest,
  GenerateTaskPlanResponse,
  AnalyzeConflictsRequest,
  ConflictInfo,
  ResolutionSuggestion,
  AnalyzeConflictsResponse,
  SuggestTimeslotRequest,
  TimeslotOption,
  SuggestTimeslotResponse,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LinkedPlanTaskSummary,
  RuntimeRunSummary,
  TaskEventSummary,
  ApprovalSummary,
  BlockerSummary,
  ExecutionContextStats,
  DispatchTaskInput,
  DispatchTaskOutput,
  StreamEvent,
} from "./core/types";

export { AiClientError } from "./core/types";

export type {
  TaskDispatchAction,
  TaskPlanPatch,
  TaskDispatchDecision,
  DispatchDecisionParseIssue,
  ParseResult,
  TaskDispatchPolicy,
} from "./core/dispatch-types";

export {
  parseTaskDispatchDecision,
  isAutoExecutableDispatchDecision,
} from "./core/dispatch-types";

export { SYSTEM_PROMPTS } from "./core/prompts";

export {
  extractJSON,
  llmCall,
  checkClientHealth,
} from "./core/providers";

export {
  normalizeSuggestResponse,
  suggest,
  normalizeGeneratePlanResponse,
  generatePlan,
  analyzeConflicts,
  suggestTimeslots,
  chat,
  dispatchTask,
} from "./features";

export {
  suggestStream,
  generatePlanStream,
} from "./core/streaming";
