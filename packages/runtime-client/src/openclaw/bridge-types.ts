/**
 * Types shared between the OpenClaw CLI Bridge server and client.
 * Extracted so the runtime-client package doesn't depend on the bridge server.
 */

export interface BridgeRequest {
  sessionId?: string;
  message: string;
  systemPrompt?: string;
  timeout?: number;
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
  output: string;
  toolCalls: ToolCallInfo[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
  error: string | null;
  durationMs: number;
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
