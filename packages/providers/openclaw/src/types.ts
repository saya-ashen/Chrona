import type {
  AiFeatureStructuredOutputSchema,
  AiFeatureToolSpec,
} from "@chrona/contracts";

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
}

export type BridgeFeature =
  | "suggest"
  | "generate_plan"
  | "edit_plan"
  | "conflicts"
  | "timeslots"
  | "chat"
  | "dispatch_task"
  | "execute_task_node"
  | "evaluate_condition_node"
  | "review_checkpoint_node";

export type OpenClawGatewayFunctionToolChoice = {
  type: "function";
  function: { name: string };
};

export type OpenClawGatewayToolChoice =
  | "auto"
  | boolean
  | OpenClawGatewayFunctionToolChoice[];

export type OpenClawGatewayInputItem =
  | {
      type: "message";
      role: "user";
      content: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

export interface OpenClawGatewayBody {
  model?: string;
  user?: string;
  previous_response_id?: string;
  instructions: string;
  input: OpenClawGatewayInputItem[];
  tools?: AiFeatureToolSpec[];
  tool_choice?: OpenClawGatewayToolChoice;
  stream: boolean;
  max_output_tokens?: number;
}

export interface OpenClawGatewayRequest {
  sessionId: string;
  sessionKey?: string;
  instructions: string;
  input: unknown;
  structuredOutputSchema?: AiFeatureStructuredOutputSchema;
  stream?: boolean;
  maxOutputTokens?: number;
  timeoutSeconds?: number;
}

export type BridgeRequest = OpenClawGatewayRequest;

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

export type OpenClawResponseSnapshot = {
  responseId?: string;
  sessionId: string;
  sessionKey?: string;
  status?: string;
  output?: string;
  error?: string | null;
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
