import type { BridgeResponse } from "@chrona/openclaw";

export type ProviderResponse = BridgeResponse;

export type ProviderMode = "chat" | "structured";

export type ProviderFeature =
  | "suggest"
  | "generate_plan"
  | "conflicts"
  | "timeslots"
  | "chat"
  | "dispatch_task";

export type ProviderCapabilities = {
  supportsSessions: boolean;
  supportsStreaming: boolean;
  supportsApprovals: boolean;
  supportsHistory: boolean;
  supportsResponseLookup: boolean;
  supportsPreviousResponse: boolean;
  supportsToolCalls: boolean;
};

export type ProviderConfig = {
  gatewayUrl: string;
  gatewayToken?: string;
  model?: string;
  timeoutSeconds?: number;
};

export type ProviderSessionRef = {
  provider: string;
  sessionId: string;
  nativeSessionId?: string;
  isVirtual?: boolean;
};

export type ProviderContinuation = {
  sessionId?: string;
  previousResponseId?: string;
  toolOutputs?: Array<{
    callId: string;
    output: unknown;
  }>;
};

export type ProviderStructuredOutputSchema = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export type ProviderExecuteRequest = {
  mode: ProviderMode;
  instructions?: string;
  inputText: string;
  input?: Record<string, unknown>;
  structuredOutputSchema?: ProviderStructuredOutputSchema;
  continuation?: ProviderContinuation;
  timeoutMs?: number;
};

export type ProviderExecuteResponse = {
  provider: string;
  sessionId?: string;
  responseId?: string;
  runId?: string;
  status?: string;
  outputText: string;
  structuredPayload?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
  error?: string | null;
  raw?: unknown;
};

export type ProviderMessageInput = {
  sessionId: string;
  message: string;
  previousResponseId?: string;
  timeoutMs?: number;
};

export type ProviderMessageResult = {
  accepted: boolean;
  responseId?: string;
  runId?: string;
  sessionId?: string;
};

export type ProviderApproval = {
  approvalId: string;
  sessionId?: string;
  host?: string;
  command?: string;
  ask?: string;
  createdAtMs?: number;
  expiresAtMs?: number;
};

export type ProviderApprovalDecision = "approve" | "reject";

export type ProviderApprovalResolution = {
  accepted: boolean;
};

export type ProviderRunStatus =
  | "pending"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "failed"
  | "completed"
  | "cancelled";

export type ProviderRunSnapshot = {
  runId: string;
  sessionId?: string;
  status: ProviderRunStatus;
  rawStatus?: string;
  outputText?: string;
  error?: string;
};

export type ProviderHistory = {
  messages: Array<Record<string, unknown>>;
};

export type ProviderSessionStatus = {
  sessionId: string;
  exists: boolean;
  activeRunId?: string;
  activeRunStatus?: ProviderRunStatus;
  pendingApprovals: ProviderApproval[];
  lastMessage?: string;
};

export type ProviderStreamEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_call";
      tool: string;
      callId: string;
      input: Record<string, unknown>;
      status: "pending" | "completed" | "error";
    }
  | { type: "tool_result"; tool: string; callId?: string; result: unknown }
  | {
      type: "completed";
      responseId?: string;
      runId?: string;
      status?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }
  | { type: "failed"; error: string };

export interface ProviderClient {
  readonly provider: string;

  getCapabilities(): ProviderCapabilities;
  checkHealth(): Promise<boolean>;

  createSession?(): Promise<ProviderSessionRef>;
  getSessionStatus(sessionId: string): Promise<ProviderSessionStatus>;

  execute(request: ProviderExecuteRequest): Promise<ProviderExecuteResponse>;
  executeStream?(
    request: ProviderExecuteRequest,
  ): AsyncGenerator<ProviderStreamEvent>;

  sendMessage(input: ProviderMessageInput): Promise<ProviderMessageResult>;
  readHistory(sessionId: string): Promise<ProviderHistory>;
  listApprovals(sessionId: string): Promise<ProviderApproval[]>;
  resolveApproval(input: {
    approvalId: string;
    decision: ProviderApprovalDecision;
  }): Promise<ProviderApprovalResolution>;
}
