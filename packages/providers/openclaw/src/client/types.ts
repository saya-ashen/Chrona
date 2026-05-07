import type { BridgeFeature, BridgeResponse, ToolCallInfo } from "../transport/bridge-types";

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
