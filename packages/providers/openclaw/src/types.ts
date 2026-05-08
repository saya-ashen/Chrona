import type { PreparedAiFeatureSpec } from "@chrona/contracts";
import type { RuntimeInput } from "@chrona/runtime-core";

export type StructuredResultReliability = "business_tool" | "assistant_text";

export interface StructuredValidationIssue {
  path: string;
  message: string;
}

export interface StructuredAgentResult<T = unknown> {
  ok: boolean;
  parsed: T | null;
  source?: StructuredResultReliability;
  feature?: string | null;
  toolName?: string | null;
  rawOutput?: string | null;
  error?: string | null;
  validationIssues?: StructuredValidationIssue[];
  sessionId?: string;
  runId?: string;
  bridgeToolCalls?: Array<{
    tool: string;
    callId?: string;
    input: Record<string, unknown>;
    result?: string;
    status?: "pending" | "completed" | "error";
  }>;
}

export type BridgeFeature =
  | "suggest"
  | "generate_plan"
  | "conflicts"
  | "timeslots"
  | "chat"
  | "dispatch_task";

export interface BridgeFeatureRequest<TInput = Record<string, unknown>> {
  sessionId?: string;
  sessionKey?: string;
  input: TInput;
  instructions?: string;
  inputText?: string;
  featureSpec?: PreparedAiFeatureSpec;
  timeout?: number;
}

export interface BridgeExecutionTaskRequest {
  sessionId?: string;
  sessionKey?: string;
  instructions: string;
  taskId?: string;
  workspaceId?: string;
  taskTitle?: string;
  runtimeAdapterKey?: string;
  runtimeInput?: Record<string, unknown>;
  timeout?: number;
}

export type BridgeRequest = BridgeFeatureRequest | BridgeExecutionTaskRequest;

export interface ToolCallInfo {
  tool: string;
  callId: string;
  input: Record<string, unknown>;
  result?: string;
  status: "pending" | "completed" | "error";
}

export interface ToolCallOutputInfo {
  callId: string;
  output: unknown;
}

export interface BridgeFeatureResult {
  feature: BridgeFeature;
  source: StructuredResultReliability;
  toolName?: string;
  payload: unknown;
}

export interface BridgeResponse {
  sessionId: string;
  responseId?: string;
  responseStatus?: string;
  runId?: string;
  output: string;
  toolCalls: ToolCallInfo[];
  toolCallOutputs?: ToolCallOutputInfo[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
  } | null;
  error: string | null;
  durationMs: number;
  structured: StructuredAgentResult | null;
  feature: BridgeFeatureResult | null;
}

export interface NDJSONEvent {
  type:
    | "status"
    | "text_delta"
    | "tool_call"
    | "tool_result"
    | "completed"
    | "failed";
  sessionId?: string;
  text?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  message?: string;
  error?: string;
  responseId?: string;
  status?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export type BridgeLogger = {
  debug: (event: string, data?: Record<string, unknown>) => void;
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
};

export type RouteKind =
  | { kind: "feature"; feature: BridgeFeature; stream: boolean }
  | { kind: "execution"; stream: boolean };

export interface ExecutionResult {
  response: BridgeResponse;
  events: NDJSONEvent[];
}

export interface BridgeEnvironment {
  gatewayHttpUrl: string;
  gatewayToken: string;
  agentId: string;
  model?: string;
  messageChannel?: string;
}

export interface OpenClawClientConfig {
  gatewayUrl: string;
  gatewayToken?: string;
  model?: string;
  timeoutSeconds?: number;
}

export type OpenClawFeature = BridgeFeature;
export type OpenClawResponse = BridgeResponse;
export type OpenClawToolCall = ToolCallInfo;

export interface OpenClawStreamEvent {
  type: "text" | "tool_call" | "tool_result" | "done" | "error";
  data: string;
  toolCall?: OpenClawToolCall;
}

export type OpenClawHello = {
  protocol: number;
  methods: string[];
};

export type OpenClawRunSnapshot = {
  runtimeRunRef: string;
  runtimeSessionRef?: string;
  runtimeSessionKey?: string;
  status:
    | "Pending"
    | "Running"
    | "WaitingForInput"
    | "WaitingForApproval"
    | "Failed"
    | "Completed"
    | "Cancelled";
  rawStatus?: string;
  lastMessage?: string;
};

export type OpenClawChatHistory = {
  messages: Array<Record<string, unknown>>;
};

export type OpenClawApprovalRequest = {
  command: string;
  commandArgv?: string[];
  cwd?: string;
  sessionKey?: string;
  host?: "gateway" | "node";
};

export type OpenClawApprovalRequestResult = {
  approvalId: string;
  status?: string;
};

export type OpenClawApprovalResolution = {
  approvalId: string;
  decision: "approve" | "reject";
};

export type OpenClawApprovalDecision = "allow-once" | "allow-always" | "deny";

export type OpenClawPendingApproval = {
  approvalId: string;
  sessionKey?: string;
  host?: string;
  command?: string;
  ask?: string;
  createdAtMs?: number;
  expiresAtMs?: number;
};

export type OpenClawSendInput = {
  runtimeSessionKey: string;
  message: string;
};

export type OpenClawSendInputResult = {
  accepted: boolean;
  runtimeRunRef?: string;
  runtimeSessionKey?: string;
  runStarted: boolean;
};

export type OpenClawStructuredRunResult<T = unknown> = StructuredAgentResult<T>;

export type OpenClawSessionStatus = {
  runtimeSessionKey: string;
  exists: boolean;
  activeRunRef?: string;
  activeRunStatus?: OpenClawRunSnapshot["status"];
  pendingApprovals: OpenClawPendingApproval[];
  lastMessage?: string;
};

export type OpenClawWaitForRunInput = {
  runtimeRunRef: string;
  runtimeSessionKey?: string;
  timeoutMs?: number;
};

export type OpenClawAdapterConfig = {
  bridgeUrl?: string;
  bridgeToken?: string;
  timeoutSeconds?: number;
  mode?: "live" | "mock";
};

export interface OpenClawRuntimeClient {
  connect(): Promise<OpenClawHello>;
  close(code?: number, reason?: string): void;
  createRun(input: {
    prompt: string;
    runtimeInput: RuntimeInput;
    runtimeSessionKey?: string;
  }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }>;
  createStructuredRun<T = unknown>(input: {
    feature: BridgeFeature;
    prompt: string;
    runtimeSessionKey?: string;
    instructions?: string;
    inputText?: string;
    featureSpec?: PreparedAiFeatureSpec;
    timeoutSeconds?: number;
  }): Promise<OpenClawStructuredRunResult<T>>;
  getStructuredResult<T = unknown>(
    runtimeSessionKey: string,
  ): Promise<OpenClawStructuredRunResult<T> | null>;
  waitForRun(
    input: OpenClawWaitForRunInput | string,
    timeoutMs?: number,
  ): Promise<OpenClawRunSnapshot>;
  readOutputs(runtimeSessionKey: string): Promise<OpenClawChatHistory>;
  listApprovals(): Promise<OpenClawPendingApproval[]>;
  sendInput(input: OpenClawSendInput): Promise<OpenClawSendInputResult>;
  waitForApprovalDecision(approvalId: string): Promise<OpenClawApprovalDecision | null>;
  requestApproval(input: OpenClawApprovalRequest): Promise<OpenClawApprovalRequestResult>;
  resolveApproval(input: OpenClawApprovalResolution): Promise<{
    accepted: boolean;
  }>;
  getSessionStatus(runtimeSessionKey: string): Promise<OpenClawSessionStatus>;
}
