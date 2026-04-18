/**
 * AI Adapters — barrel export.
 */

export { AIAdapter } from "./base";
export { LLMAdapter } from "./llm-adapter";
export { OpenClawAdapter } from "./openclaw-adapter";
export { aiAdapterRegistry } from "./registry";
export type { AIAdapterFactory } from "./registry";
export {
  AIAdapterError,
  type AIAdapterCapabilities,
  type AIAdapterConfig,
  type AIMessage,
  type SmartSuggestRequest,
  type SmartSuggestResponse,
  type SmartSuggestion,
  type DecomposeTaskRequest,
  type DecomposeTaskResponse,
  type SubtaskSuggestion,
  type AnalyzeConflictsRequest,
  type AnalyzeConflictsResponse,
  type ConflictInfo,
  type ResolutionSuggestion,
  type TaskChange,
  type SuggestTimeslotRequest,
  type SuggestTimeslotResponse,
  type TimeslotOption,
  type ChatRequest,
  type ChatResponse,
  type TaskSnapshot,
  type ScheduleHealthSnapshot,
} from "./types";
