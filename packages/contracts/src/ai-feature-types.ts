/**
 * AI Features — Shared feature-layer type definitions.
 */

import type { PlanBlueprint } from "./ai-plan-blueprint";
import type { TaskPlanGraph } from "./ai-plan-runtime";

export type AiClientType = "openclaw" | "llm";
export type AiFeature =
  | "suggest"
  | "generate_plan"
  | "conflicts"
  | "timeslots"
  | "chat"
  | "dispatch_task";

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
  bridgeToken: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  model?: string;
  timeoutSeconds?: number;
}

export interface LLMClientConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  temperature?: number;
}

export type StructuredResultReliability = "business_tool" | "assistant_text";

export interface StructuredValidationIssue {
  path: string;
  message: string;
}

export interface StructuredDebugInfo {
  rawOutput?: string | null;
  error?: string | null;
  source?: StructuredResultReliability;
  feature?: string | null;
  toolName?: string | null;
  sessionId?: string;
  runId?: string;
  validationIssues?: StructuredValidationIssue[];
  bridgeToolCalls?: Array<{
    tool: string;
    callId?: string;
    input: Record<string, unknown>;
    result?: string;
    status?: "pending" | "completed" | "error";
  }>;
}

export interface StructuredResponseMeta {
  structured?: StructuredDebugInfo;
}

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
  taskId?: string;
  sessionKey?: string;
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

export interface GenerateTaskPlanRequest {
  taskId: string;
  title: string;
  description?: string;
  estimatedMinutes?: number;
  sessionKey?: string;
}

export interface GenerateTaskPlanResponse extends StructuredResponseMeta {
  blueprint: PlanBlueprint;
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

export interface LinkedPlanTaskSummary {
  taskId: string;
  nodeId: string;
  status: string;
  title: string;
}

export interface RuntimeRunSummary {
  runId: string;
  taskId: string;
  status: string;
  startedAt?: string | null;
  endedAt?: string | null;
  errorSummary?: string | null;
}

export interface TaskEventSummary {
  eventType: string;
  createdAt: string;
  runId?: string | null;
  payload?: Record<string, unknown>;
}

export interface ApprovalSummary {
  id: string;
  status: string;
  riskLevel: string;
  runId: string;
  title: string;
}

export interface BlockerSummary {
  id: string;
  type: string;
  reason: string;
}

import type { TaskDispatchDecision, TaskDispatchPolicy } from "./ai-dispatch-types";

export interface ExecutionContextStats {
  messageCount: number;
  transcriptChars: number;
  estimatedTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  modelContextLimit?: number;
  compacted: boolean;
  summaryMemoryId?: string;
}

export interface DispatchTaskInput {
  taskId: string;
  workspaceId: string;
  acceptedPlan: TaskPlanGraph;
  linkedTasks: LinkedPlanTaskSummary[];
  latestRuns: RuntimeRunSummary[];
  recentEvents: TaskEventSummary[];
  approvals: ApprovalSummary[];
  blockers: BlockerSummary[];
  contextStats?: ExecutionContextStats[];
  policy: TaskDispatchPolicy;
}

export interface DispatchTaskOutput extends StructuredResponseMeta {
  decision: TaskDispatchDecision;
  reliability: "structured_tool_call" | "mock";
  rawProviderResult?: unknown;
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
  | { type: "result"; suggestions: SmartSuggestResponse }
  | { type: "result"; plan: GenerateTaskPlanResponse; planGraph?: unknown; savedPlan?: unknown; source?: string; taskSessionKey?: string }
  | { type: "done"; text: string; structured?: StructuredDebugInfo | null }
  | {
      type: "error";
      message: string;
      rawText?: string;
      structured?: StructuredDebugInfo | null;
      diagnostics?: Record<string, unknown>;
    };
