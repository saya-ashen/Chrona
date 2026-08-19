/**
 * AI Features — Shared feature-layer type definitions.
 */

import type { PlanBlueprint } from "./ai-plan-blueprint";
import type { GenerateTaskPlanRequest as RuntimeGenerateTaskPlanRequest } from "./plan-runtime";

export type AiClientType = "llm" | "hermes" | "debug" | "claude_code" | "codex" | "omp" | (string & {});
export const AI_FEATURES = [
  "suggest",
  "conflicts",
  "timeslots",
  "chat",
  "dispatch_task",
  "execute_task_node",
  "evaluate_condition_node",
  "review_checkpoint_node",
  "task.result_finalization",
  "goal.asset_ownership",
  "goal.review",
  "dashboard.brief",
  "task.plan",
  "task.execution",
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];

export interface AiClientRecord {
  id: string;
  name: string;
  type: AiClientType;
  config: AgentProviderClientConfig | LLMClientConfig | HermesClientConfig | DebugClientConfig | ClaudeCodeClientConfig | CodexClientConfig | OmpClientConfig;
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
}

/**
 * Config for the Claude Code execution provider (Spec 017 / WS-B).
 *
 * The provider launches a local Claude Code headless run through the Agent SDK
 * and registers Chrona's `/api/mcp` server scoped to that run.
 */

export interface ClaudeCodeClientConfig {
  /** Model ID passed to Claude Code. Defaults to "claude-opus-4-8". */
  model?: string;
  /** Total run timeout. SDK uses this as the overall bound. */
  timeoutMs?: number;
  /** Chrona /api/mcp base URL. Defaults to the hosting Chrona server. */
  mcpBaseUrl?: string;
  /**
   * Static Bearer token presented to the MCP server at `/api/mcp`. The MCP
   * server sits behind the same `apiKeyAuth()` middleware as every other
   * `/api/*` route, so this MUST equal the server's `API_KEY` (or be
   * supplied via `CHRONA_API_KEY` / `CHRONA_MCP_BEARER_TOKEN` env vars).
   */
  mcpRunToken?: string;
  /** Anthropic API key (recommended for production; subscription quota may otherwise apply). */
  apiKey?: string;
  /** Optional: pass-through env vars to the Claude Code subprocess. */
  env?: Record<string, string>;
  /** Optional config/state directory. Omitted means provider default user-level config. */
  configDirectory?: string;
  /** Reserved named profile selector. Runtime support depends on provider. */
  profileName?: string;
  /**
   * Optional: working directory for the Claude Code run. Defaults to
   * `process.cwd()`. Use this to constrain the agent's filesystem scope.
   */
  cwd?: string;
}


export interface CodexClientConfig {
  /** Internal codex-acp executable override. Not user-facing. */
  binaryPath?: string;
  /** Model ID passed to Codex. */
  model?: string;
  /** Total run timeout in milliseconds. */
  timeoutMs?: number;
  /** OpenAI/Codex API key. */
  apiKey?: string;
  /** OpenAI-compatible base URL. */
  baseUrl?: string;
  /** Optional pass-through env vars for codex-acp. */
  env?: Record<string, string>;
  /** Optional Codex home directory. Omitted means default user-level CODEX_HOME (~/.codex). */
  configDirectory?: string;
  /** Reserved Codex named profile selector. codex-acp cannot apply it yet. */
  profileName?: string;
  /** Optional working directory for Codex. */
  cwd?: string;
  /** Internal Codex CLI executable used by codex-acp. Not user-facing. */
  codexPath?: string;
  /** Chrona /api/mcp base URL. Defaults to the hosting Chrona server. */
  mcpBaseUrl?: string;
  /** Static Bearer token presented to the MCP server at `/api/mcp`. */
  mcpRunToken?: string;
}

export interface OmpClientConfig {
  /** OMP model ID. With provider set this remains opaque and may contain '/'; otherwise it may be a provider/model selector. */
  model?: string;
  /** Optional OMP provider namespace for the model and direct connection overrides. */
  provider?: string;
  /** Optional direct API key for OMP SDK runs. */
  apiKey?: string;
  /** Optional direct provider base URL for OMP SDK runs. */
  baseUrl?: string;
  /** Optional OMP wire API for direct base URL runs. Defaults to openai-responses for custom unprefixed models. */
  api?: "openai-responses" | "openai-completions" | "anthropic-messages" | "openrouter";
  /** Total run timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional HOME override used when resolving ~/.omp. */
  homeDirectory?: string;
  /** Optional OMP config root override (PI_CONFIG_DIR). */
  configDirectory?: string;
  /** Optional OMP agent data directory override (PI_CODING_AGENT_DIR). */
  codingAgentDirectory?: string;
  /** Optional pass-through env vars applied before OMP SDK startup. */
  env?: Record<string, string>;
  /** Optional working directory for OMP SDK sessions. */
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
