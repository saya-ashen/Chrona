/**
 * AI Features — Shared feature-layer type definitions.
 */

import type { PlanBlueprint } from "./ai-plan-blueprint";
import type { GenerateTaskPlanRequest as RuntimeGenerateTaskPlanRequest } from "./plan-runtime";

export type AiClientType = "llm" | "hermes" | "debug" | "claude_code" | (string & {});
export type AiFeature =
  | "suggest"
  | "generate_plan"
  | "conflicts"
  | "timeslots"
  | "chat"
  | "dispatch_task"
  | "execute_task_node"
  | "evaluate_condition_node"
  | "review_checkpoint_node";

export interface AiClientRecord {
  id: string;
  name: string;
  type: AiClientType;
  config: AgentProviderClientConfig | LLMClientConfig | HermesClientConfig | DebugClientConfig | ClaudeCodeClientConfig;
  isDefault: boolean;
  enabled: boolean;
}

export const DEFAULT_AGENT_PROVIDER_MODEL = "provider/default";

export interface AgentProviderClientConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutSeconds?: number;
  timeoutMs?: number;
}

export interface LLMClientConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  temperature?: number;
}

export interface HermesClientConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Hermes gateway stays MCP-only until a future safe per-run skill/env handoff exists. */
  controlPlane?: "mcp";
}

/**
 * Config for the Claude Code execution provider (Spec 017 / WS-B).
 *
 * The provider launches a local Claude Code headless run (Agent SDK preferred,
 * `claude -p` subprocess fallback) per `startRun` and registers Chrona's
 * `/api/mcp` server scoped to that run. See `plan.md` §0 for the
 * research-gate decisions behind these fields.
 */
export type ControlPlaneMode = "mcp" | "skill";

export interface ClaudeCodeClientConfig {
  /** Override the Claude Code CLI location (CLI fallback path only). */
  binaryPath?: string;
  /** Model ID passed to Claude Code. Defaults to "claude-opus-4-8". */
  model?: string;
  /** Total run timeout. SDK uses this as the overall bound; CLI uses it as SIGKILL fallback. */
  timeoutMs?: number;
  /** Chrona /api/mcp base URL. Defaults to the hosting Chrona server. */
  mcpBaseUrl?: string;
  /**
   * Static Bearer token presented to the MCP server at `/api/mcp`. The MCP
   * server sits behind the same `apiKeyAuth()` middleware as every other
   * `/api/*` route, so this MUST equal the server's `API_KEY` (or be
   * supplied via `CHRONA_API_KEY` / `CHRONA_MCP_BEARER_TOKEN` env vars).
   * Skill mode is unaffected — the skill path uses a separate per-run
   * token injected at `start()` time via `input.control.runToken`.
   */
  mcpRunToken?: string;
  /** Control transport for node execution. Defaults to "mcp". Skill mode is supported for claude_code only. */
  controlPlane?: ControlPlaneMode;
  /** Anthropic API key (recommended for production; subscription quota may otherwise apply). */
  apiKey?: string;
  /** Optional: pass-through env vars to the Claude Code subprocess. */
  env?: Record<string, string>;
  /**
   * Optional: working directory for the Claude Code run. Defaults to
   * `process.cwd()`. Use this to constrain the agent's filesystem scope.
   */
  cwd?: string;
}

/**
 * Config for the Claude Code execution provider (Spec 017 / WS-B).
 *
 * The provider launches a local Claude Code headless run (Agent SDK preferred,
 * `claude -p` subprocess fallback) per `startRun` and registers Chrona's
 * `/api/mcp` server scoped to that run. See `plan.md` §0 for the
 * research-gate decisions behind these fields.
 */
export interface ClaudeCodeClientConfig {
  /** Override the Claude Code CLI location (CLI fallback path only). */
  binaryPath?: string;
  /** Model ID passed to Claude Code. Defaults to "claude-opus-4-8". */
  model?: string;
  /** Total run timeout. SDK uses this as the overall bound; CLI uses it as SIGKILL fallback. */
  timeoutMs?: number;
  /** Chrona /api/mcp base URL. Defaults to the hosting Chrona server. */
  mcpBaseUrl?: string;
  /** Anthropic API key (recommended for production; subscription quota may otherwise apply). */
  apiKey?: string;
  /** Optional: pass-through env vars to the Claude Code subprocess. */
  env?: Record<string, string>;
  /**
   * Optional: working directory for the Claude Code run. Defaults to
   * `process.cwd()`. Use this to constrain the agent's filesystem scope.
   */
  cwd?: string;
}

export type DebugProviderProfile = "deterministic" | "tool-submit" | "hermes-like";

export interface DebugClientConfig {
  profile?: DebugProviderProfile;
}

type StructuredResultReliability = "business_tool" | "assistant_text";

interface StructuredValidationIssue {
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

export type GenerateTaskPlanRequest = RuntimeGenerateTaskPlanRequest;

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

import type {
  TaskDispatchDecision,
  TaskDispatchPolicy,
} from "./ai-dispatch-types";

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
  acceptedPlan: PlanBlueprint;
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
  | { type: "tool_result"; tool: string; result: string; error?: boolean }
  | { type: "partial"; text: string }
  | { type: "result"; suggestions: SmartSuggestResponse }
  | { type: "result"; plan: GenerateTaskPlanResponse; taskSessionKey?: string }
  | { type: "done"; text: string; structured?: StructuredDebugInfo | null }
  | {
      type: "error";
      message: string;
      rawText?: string;
      structured?: StructuredDebugInfo | null;
      diagnostics?: Record<string, unknown>;
    };
