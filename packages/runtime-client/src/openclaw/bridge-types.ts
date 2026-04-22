/**
 * Types shared between the OpenClaw CLI Bridge server and client.
 * Extracted so the runtime-client package doesn't depend on the bridge server.
 */

import type { StructuredAgentResult } from "./structured-result";

export interface BridgeRequest {
  sessionId?: string;
  message: string;
  systemPrompt?: string;
  timeout?: number;
  execution?: {
    mode: "task";
    runtimeAdapterKey?: string;
    taskId?: string;
    workspaceId?: string;
    taskTitle?: string;
    runtimeInput?: Record<string, unknown>;
  };
}

export interface ToolCallInfo {
  tool: string;
  callId: string;
  input: Record<string, unknown>;
  result?: string;
  status: "pending" | "completed" | "error";
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
}

export interface NDJSONEvent {
  type: string;
  sessionId?: string;
  text?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  error?: { name?: string; data?: { message?: string } };
  phase?: string;
  message?: string;
  usage?: Record<string, number>;
}
