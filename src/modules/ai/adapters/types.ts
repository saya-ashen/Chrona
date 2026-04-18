/**
 * AI Adapter Layer — Unified types for all AI backends.
 *
 * The adapter layer normalizes different AI providers (OpenClaw agent,
 * raw LLM, future providers) into a single interface that the backend
 * layer consumes. The backend never cares whether it's talking to an
 * agentic runtime with tool-calling or a simple chat completion API.
 *
 * Architecture:
 *
 *   ┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
 *   │  Web Layer   │────▶│Backend Layer│────▶│  Adapter Layer   │
 *   │ (API routes) │     │ (AI Service)│     │                  │
 *   └─────────────┘     └─────────────┘     │ ┌──────────────┐ │
 *                                            │ │ OpenClaw     │ │
 *                                            │ │ Adapter      │ │
 *                                            │ └──────────────┘ │
 *                                            │ ┌──────────────┐ │
 *                                            │ │ LLM Adapter  │ │
 *                                            │ │ (OpenAI-compat)│
 *                                            │ └──────────────┘ │
 *                                            └──────────────────┘
 */

// ────────────────────────────────────────────────────────────────────
// Core Message Types
// ────────────────────────────────────────────────────────────────────

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ────────────────────────────────────────────────────────────────────
// Capability Flags
// ────────────────────────────────────────────────────────────────────

/**
 * Capabilities that an adapter may or may not support.
 * The backend can query these to decide which features to offer.
 */
export interface AIAdapterCapabilities {
  /** Can call tools / functions during generation */
  toolCalling: boolean;
  /** Can return structured JSON reliably */
  structuredOutput: boolean;
  /** Supports streaming responses */
  streaming: boolean;
  /** Has persistent context / memory across calls */
  persistentContext: boolean;
  /** Can execute code or shell commands */
  codeExecution: boolean;
  /** Supports multi-turn conversation in a session */
  sessions: boolean;
}

// ────────────────────────────────────────────────────────────────────
// Request / Response Types — Smart Suggest
// ────────────────────────────────────────────────────────────────────

export interface SmartSuggestRequest {
  /** Partial input the user is typing (e.g. task title) */
  input: string;
  /** What kind of suggestion */
  kind: "auto-complete" | "schedule" | "general";
  /** Workspace scope */
  workspaceId?: string;
  /** Additional context for the AI */
  context?: {
    existingTasks?: TaskSnapshot[];
    selectedDay?: string;
    scheduledMinutesToday?: number;
    scheduleHealth?: ScheduleHealthSnapshot;
    [key: string]: unknown;
  };
}

export interface SmartSuggestResponse {
  suggestions: SmartSuggestion[];
  source: string; // adapter identifier
  requestId: string;
}

export interface SmartSuggestion {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  estimatedMinutes: number;
  tags: string[];
  /** Optional scheduling suggestion */
  suggestedSlot?: {
    startAt: string;
    endAt: string;
  };
  /** Adapter-specific metadata */
  metadata?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────
// Request / Response Types — Task Decomposition
// ────────────────────────────────────────────────────────────────────

export interface DecomposeTaskRequest {
  taskId: string;
  title: string;
  description?: string;
  estimatedMinutes?: number;
  context?: {
    existingSubtasks?: string[];
    parentTask?: string;
    [key: string]: unknown;
  };
}

export interface DecomposeTaskResponse {
  subtasks: SubtaskSuggestion[];
  reasoning?: string;
  source: string;
}

export interface SubtaskSuggestion {
  title: string;
  description?: string;
  estimatedMinutes?: number;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  order: number;
  dependsOn?: number[]; // indices of other subtasks
}

// ────────────────────────────────────────────────────────────────────
// Request / Response Types — Conflict Analysis
// ────────────────────────────────────────────────────────────────────

export interface AnalyzeConflictsRequest {
  tasks: TaskSnapshot[];
  workspaceId?: string;
  focusDate?: string;
}

export interface AnalyzeConflictsResponse {
  conflicts: ConflictInfo[];
  resolutions: ResolutionSuggestion[];
  summary: string;
  source: string;
}

export interface ConflictInfo {
  id: string;
  type: "time_overlap" | "overload" | "fragmentation" | "dependency";
  severity: "low" | "medium" | "high";
  taskIds: string[];
  description: string;
  timeRange?: { start: string; end: string };
}

export interface ResolutionSuggestion {
  conflictId: string;
  type: "reschedule" | "split" | "merge" | "defer" | "reorder";
  description: string;
  reason: string;
  changes: TaskChange[];
}

export interface TaskChange {
  taskId: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  priority?: string;
}

// ────────────────────────────────────────────────────────────────────
// Request / Response Types — Timeslot Suggestion
// ────────────────────────────────────────────────────────────────────

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

export interface SuggestTimeslotResponse {
  slots: TimeslotOption[];
  reasoning?: string;
  source: string;
}

export interface TimeslotOption {
  startAt: string;
  endAt: string;
  score: number; // 0-1, higher is better
  reason: string;
}

// ────────────────────────────────────────────────────────────────────
// Request / Response Types — General Chat
// ────────────────────────────────────────────────────────────────────

export interface ChatRequest {
  messages: AIMessage[];
  /** If true, expect JSON output */
  jsonMode?: boolean;
  /** Expected JSON schema (hint for the adapter) */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  /** Parsed JSON if jsonMode was true */
  parsed?: unknown;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  source: string;
}

// ────────────────────────────────────────────────────────────────────
// Context Snapshot Types (shared across requests)
// ────────────────────────────────────────────────────────────────────

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
  loadPercent: number; // 0-100
  freeMinutesToday: number;
}

// ────────────────────────────────────────────────────────────────────
// Adapter Configuration
// ────────────────────────────────────────────────────────────────────

export interface AIAdapterConfig {
  /** Unique identifier for this adapter instance */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider-specific configuration */
  options: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────
// Error Types
// ────────────────────────────────────────────────────────────────────

export class AIAdapterError extends Error {
  constructor(
    message: string,
    public readonly adapter: string,
    public readonly code:
      | "unavailable"
      | "timeout"
      | "invalid_response"
      | "auth_error"
      | "rate_limit"
      | "internal",
    public readonly cause?: unknown,
  ) {
    super(`[${adapter}] ${message}`);
    this.name = "AIAdapterError";
  }
}
