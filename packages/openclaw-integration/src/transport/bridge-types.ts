/**
 * Types shared between the OpenClaw CLI Bridge server and client.
 */

import type { StructuredAgentResult } from "../protocol/structured-result";

export type BridgeFeature =
  | "suggest"
  | "generate_plan"
  | "conflicts"
  | "timeslots"
  | "chat";

export interface BridgeFeatureRequest<TInput = Record<string, unknown>> {
  sessionId?: string;
  input: TInput;
  timeout?: number;
}

export interface BridgeExecutionTaskRequest {
  sessionId?: string;
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

export interface BridgeFeatureResult {
  feature: BridgeFeature;
  source: "business_tool" | "output_json" | "assistant_text";
  toolName?: string;
  payload: unknown;
}

export interface BridgeResponse {
  sessionId: string;
  runId?: string;
  output: string;
  toolCalls: ToolCallInfo[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
  error: string | null;
  durationMs: number;
  structured: StructuredAgentResult | null;
  feature: BridgeFeatureResult | null;
}

export interface NDJSONEvent {
  type: string;
  sessionId?: string;
  text?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  error?: { name?: string; data?: { message?: string } } | string;
  phase?: string;
  message?: string;
  result?: string;
  usage?: Record<string, number>;
}
