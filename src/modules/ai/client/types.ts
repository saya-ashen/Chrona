/**
 * AI Client — Type definitions.
 */

import type {
  StructuredAgentResult,
  StructuredSubmissionEnvelope,
  StructuredValidationIssue,
  StructuredResultStatus,
} from "../../../../packages/runtime-client/src/openclaw/structured-result";

export type AiClientType = "openclaw" | "llm";
export type AiFeature =
  | "suggest"
  | "generate_plan"
  | "conflicts"
  | "timeslots"
  | "chat";

export interface AiClientRecord {
  id: string;
  name: string;
  type: AiClientType;
  config: OpenClawClientConfig | LLMClientConfig;
  isDefault: boolean;
  enabled: boolean;
}

export interface OpenClawClientConfig {
  bridgeUrl: string;
  timeoutSeconds?: number;
}

export interface LLMClientConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  temperature?: number;
}

export interface StructuredDebugInfo {
  rawToolCall?: unknown;
  rawOutput?: string | null;
  error?: string | null;
  status?: StructuredResultStatus | null;
  sessionId?: string;
  runId?: string;
  reliability?: "tool_call" | "fallback_text";
  validationIssues?: StructuredValidationIssue[];
  structuredEnvelope?: StructuredSubmissionEnvelope | null;
}

export interface StructuredResponseMeta {
  structured?: StructuredDebugInfo;
}

// ── Request / Response ──

export interface TaskSnapshot {
  id: string;
  title: string;
  status: string;
  priority?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  estimatedMinutes?: number;
  dueAt?: string;
  tags?: string[];
}

export interface ScheduleHealthSnapshot {
  totalTasks: number;
  scheduledTasks: number;
  overdueTasks: number;
  conflictCount: number;
  loadPercent: number;
  freeMinutesToday: number;
}

export interface SmartSuggestRequest {
  input: string;
  kind: "auto-complete" | "schedule" | "general";
  workspaceId?: string;
  context?: {
    existingTasks?: TaskSnapshot[];
    selectedDay?: string;
    scheduledMinutesToday?: number;
    scheduleHealth?: ScheduleHealthSnapshot;
    [key: string]: unknown;
  };
}

export interface SmartSuggestion {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  estimatedMinutes: number;
  tags: string[];
  suggestedSlot?: { startAt: string; endAt: string };
}

export interface SmartSuggestResponse extends StructuredResponseMeta {
  suggestions: SmartSuggestion[];
  source: string;
  requestId: string;
}

import type { TaskPlanNode, TaskPlanEdge } from "../types";

export interface GenerateTaskPlanRequest {
  taskId: string;
  title: string;
  description?: string;
  estimatedMinutes?: number;
}

export interface GenerateTaskPlanResponse extends StructuredResponseMeta {
  nodes: TaskPlanNode[];
  edges: TaskPlanEdge[];
  summary: string;
  reasoning?: string;
  source: string;
}

export interface AnalyzeConflictsRequest {
  tasks: TaskSnapshot[];
  workspaceId?: string;
  focusDate?: string;
}

export interface ConflictInfo {
  id: string;
  type: "time_overlap" | "overload" | "fragmentation" | "dependency";
  severity: "low" | "medium" | "high";
  taskIds: string[];
  description: string;
}

export interface ResolutionSuggestion {
  conflictId: string;
  type: "reschedule" | "split" | "merge" | "defer" | "reorder";
  description: string;
  reason: string;
  changes: Array<{
    taskId: string;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
  }>;
}

export interface AnalyzeConflictsResponse extends StructuredResponseMeta {
  conflicts: ConflictInfo[];
  resolutions: ResolutionSuggestion[];
  summary: string;
  source: string;
}

export interface SuggestTimeslotRequest {
  taskTitle: string;
  estimatedMinutes: number;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  deadline?: string;
  currentSchedule: TaskSnapshot[];
  preferences?: {
    workdayStartHour?: number;
    workdayEndHour?: number;
    bufferMinutes?: number;
    preferMorning?: boolean;
  };
}

export interface TimeslotOption {
  startAt: string;
  endAt: string;
  score: number;
  reason: string;
}

export interface SuggestTimeslotResponse extends StructuredResponseMeta {
  slots: TimeslotOption[];
  reasoning?: string;
  source: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse extends StructuredResponseMeta {
  content: string;
  parsed?: unknown;
  source: string;
}

export class AiClientError extends Error {
  constructor(
    message: string,
    public readonly clientType: string,
    public readonly code:
      | "unavailable"
      | "timeout"
      | "invalid_response"
      | "config_error"
      | "internal",
  ) {
    super(`[${clientType}] ${message}`);
    this.name = "AiClientError";
  }
}

export type StreamEvent =
  | { type: "status"; message: string }
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "partial"; text: string }
  | { type: "result"; plan?: GenerateTaskPlanResponse; suggestions?: SmartSuggestResponse }
  | { type: "done"; text?: string; structured?: StructuredAgentResult<Record<string, unknown>> | null }
  | { type: "error"; message: string };
