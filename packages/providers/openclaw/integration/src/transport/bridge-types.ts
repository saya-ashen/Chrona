/**
 * Types shared between the OpenClaw CLI Bridge server and client.
 */

import type { StructuredAgentResult } from "../protocol/structured-result";

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
  source: "business_tool" | "output_json" | "assistant_text";
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
